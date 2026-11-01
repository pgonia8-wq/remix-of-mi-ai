import type { Core } from "./core";
import { credentialsFor } from "./core/executor";
import { call } from "./core/adapters/http";
import { budgetGate, recordUsage } from "./core/costs";
import type { ModelWithCaps } from "./core/registry";
import { ProviderError } from "./providers";

/** Tools the voice assistant may request. Every call still goes through invokeTool() (policy, budget, approval). */
export const VOICE_TOOLS = ["memory.search", "note.save", "task.add", "reminder.add", "research.web", "code.js", "memory.save"] as const;
export type RealtimeTool = { type: "function"; name: string; description: string; parameters: Record<string, unknown> };
export type VoiceApproval = { id: string; summary: string; decide: (ok: boolean) => Promise<void> };
export type VoiceEvents = { state(s: string): void; transcript(role: "user" | "assistant", text: string): void; error(): void; tool?(e: { tool: string; status: string; detail: string }): void; approval?(a: VoiceApproval): void };

export function realtimeConfig(model: string, instructions: string, voice: string, tools?: RealtimeTool[]) {
  const base = { type: "realtime", model, instructions, output_modalities: ["audio"], audio: { input: { transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "server_vad", interrupt_response: true } }, output: { voice } } };
  return tools?.length ? { ...base, tools, tool_choice: "auto" } : base;
}
/** Realtime endpoints: OpenAI, or Azure OpenAI GA (/openai/v1 on the resource; api-key mints, ephemeral token negotiates). */
export function realtimeEndpoints(kind: string, endpoint: string | null) {
  if (kind === "openai") return { secrets: "https://api.openai.com/v1/realtime/client_secrets", calls: "https://api.openai.com/v1/realtime/calls", auth: "bearer" as const };
  if (kind !== "azure_openai") throw new ProviderError("parameters", "Voz en tiempo real solo con OpenAI o Azure OpenAI.");
  let u: URL; try { u = new URL((endpoint ?? "").trim()); } catch { throw new ProviderError("endpoint", "URL de Azure incorrecta."); }
  if (u.protocol !== "https:") throw new ProviderError("endpoint", "URL de Azure incorrecta: usa HTTPS.");
  const path = u.pathname.replace(/\/+$/, "");
  if (!(path === "" || path === "/openai" || path.startsWith("/openai/v1") || path.startsWith("/openai/deployments"))) throw new ProviderError("endpoint", "URL de Azure incorrecta: usa la URL del recurso o /openai/v1.");
  return { secrets: `${u.origin}/openai/v1/realtime/client_secrets`, calls: `${u.origin}/openai/v1/realtime/calls`, auth: "api-key" as const };
}
/** Minimal zod → JSON Schema for tool parameters (objects, strings, numbers, booleans, arrays, enums). */
export function jsonSchemaOf(schema: unknown): Record<string, unknown> {
  const def = (schema as { _def?: Record<string, unknown> })?._def ?? {};
  switch (def["typeName"]) {
    case "ZodObject": { const shape = (typeof def["shape"] === "function" ? (def["shape"] as () => Record<string, unknown>)() : def["shape"]) as Record<string, unknown>; const required = Object.entries(shape).filter(([, v]) => !["ZodOptional", "ZodDefault"].includes((v as { _def: { typeName: string } })._def.typeName)).map(([k]) => k); return { type: "object", properties: Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, jsonSchemaOf(v)])), required, additionalProperties: false }; }
    case "ZodString": return { type: "string" };
    case "ZodNumber": return { type: (def["checks"] as { kind: string }[] | undefined)?.some((c) => c.kind === "int") ? "integer" : "number" };
    case "ZodBoolean": return { type: "boolean" };
    case "ZodArray": return { type: "array", items: jsonSchemaOf(def["type"]) };
    case "ZodEnum": return { type: "string", enum: def["values"] };
    case "ZodOptional": case "ZodDefault": case "ZodNullable": return jsonSchemaOf(def["innerType"]);
    case "ZodEffects": return jsonSchemaOf(def["schema"]);
    default: return {};
  }
}
export async function voiceTools(): Promise<RealtimeTool[]> {
  const { getTool } = await import("./automation/tools");
  return VOICE_TOOLS.map((id) => getTool(id)).filter((t): t is NonNullable<typeof t> => !!t).map((t) => ({ type: "function", name: t.id.replace(/\./g, "__"), description: `${t.description} Riesgo ${t.risk}.${t.approval === "always" ? " Requiere aprobación de la persona." : ""}`, parameters: jsonSchemaOf(t.input) }));
}
/** The user's encrypted on-device key mints a short-lived client token; no app server or key persistence. */
export async function startRealtime(core: Core, projectId: string, model: ModelWithCaps, voice: string, events: VoiceEvents, opts: { tools?: boolean } = {}) {
  if (!model.capabilities.includes("speech.realtime") || !["openai", "azure_openai"].includes(model.provider_kind)) throw new Error("Esta sesión requiere un modelo OpenAI o Azure OpenAI que declare voz en tiempo real.");
  await budgetGate(core.repo, projectId, model.remote_id, { seconds: 60 }); // before any credential or network access
  const { creds } = await credentialsFor(core.repo, model.provider_id);
  if (!creds.apiKey) throw new Error("Falta la clave del proveedor.");
  const ep = realtimeEndpoints(model.provider_kind, creds.endpoint);
  const context = await core.repo.buildContext(projectId, "");
  const tools = opts.tools ? await voiceTools() : [];
  const rules = tools.length ? "Puedes pedir las herramientas listadas cuando ayuden. Las acciones con costo o riesgo esperan la aprobación de la persona en pantalla; dilo en voz alta y espera el resultado." : "No ejecutes herramientas ni comandos.";
  const session = realtimeConfig(model.provider_kind === "azure_openai" ? (creds.deployment || model.remote_id) : model.remote_id, `Eres MI AI. Usa únicamente este proyecto autorizado: ${context}. ${rules}`, voice, tools);
  const mintHeaders: Record<string, string> = { "content-type": "application/json", ...(ep.auth === "bearer" ? { authorization: `Bearer ${creds.apiKey}` } : { "api-key": creds.apiKey }) };
  const token = await (await call(ep.secrets, { method: "POST", headers: mintHeaders, body: JSON.stringify({ session }) }, creds.apiKey, 20_000)).json();
  const ephemeral = typeof token?.value === "string" ? token.value : typeof token?.client_secret?.value === "string" ? token.client_secret.value : null;
  if (!ephemeral) throw new Error("El proveedor no devolvió una sesión de voz válida.");
  // Tool calls run inside an auditable run so invokeTool can apply limits, approvals and checkpoints.
  let runId: string | null = null;
  if (tools.length) { const { createRun } = await import("./automation/orchestrator"); runId = await createRun(core, projectId, { goal: "Conversación por voz con herramientas", kind: "voice", limits: { maxCalls: 30, unknownCost: "ask" } }); }
  const startedAt = Date.now();
  const pc = new RTCPeerConnection(), audio = new Audio(); audio.autoplay = true;
  let media: MediaStream | null = null, closed = false;
  const stop = () => {
    if (!closed) {
      void recordUsage(core.repo, projectId, { providerId: model.provider_id, model: model.remote_id, operation: "speech.realtime", usage: { seconds: Math.round((Date.now() - startedAt) / 1000) } }).catch((e) => console.warn("No se pudo registrar el costo de la voz:", e instanceof Error ? e.message : e));
      if (runId) void core.repo.sql.run("UPDATE auto_runs SET status='completed', phase='done', updated_at=? WHERE project_id=? AND id=?", [Date.now(), projectId, runId]).catch(() => {});
    }
    closed = true; media?.getTracks().forEach((t) => t.stop()); pc.close(); audio.pause(); audio.srcObject = null; events.state("idle");
  };
  try {
    media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    for (const track of media.getTracks()) pc.addTrack(track, media);
    pc.ontrack = (event) => { audio.srcObject = event.streams[0] ?? null; audio.play().catch(() => events.error()); };
    const dc = pc.createDataChannel("oai-events");
    const send = (o: unknown) => { if (dc.readyState === "open") dc.send(JSON.stringify(o)); };
    const handled = new Set<string>();
    const runTool = async (name: string, callId: string, args: string) => {
      if (!runId || handled.has(callId)) return; handled.add(callId);
      const toolId = name.replace(/__/g, ".");
      const reply = (output: string) => { if (closed) return; send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: callId, output: output.slice(0, 6000) } }); send({ type: "response.create" }); };
      let input: unknown; try { input = JSON.parse(args || "{}"); } catch { events.tool?.({ tool: toolId, status: "rejected", detail: "Argumentos inválidos" }); reply("Error: argumentos inválidos."); return; }
      const { invokeTool, DEFAULT_LIMITS } = await import("./automation/tools");
      const ctx = { core, projectId, runId, taskId: null, agent: "voice" };
      const invoke = () => invokeTool(ctx, toolId, input, { allowed: [...VOICE_TOOLS], limits: { ...DEFAULT_LIMITS, maxCalls: 30 }, opKey: `voice:${runId}:${callId}` });
      const finish = (r: Awaited<ReturnType<typeof invoke>>) => {
        if (r.status === "ok") { events.tool?.({ tool: toolId, status: "ok", detail: r.output.slice(0, 300) }); reply(r.trusted ? r.output : `<datos_no_confiables>${r.output}</datos_no_confiables>`); }
        else if (r.status === "approval") { events.tool?.({ tool: toolId, status: "approval", detail: r.summary }); events.approval?.({ id: r.approvalId, summary: r.summary, decide: async (ok) => { const { approvals } = await import("./automation/approvals"); await approvals.decide(core.repo, projectId, r.approvalId, ok); finish(await invoke()); } }); }
        else { events.tool?.({ tool: toolId, status: r.status, detail: r.reason }); reply(`No se ejecutó: ${r.reason}`); }
      };
      try { finish(await invoke()); } catch (e) { const msg = e instanceof Error ? e.message : String(e); events.tool?.({ tool: toolId, status: "rejected", detail: msg }); reply(`No se ejecutó: ${msg}`); }
    };
    dc.onmessage = (message) => {
      let data; try { data = JSON.parse(message.data); } catch { return; }
      if (data.type === "input_audio_buffer.speech_started") events.state("listening");
      if (data.type === "response.created") events.state("speaking");
      if (data.type === "response.done") {
        events.state("listening");
        for (const item of data.response?.output ?? []) if (item?.type === "function_call" && typeof item.name === "string" && typeof item.call_id === "string") void runTool(item.name, item.call_id, item.arguments ?? "{}");
      }
      if (data.type === "conversation.item.input_audio_transcription.completed" && data.transcript) events.transcript("user", data.transcript);
      if (["response.output_audio_transcript.done", "response.audio_transcript.done"].includes(data.type) && data.transcript) events.transcript("assistant", data.transcript);
      if (data.type === "error") events.error();
    };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "connected") events.state("listening"); if (["failed", "closed"].includes(pc.connectionState) && !closed) { events.error(); stop(); } };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const res = await call(ep.calls, { method: "POST", headers: { authorization: `Bearer ${ephemeral}`, "content-type": "application/sdp" }, body: offer.sdp ?? "" }, ephemeral, 20_000);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    return { stop, interrupt: () => { send({ type: "response.cancel" }); send({ type: "output_audio_buffer.clear" }); }, mute: (muted: boolean) => media?.getAudioTracks().forEach((t) => { t.enabled = !muted; }), simulateEvent: (data: unknown) => dc.onmessage?.({ data: JSON.stringify(data) } as MessageEvent) };
  } catch (e) { stop(); throw e; }
}
