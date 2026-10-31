import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Play, Save, Square, Sparkles, FolderOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NeedProject, inputCls } from "@/components/AppShell";
import { useActiveProjectId, useCoreQuery, useCoreMutate } from "@/lib/use-app";
import { askModel } from "@/lib/core/ai";
import { runCode } from "@/lib/code/run";
import { CODE_LIMITS } from "@/lib/code/engine";
export const Route = createFileRoute("/code")({ head: () => ({ meta: [
  { title: "Código — MI AI" }, { name: "description", content: "Editor JavaScript con ejecución local aislada y archivos cifrados." },
  { property: "og:title", content: "Código — MI AI" }, { property: "og:description", content: "Programa y prueba JavaScript sin acceso a red ni credenciales." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: Page });
function Page() { const pid = useActiveProjectId(); return pid ? <Code key={pid} pid={pid} /> : <NeedProject />; }
function Code({ pid }: { pid: string }) {
  const mutate = useCoreMutate();
  const { data: files = [] } = useCoreQuery(["code", pid], (c) => c.assets.list(pid, { kind: "code" }));
  const [source, setSource] = useState('console.log("Hola, MI AI");\n2 + 2;'), [name, setName] = useState("script.js"), [parent, setParent] = useState<string | null>(null);
  const [input, setInput] = useState(""), [output, setOutput] = useState(""), [goal, setGoal] = useState(""), [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  async function execute() {
    if (!confirm("¿Ejecutar este JavaScript aislado? No tendrá acceso a archivos, red ni claves.")) return;
    setBusy(true); const controller = new AbortController(); abort.current = controller;
    try { const r = await runCode(source, input, controller.signal); setOutput(r.output + (r.error ? "\nError: " + r.error : "")); }
    catch (e) { setOutput(e instanceof Error ? e.message : "Error de ejecución"); } finally { setBusy(false); abort.current = null; }
  }
  async function save() {
    try { await mutate(async (c) => { const a = await c.assets.put(pid, (async function* () { yield new TextEncoder().encode(source); })(), { kind: "code", mime: "text/javascript", name, parentId: parent, capability: "code.execute" }); setParent(a.id); }); toast.success("Código guardado cifrado"); }
    catch { toast.error("No se pudo guardar el código."); }
  }
  async function ai(mode: string) {
    setBusy(true);
    try { await mutate(async (c) => { const r = await askModel(c, pid, `${mode}. JavaScript síncrono para QuickJS. Sin red, archivos, importaciones ni temporizadores. Disponible input (texto), console.log y print. Devuelve solo el código en bloque javascript. Solicitud: ${goal.slice(0, 6000)}\nCódigo actual:\n${source}`, { save: { name: "Propuesta de código.txt" } }); const match = /```(?:javascript|js)?\s*([\s\S]*?)```/.exec(r.text); setSource((match?.[1] ?? r.text).slice(0, CODE_LIMITS.source)); setOutput("Propuesta recibida. Aún no ejecutada."); }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "No se recibió código."); } finally { setBusy(false); }
  }
  return <div className="space-y-3 p-4">
    <h1 className="text-2xl font-bold">Código</h1>
    <input aria-label="Nombre del archivo" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
    <textarea aria-label="Editor JavaScript" className={inputCls + " font-mono text-xs"} rows={15} spellCheck={false} maxLength={CODE_LIMITS.source} value={source} onChange={(e) => setSource(e.target.value)} />
    <textarea aria-label="Entrada del programa" className={inputCls} rows={2} placeholder="Entrada del programa" value={input} onChange={(e) => setInput(e.target.value)} />
    <div className="flex gap-2"><Button disabled={busy} onClick={execute}><Play />Ejecutar</Button><Button variant="outline" aria-label="Detener ejecución" disabled={!abort.current} onClick={() => abort.current?.abort()}><Square /></Button><Button variant="outline" disabled={busy || !name.trim()} onClick={save}><Save />Guardar</Button></div>
    <pre aria-label="Salida del programa" className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted p-3 text-xs">{output || "Sin salida."}</pre>
    <textarea className={inputCls} rows={2} placeholder="Qué debe hacer el código" value={goal} onChange={(e) => setGoal(e.target.value)} />
    <div className="flex flex-wrap gap-2">{["Generar código", "Refactorizar", "Crear pruebas", "Documentar"].map((mode) => <Button key={mode} variant="outline" disabled={busy || !goal.trim()} onClick={() => ai(mode)}><Sparkles className="h-3 w-3" />{mode}</Button>)}</div>
    <h2 className="pt-2 font-semibold">Archivos del proyecto</h2>
    {files.map((f) => <div key={f.id} className="flex items-center gap-2 border-b py-2"><Button variant="ghost" className="min-w-0 flex-1 justify-start truncate" disabled={busy} onClick={() => mutate(async (c) => { setSource(new TextDecoder().decode(await c.assets.read(pid, f.id))); setName(f.name ?? "script.js"); setParent(f.id); })}><FolderOpen />{f.name} · v{f.version}</Button><Button size="icon" variant="ghost" aria-label={`Eliminar ${f.name}`} onClick={() => confirm("¿Eliminar versión?") && mutate((c) => c.assets.remove(pid, f.id))}><Trash2 /></Button></div>)}
  </div>;
}