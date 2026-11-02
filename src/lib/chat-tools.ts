// Chat tools: the chat model can request app capabilities (images, video, research, documents…).
// Every call still goes through invokeTool() inside a `chat` run: policy, limits, budget, exact-action approval.
import type { Core } from "./core";
import type { ToolAsset } from "./automation/tools";

/** Fixed allowlist offered to the chat model. PC/engineering tools stay in the autonomous system (they need a paired PC). */
export const CHAT_TOOLS = [
  "image.generate", "video.generate", "audio.tts", "music.generate", "model3d.generate",
  "research.web", "research.deep", "doc.create",
  "note.save", "task.add", "reminder.add", "memory.search", "memory.save", "code.js",
] as const;

/** Plain-language hints so the model knows when and how to use each tool. */
const HINTS: Record<string, string> = {
  "image.generate": "Crea una imagen. `text` = descripción visual detallada (en inglés o español).",
  "video.generate": "Crea un video corto; tarda minutos y queda en Trabajos. `text` = descripción de la escena.",
  "audio.tts": "Convierte texto en un archivo de voz. `text` = lo que se dirá.",
  "music.generate": "Crea música. `text` = estilo, instrumentos, ánimo y duración.",
  "model3d.generate": "Crea un modelo 3D GLB. `text` = descripción del objeto.",
  "research.web": "Busca en internet. `text` = consulta breve. Cita las fuentes devueltas.",
  "research.deep": "Investigación de varias rondas con lectura de fuentes y citas. `text` = pregunta completa.",
  "doc.create": "Crea un archivo PDF, Word (docx), Excel (xlsx, usa tablas Markdown), PowerPoint (pptx, una diapositiva por título) o Markdown.",
  "note.save": "Guarda una nota en el proyecto.",
  "task.add": "Crea una tarea pendiente en el proyecto.",
  "reminder.add": "Programa un recordatorio en `minutes` minutos.",
  "memory.search": "Consulta la memoria del proyecto.",
  "memory.save": "Guarda un dato importante en la memoria del proyecto (solo si la persona lo pide o es claramente útil).",
  "code.js": "Ejecuta JavaScript aislado para cálculos exactos. Usa console.log para el resultado.",
};
export const TOOL_LABELS: Record<string, string> = {
  "image.generate": "Creando imagen", "video.generate": "Creando video", "audio.tts": "Generando voz", "music.generate": "Creando música",
  "model3d.generate": "Creando modelo 3D", "research.web": "Buscando en internet", "research.deep": "Investigando a fondo", "doc.create": "Creando documento",
  "note.save": "Guardando nota", "task.add": "Creando tarea", "reminder.add": "Programando recordatorio", "memory.search": "Consultando memoria",
  "memory.save": "Guardando en memoria", "code.js": "Calculando",
};
export const toolName = (id: string) => id.replace(/\./g, "__");
export const toolIdOf = (name: string) => name.replace(/__/g, ".");

export type ChatToolSet = { schemas: unknown[]; available: string[]; unavailable: { id: string; reason: string }[] };

/** Only tools that can actually run now are offered; the rest are described so the model can explain what to configure. */
export async function chatToolSet(core: Core, projectId: string): Promise<ChatToolSet> {
  const { getTool } = await import("./automation/tools");
  const { jsonSchemaOf } = await import("./realtime-voice");
  const ctx = { core, projectId, runId: "", taskId: null, agent: "chat" };
  const schemas: unknown[] = [], available: string[] = [], unavailable: { id: string; reason: string }[] = [];
  for (const id of CHAT_TOOLS) {
    const def = getTool(id); if (!def) continue;
    const a = await def.availability(ctx).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));
    if (!a.ok) { unavailable.push({ id, reason: a.reason ?? "no disponible" }); continue; }
    available.push(id);
    schemas.push({ type: "function", function: { name: toolName(id), description: `${def.name}. ${HINTS[id] ?? def.description}`, parameters: jsonSchemaOf(def.input) } });
  }
  return { schemas, available, unavailable };
}

export function toolsPrompt(set: ChatToolSet) {
  const on = set.available.map((id) => `- ${TOOL_LABELS[id] ?? id} (${toolName(id)})`).join("\n");
  const off = set.unavailable.map((u) => `- ${TOOL_LABELS[u.id] ?? u.id}: ${u.reason}`).join("\n");
  return `\n\nHerramientas de MI AI:\n${on ? `Puedes usarlas directamente cuando la persona lo pida (crear imágenes, videos, voz, música, 3D, documentos, buscar en internet, notas, tareas, recordatorios, cálculos):\n${on}\nLos archivos que crees aparecen solos en la conversación; no inventes enlaces.` : "Ninguna herramienta está lista ahora."}${off ? `\nNo disponibles todavía (explica a la persona qué configurar, normalmente un modelo con esa capacidad en Modelos):\n${off}` : ""}`;
}

export type ToolStep = { reply: string; assets: ToolAsset[] };
type Ask = (summary: string) => Promise<boolean>;

/** Runs one model-requested tool call. Approvals block until the person decides on screen. */
export async function runChatTool(core: Core, projectId: string, runId: string, call: { id: string; name: string; arguments: string }, ask: Ask, signal?: AbortSignal): Promise<ToolStep> {
  const toolId = toolIdOf(call.name);
  if (!(CHAT_TOOLS as readonly string[]).includes(toolId)) return { reply: `No se ejecutó: «${toolId}» no está disponible en el chat.`, assets: [] };
  let input: unknown;
  try { input = JSON.parse(call.arguments || "{}"); } catch { return { reply: "No se ejecutó: argumentos inválidos.", assets: [] }; }
  const { invokeTool, DEFAULT_LIMITS } = await import("./automation/tools");
  const ctx = { core, projectId, runId, taskId: null, agent: "chat", ...(signal ? { signal } : {}) };
  // The person asked for this in the chat: unknown prices proceed (project budgets still apply); known costs ask on screen.
  const opts = { allowed: [...CHAT_TOOLS], limits: { ...DEFAULT_LIMITS, maxCalls: 40, perAgentCalls: 40, unknownCost: "allow" as const }, opKey: `chat:${runId}:${call.id}` };
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await invokeTool(ctx, toolId, input, opts);
    if (r.status === "ok") return { reply: r.trusted ? r.output : `<datos_no_confiables>${r.output}</datos_no_confiables>`, assets: r.assets ?? [] };
    if (r.status === "approval") {
      const ok = await ask(r.summary);
      const { approvals } = await import("./automation/approvals");
      await approvals.decide(core.repo, projectId, r.approvalId, ok);
      if (!ok) return { reply: "La persona rechazó esta acción. No la repitas sin que lo pida.", assets: [] };
      continue;
    }
    return { reply: `No se ejecutó: ${r.reason}`, assets: [] };
  }
  return { reply: "No se ejecutó: la aprobación no coincidió con la acción.", assets: [] };
}
