import { useEffect, useRef, useState } from "react";
import { AudioLines, Mic, MicOff, PhoneOff, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { NeedProject, inputCls } from "./AppShell";
import { useActiveProjectId, useCoreQuery, useCoreMutate } from "@/lib/use-app";
import { getCore } from "@/lib/core";
import { startRealtime } from "@/lib/realtime-voice";
export function RealtimeVoice() { const pid = useActiveProjectId(); return pid ? <Voice key={pid} pid={pid} /> : <NeedProject />; }
function Voice({ pid }: { pid: string }) {
  const { data: models = [] } = useCoreQuery(["realtime-models"], async (c) => (await c.repo.registry.listModels()).filter((m) => m.provider_kind === "openai" && m.provider_enabled && m.capabilities.includes("speech.realtime")));
  const [modelId, setModelId] = useState(""), [voice, setVoice] = useState("marin"), [state, setState] = useState("idle"), [muted, setMuted] = useState(false), [transcripts, setTranscripts] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const session = useRef<Awaited<ReturnType<typeof startRealtime>> | null>(null), generation = useRef(0), mutate = useCoreMutate();
  useEffect(() => () => { generation.current++; session.current?.stop(); }, []);
  async function start() {
    const model = models.find((m) => m.id === modelId) ?? models[0]; if (!model) return;
    if (!confirm("¿Iniciar conversación de voz? Se enviará audio y contexto de este proyecto al proveedor, con posible costo.")) return;
    const current = ++generation.current;
    setState("connecting"); setMuted(false);
    try { const active = await startRealtime(await getCore(), pid, model, voice, { state: (s) => { if (current === generation.current) setState(s); }, transcript: (role, text) => { if (current === generation.current) setTranscripts((v) => [...v, { role, text }]); }, error: () => { if (current === generation.current) toast.error("La sesión de voz no confirmó su estado. Comprueba la conexión y el proveedor."); } }); if (current !== generation.current) active.stop(); else session.current = active; }
    catch { setState("idle"); toast.error("No se pudo abrir voz en tiempo real. Revisa el modelo, permisos de micrófono y acceso del proveedor desde este dispositivo."); }
  }
  return <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6"><h1 className="text-2xl font-semibold">Conversación por voz</h1><select aria-label="Modelo de voz en tiempo real" disabled={state !== "idle"} className={inputCls} value={modelId} onChange={(e) => setModelId(e.target.value)}><option value="">Automático</option>{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select><select aria-label="Voz de conversación" className={inputCls} disabled={state !== "idle"} value={voice} onChange={(e) => setVoice(e.target.value)}>{["marin", "cedar", "alloy", "ash", "coral", "sage", "verse"].map((v) => <option key={v}>{v}</option>)}</select>
    <div className="flex min-h-64 flex-col items-center justify-center gap-5"><AudioLines className={`h-16 w-16 text-primary ${state === "speaking" ? "animate-pulse" : ""}`} /><p className="text-sm text-muted-foreground">{state === "idle" ? "Sesión detenida" : state === "connecting" ? "Conectando…" : state === "speaking" ? "Respondiendo" : "Escuchando"}</p><div className="flex gap-3">{state === "idle" ? <Button disabled={!models.length} onClick={start}><Mic />Iniciar</Button> : <><Button variant="outline" size="icon" aria-label="Silenciar micrófono" onClick={() => { session.current?.mute(!muted); setMuted(!muted); }}>{muted ? <MicOff /> : <Mic />}</Button><Button variant="outline" size="icon" aria-label="Interrumpir respuesta" onClick={() => session.current?.interrupt()}><Square /></Button><Button variant="destructive" size="icon" aria-label="Terminar sesión" onClick={() => session.current?.stop()}><PhoneOff /></Button></>}</div></div>
    {!models.length && <p className="text-sm text-muted-foreground">Sin modelo OpenAI configurado con la capacidad Voz en tiempo real.</p>}
    {transcripts.map((t, i) => <div key={i} className="border-b pb-3"><span className="text-xs text-primary">{t.role === "user" ? "Tú" : "MI AI"}</span><p className="mt-1 text-sm">{t.text}</p></div>)}
    {!!transcripts.length && <Button variant="outline" onClick={async () => { await mutate(async (c) => { const chat = await c.repo.createChat(pid, "Conversación por voz"); for (const t of transcripts) await c.repo.addMessage(pid, chat.id, t.role, t.text); }); toast.success("Conversación guardada en Chats."); }}>Guardar conversación</Button>}
  </div>;
}