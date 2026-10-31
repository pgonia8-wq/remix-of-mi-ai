import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Bot, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NeedProject, inputCls } from "@/components/AppShell";
import { useActiveProjectId, useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { agents, TOOLS, type AgentConfig, type Agent } from "@/lib/automation/store";

export const Route = createFileRoute("/agents")({ head: () => ({ meta: [
  { title: "Agentes — MI AI" }, { name: "description", content: "Agentes por proyecto con herramientas autorizadas y límites de uso." },
  { property: "og:title", content: "Agentes — MI AI" }, { property: "og:description", content: "Configura especialistas y revisa sus permisos." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: Page });
const INITIAL: AgentConfig = { objective: "", instructions: "", expected: "", modelId: null, tools: ["chat"], memory: false, maxCalls: 5 };
function Page() { const pid = useActiveProjectId(); return pid ? <Agents key={pid} pid={pid} /> : <NeedProject />; }
function Agents({ pid }: { pid: string }) {
  const { data: list = [] } = useCoreQuery(["agents", pid], (c) => agents.list(c.repo, pid));
  const { data: models = [] } = useCoreQuery(["models"], (c) => c.repo.registry.listModels());
  const mutate = useCoreMutate();
  const [edit, setEdit] = useState<string | null>(null), [name, setName] = useState(""), [config, setConfig] = useState<AgentConfig>(INITIAL);
  const [busy, setBusy] = useState(false);
  function open(a?: Agent) { setEdit(a?.id ?? "new"); setName(a?.name ?? ""); setConfig(a ? JSON.parse(a.config) as AgentConfig : { ...INITIAL }); }
  async function save() { setBusy(true); try { await mutate((c) => agents.save(c.repo, pid, name, config, edit === "new" ? undefined : edit ?? undefined)); setEdit(null); toast.success("Agente guardado"); } catch { toast.error("Revisa el nombre, instrucciones y límites del agente."); } finally { setBusy(false); } }
  return <div className="space-y-4 p-4">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Agentes</h1><Button aria-label="Nuevo agente" title="Nuevo agente" onClick={() => open()}><Plus /></Button></div>
    {edit ? <div className="space-y-3">
      <label className="block text-sm">Nombre<input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block text-sm">Objetivo<textarea className={inputCls} rows={2} value={config.objective} onChange={(e) => setConfig({ ...config, objective: e.target.value })} /></label>
      <label className="block text-sm">Instrucciones<textarea className={inputCls} rows={5} value={config.instructions} onChange={(e) => setConfig({ ...config, instructions: e.target.value })} /></label>
      <label className="block text-sm">Resultado esperado<input className={inputCls} value={config.expected} onChange={(e) => setConfig({ ...config, expected: e.target.value })} /></label>
      <label className="block text-sm">Modelo<select className={inputCls} value={config.modelId ?? ""} onChange={(e) => setConfig({ ...config, modelId: e.target.value || null })}><option value="">Automático por capacidad</option>{models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Herramientas autorizadas</legend>{TOOLS.map((t) => <label key={t} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.tools.includes(t)} onChange={(e) => setConfig({ ...config, tools: e.target.checked ? [...config.tools, t] : config.tools.filter((x) => x !== t) })} />{t}</label>)}</fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={config.memory} onChange={(e) => setConfig({ ...config, memory: e.target.checked })} />Autorizar memoria de este proyecto</label>
      <label className="block text-sm">Máximo de solicitudes por ejecución<input type="number" min={1} max={20} className={inputCls} value={config.maxCalls} onChange={(e) => setConfig({ ...config, maxCalls: Number(e.target.value) })} /></label>
      <div className="flex gap-2"><Button disabled={busy || !name.trim() || !config.instructions.trim() || !config.tools.length} onClick={save}><Save />Guardar</Button><Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button></div>
    </div> : <div className="space-y-2">{list.map((a) => <div key={a.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
      <Bot className="h-5 w-5 shrink-0 text-primary" /><Button variant="ghost" className="min-w-0 flex-1 justify-start truncate" onClick={() => open(a)}>{a.name}</Button>
      <input type="checkbox" aria-label={`Activar ${a.name}`} checked={!!a.enabled} onChange={(e) => mutate((c) => agents.toggle(c.repo, pid, a.id, e.target.checked))} />
      <Button variant="ghost" size="icon" aria-label={`Eliminar ${a.name}`} onClick={() => confirm("¿Eliminar agente?") && mutate((c) => agents.remove(c.repo, pid, a.id))}><Trash2 /></Button>
    </div>)}{!list.length && <p className="text-sm text-muted-foreground">Sin agentes.</p>}</div>}
  </div>;
}