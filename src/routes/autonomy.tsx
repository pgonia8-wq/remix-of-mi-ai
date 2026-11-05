import { createFileRoute, Link } from "@tanstack/react-router";
import { route } from "@/lib/core/router";
import { useEffect, useState } from "react";
import { Check, X, Pause, Play, Square, RefreshCw, Link2, FolderPlus, Cable, Package } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NeedProject, inputCls } from "@/components/AppShell";
import { useActiveProjectId, useCoreQuery, useCoreMutate } from "@/lib/use-app";
import { autoRuns, createRun, resolveReview, afterApproval, ROLES, type AutoRun } from "@/lib/automation/orchestrator";
import { approvals } from "@/lib/automation/approvals";
import { createBuilderRun, packageDeliverable, type DeliverableKind } from "@/lib/automation/builder";
import { availabilityReport } from "@/lib/automation/tools";
import { driveRun, onRunProgress } from "@/lib/automation/drive";
import { localWs } from "@/lib/automation/local-workspace";
import { zipStore } from "@/lib/zip";
import { saveExport } from "@/lib/save-export";
import { useQueryClient } from "@tanstack/react-query";
import { dueReviews } from "@/lib/automation/triggers";
import { nodes, pairNode, heartbeat, type NodeInfo } from "@/lib/nodes/client";
import { folders, pcFiles } from "@/lib/nodes/storage";
import { tunnels, tunnelKind, TUNNEL_INFO, tunnelCredentials } from "@/lib/nodes/tunnels";
import { connections } from "@/lib/connections";

export const Route = createFileRoute("/autonomy")({ head: () => ({ meta: [
  { title: "Sistema autónomo — MI AI" }, { name: "description", content: "Equipos de agentes, AI Builder, aprobaciones, PC Node, carpetas privadas y túneles." },
  { property: "og:title", content: "Sistema autónomo — MI AI" }, { property: "og:description", content: "Ejecuciones supervisadas con evidencias, recuperación y computación en tu PC." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: Page });
function Page() { const pid = useActiveProjectId(); return pid ? <Autonomy key={pid} pid={pid} /> : <NeedProject />; }
const TABS = [["runs", "Tareas"], ["inbox", "Aprobaciones"], ["phone", "Archivos"], ["pc", "PC o VM (opcional)"]] as const;
const PC_TABS = [["nodes", "Conectar PC/VM"], ["folders", "Carpetas"], ["tunnels", "Túneles"], ["tools", "Herramientas"]] as const;
const STATUS: Record<string, string> = { active: "en curso", paused: "en pausa", waiting: "esperando aprobación", review_required: "requiere revisión", needs_human: "requiere intervención", completed: "terminada", cancelled: "detenida", failed: "fallida" };
const gb = (n?: number | null) => n == null ? "?" : `${(n / 2 ** 30).toFixed(1)} GB`;

function Autonomy({ pid }: { pid: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("runs");
  const mutate = useCoreMutate();
  const [busy, setBusy] = useState(false);
  const act: Act = async (fn, ok) => { setBusy(true); try { const r = await mutate(fn); if (ok) toast.success(ok); return r; } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo completar."); return undefined; } finally { setBusy(false); } };
  const { data: pending = [] } = useCoreQuery(["auto-approvals", pid], (c) => approvals.pending(c.repo, pid));
  return <div className="space-y-4 p-4">
    <h1 className="text-2xl font-bold">Agentes autónomos</h1>
    <div role="tablist" className="flex flex-wrap gap-2">{TABS.map(([k, l]) => <Button key={k} role="tab" aria-selected={tab === k} variant={tab === k ? "default" : "outline"} size="sm" onClick={() => setTab(k)}>{l}{k === "inbox" && pending.length ? ` (${pending.length})` : ""}</Button>)}</div>
    {tab === "runs" && <Runs pid={pid} act={act} busy={busy} />}
    {tab === "inbox" && <Inbox pid={pid} act={act} busy={busy} />}
    {tab === "phone" && <PhoneFiles pid={pid} />}
    {tab === "pc" && <PcArea pid={pid} act={act} busy={busy} />}
  </div>;
}
function PcArea({ pid, act, busy }: { pid: string; act: Act; busy: boolean }) {
  const [sub, setSub] = useState<(typeof PC_TABS)[number][0]>("nodes");
  return <section className="space-y-3">
    <p className="rounded-md border p-3 text-sm text-muted-foreground">Esto es opcional. Los agentes ya trabajan solos en tu teléfono. Conecta una PC o una VM solo si quieres que además compilen apps nativas, usen Docker o programas pesados.</p>
    <div role="tablist" className="flex flex-wrap gap-2">{PC_TABS.map(([k, l]) => <Button key={k} role="tab" aria-selected={sub === k} variant={sub === k ? "secondary" : "ghost"} size="sm" onClick={() => setSub(k)}>{l}</Button>)}</div>
    {sub === "nodes" && <Nodes act={act} busy={busy} />}
    {sub === "folders" && <Folders pid={pid} act={act} busy={busy} />}
    {sub === "tunnels" && <Tunnels pid={pid} act={act} busy={busy} />}
    {sub === "tools" && <Tools pid={pid} />}
  </section>;
}
type Act = <T>(fn: (c: import("@/lib/core").Core) => Promise<T>, ok?: string) => Promise<T | undefined>;

function Runs({ pid, act, busy }: { pid: string; act: Act; busy: boolean }) {
  const { data: runs = [] } = useCoreQuery(["auto-runs", pid], (c) => autoRuns.list(c, pid));
  const { data: nodeList = [] } = useCoreQuery(["pc-nodes"], (c) => nodes.list(c.repo));
  const { data: fl = [] } = useCoreQuery(["node-folders", pid], (c) => folders.list(c.repo, pid));
  const { data: due = [] } = useCoreQuery(["due-reviews", pid], (c) => dueReviews(c.repo, pid));
  const [mode, setMode] = useState<"team" | "builder">("team"), [goal, setGoal] = useState(""), [acc, setAcc] = useState(""), [folder, setFolder] = useState(""), [kind, setKind] = useState<DeliverableKind>("web"), [usd, setUsd] = useState(""), [conc, setConc] = useState(2), [open, setOpen] = useState<string | null>(null);
  const { data: brain = null } = useCoreQuery(["auto-brain"], async (c) => { const models = await c.repo.registry.listModels(); const d = route(models, { capability: "chat.tools", mode: "auto" }); const e = d.ok ? d : route(models, { capability: "chat", mode: "auto" }); return e.ok ? { ok: true as const, name: e.model.name } : { ok: false as const, name: "" }; });
  const f = fl.find((x) => x.id === folder);
  const create = () => act(async (c) => {
    const limits = { maxUsd: usd ? Number(usd) : null, concurrency: conc };
    const id = mode === "builder"
      ? await createBuilderRun(c, pid, { requirements: goal, kind, nodeId: f?.node_id ?? null, folderId: f?.id ?? null, limits })
      : await createRun(c, pid, { goal, acceptance: acc.split("\n").map((s) => s.trim()).filter(Boolean), limits, nodeId: f?.node_id ?? null, folderId: f?.id ?? null });
    setOpen(id); setGoal(""); driveRun(c, pid, id); return id;
  }, "Ejecución creada");
  return <section className="space-y-4">
    {due.length > 0 && <div className="rounded-md border p-3 text-sm">{due.map((d) => <p key={d.id}>Recordatorio: revisar ejecución ({d.kind}) {d.note}</p>)}</div>}
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-sm">Pide algo y un equipo de agentes lo planifica, lo hace y lo revisa por su cuenta, <b>aquí en tu teléfono</b>. No necesitas PC ni VM.</p>
      {brain === null ? null : brain.ok
        ? <p className="text-xs text-muted-foreground">Trabajarán con: <b>{brain.name}</b></p>
        : <p className="text-xs text-destructive">Primero configura un modelo de chat en <Link to="/models" className="underline">Modelos</Link> (la configuración automática lo hace por ti).</p>}
      <div className="flex gap-2"><Button size="sm" variant={mode === "team" ? "default" : "outline"} onClick={() => setMode("team")}>Hacer una tarea</Button><Button size="sm" variant={mode === "builder" ? "default" : "outline"} onClick={() => setMode("builder")}>Construir una app</Button></div>
      <label className="block text-sm">{mode === "builder" ? "¿Qué app o programa quieres?" : "¿Qué quieres que hagan?"}<textarea className={inputCls} rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={mode === "builder" ? "Ej.: una página web para mi negocio con menú, precios y formulario de contacto" : "Ej.: investiga los 5 mejores celulares de 2026 y hazme un informe en Word con tabla comparativa"} /></label>
      <details className="text-sm"><summary className="cursor-pointer text-xs text-primary">Opciones avanzadas (no son necesarias)</summary>
        <div className="mt-2 space-y-2">
          {mode === "team" && <label className="block text-sm">Cómo sabrán que terminaron (uno por línea)<textarea className={inputCls} rows={2} value={acc} onChange={(e) => setAcc(e.target.value)} placeholder="Si lo dejas vacío, los agentes lo deciden" /></label>}
          {mode === "builder" && <label className="block text-sm">Tipo de entregable<select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as DeliverableKind)}>{(["web", "android", "api", "backend", "desktop", "script", "automation", "database", "multi-module", "multi-service"] as const).map((k) => <option key={k} value={k}>{k}</option>)}</select></label>}
          <label className="block text-sm">Dónde trabajan<select className={inputCls} value={folder} onChange={(e) => setFolder(e.target.value)}><option value="">En este teléfono</option>{fl.map((x) => <option key={x.id} value={x.id}>{x.label} · {nodeList.find((n) => n.id === x.node_id)?.name ?? "PC"}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-sm">Gasto máximo (US$)<input className={inputCls} inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value)} placeholder="sin límite propio" /></label>
            <label className="block text-sm">Agentes a la vez<input className={inputCls} type="number" min={1} max={6} value={conc} onChange={(e) => setConc(Number(e.target.value))} /></label>
          </div>
          {!f && <p className="text-xs text-muted-foreground">En el teléfono escriben archivos, investigan, crean documentos y ejecutan código JavaScript/Python. Solo para compilar apps nativas (APK, escritorio) hace falta conectar una PC o VM en la pestaña «PC o VM».</p>}
        </div>
      </details>
      <Button className="w-full" disabled={busy || !goal.trim() || brain?.ok === false} onClick={create}><Play />Empezar</Button>
    </div>
    {runs.map((r) => <RunCard key={r.id} pid={pid} r={r} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} act={act} busy={busy} />)}
  </section>;
}
function RunCard({ pid, r, open, toggle, act, busy }: { pid: string; r: AutoRun; open: boolean; toggle: () => void; act: Act; busy: boolean }) {
  const qc = useQueryClient();
  const { data: tasks = [] } = useCoreQuery(["auto-tasks", pid, r.id], (c) => autoRuns.tasks(c, pid, r.id), open);
  const { data: obs = [] } = useCoreQuery(["auto-obs", pid, r.id], (c) => autoRuns.observations(c, pid, r.id), open);
  const { data: ev = [] } = useCoreQuery(["auto-ev", pid, r.id], (c) => autoRuns.evidence(c, pid, r.id), open);
  const limits = JSON.parse(r.limits) as { maxCalls: number; maxUsd: number | null };
  const step = () => act(async (c) => { driveRun(c, pid, r.id); return r; });
  useEffect(() => onRunProgress((id) => { if (id === r.id) void qc.invalidateQueries(); }), [r.id, qc]);
  const files = obs.filter((o) => o.kind === "file");
  return <article className="space-y-2 border-t py-3">
    <button className="w-full text-left" onClick={toggle}><h2 className="break-words font-semibold">{r.kind === "builder" ? "AI Builder · " : ""}{r.goal.slice(0, 160)}</h2>
      <p className="text-sm text-muted-foreground">{STATUS[r.status] ?? r.status} · fase {r.phase} · {r.calls}/{limits.maxCalls} llamadas · ~{r.tokens} tokens · US$ {r.spent_usd.toFixed(4)}{r.unknown_cost_calls ? ` + ${r.unknown_cost_calls} de coste desconocido` : ""} · {Math.round((r.updated_at - r.created_at) / 1000)} s</p></button>
    {r.error && <p className="text-sm text-destructive">{r.error}</p>}
    <div className="flex flex-wrap gap-2">
      {["active", "waiting"].includes(r.status) && <Button size="sm" disabled={busy} onClick={step}><Play />Avanzar</Button>}
      {["active", "waiting"].includes(r.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => act((c) => autoRuns.pause(c, pid, r.id))}><Pause />Pausar</Button>}
      {["paused", "needs_human"].includes(r.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => act((c) => autoRuns.resume(c, pid, r.id))}><RefreshCw />Reanudar</Button>}
      {!["completed", "cancelled"].includes(r.status) && <Button size="sm" variant="outline" disabled={busy} onClick={() => act((c) => autoRuns.cancel(c, pid, r.id))}><Square />Detener</Button>}
      {r.status === "completed" && r.kind === "builder" && <Button size="sm" variant="outline" disabled={busy} onClick={() => act((c) => packageDeliverable(c, pid, r.id), "Entrega guardada en la Biblioteca")}><Package />Generar entrega</Button>}
    </div>
    {open && <div className="space-y-3 text-sm">
      <h3 className="font-medium">Subtareas</h3>
      {tasks.map((t) => <div key={t.id} className="rounded-md border p-2">
        <p className="font-medium">{t.title}</p>
        <p className="text-muted-foreground">{ROLES[t.role]?.name ?? t.role} · {t.status} · intento {t.attempts + 1}/{t.max_attempts} · turno {t.turns}</p>
        {t.review && <p>Auditor: {t.review}</p>}{t.error && <p className="text-destructive">{t.error}</p>}
        {t.status === "review_required" && <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => { if (window.confirm("¿Repetir la acción? Puede duplicar cambios o cobros.")) act((c) => resolveReview(c, pid, r.id, t.id, "retry")); }}>Confirmar reintento</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act((c) => resolveReview(c, pid, r.id, t.id, "mark_done"))}>Ya se completó</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act((c) => resolveReview(c, pid, r.id, t.id, "fail"))}>Marcar fallida</Button>
        </div>}
      </div>)}
      {files.length > 0 && <><h3 className="font-medium">Archivos modificados</h3><ul className="list-disc pl-5">{files.map((o) => <li key={o.id} className="break-all">{o.input} · {o.output.slice(0, 12)}</li>)}</ul></>}
      <h3 className="font-medium">Pruebas y evidencias</h3>
      {ev.length ? ev.map((e) => <p key={e.id} className="break-words"><span className={e.status === "passed" ? "text-primary" : e.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{({ passed: "Aprobada", failed: "Fallida", not_run: "No ejecutada", blocked: "Bloqueada", simulated: "Simulada" } as Record<string, string>)[e.status]}</span> · {e.check_kind} · {e.command} · {e.env}</p>) : <p className="text-muted-foreground">Sin evidencias todavía.</p>}
      <h3 className="font-medium">Historial</h3>
      <ol className="space-y-1">{obs.slice(-60).map((o) => <li key={o.id} className="break-words text-xs"><b>{o.agent ?? "sistema"}</b> · {o.kind}{o.tool ? ` · ${o.tool}` : ""}{o.cost_usd ? ` · US$ ${o.cost_usd}` : ""} — {o.output.slice(0, 240)}</li>)}</ol>
      {r.result && <><h3 className="font-medium">Resultado</h3><pre className="whitespace-pre-wrap break-words text-xs">{r.result}</pre></>}
    </div>}
  </article>;
}
function Inbox({ pid, act, busy }: { pid: string; act: Act; busy: boolean }) {
  const { data: list = [] } = useCoreQuery(["auto-approvals", pid], (c) => approvals.pending(c.repo, pid));
  if (!list.length) return <p className="text-sm text-muted-foreground">No hay acciones esperando tu aprobación.</p>;
  return <section className="space-y-3">{list.map((a) => <article key={a.id} className="space-y-1 rounded-md border p-3 text-sm">
    <p className="font-medium break-words">{a.summary}</p>
    <p className="text-muted-foreground">Herramienta {a.tool} · riesgo {a.risk} · coste {a.cost_usd === null ? "desconocido" : `US$ ${a.cost_usd}`}</p>
    {a.target && <p className="break-all">Destino: {a.target}</p>}
    <details><summary className="cursor-pointer">Parámetros exactos</summary><pre className="whitespace-pre-wrap break-all text-xs">{a.params}</pre></details>
    <p className="text-xs text-muted-foreground">Si cambia cualquier parámetro, esta aprobación deja de valer.</p>
    <div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => act(async (c) => { await approvals.decide(c.repo, pid, a.id, true); const r = await afterApproval(c, pid, a.id); driveRun(c, pid, r.run_id); return r; }, "Aprobada")}><Check />Aprobar</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => act(async (c) => { await approvals.decide(c.repo, pid, a.id, false); return afterApproval(c, pid, a.id); })}><X />Rechazar</Button></div>
  </article>)}</section>;
}
function Nodes({ act, busy }: { act: Act; busy: boolean }) {
  const { data: list = [] } = useCoreQuery(["pc-nodes"], (c) => nodes.list(c.repo));
  const [host, setHost] = useState(""), [port, setPort] = useState(47820), [code, setCode] = useState(""), [fp, setFp] = useState(""), [qr, setQr] = useState("");
  useEffect(() => { if (!qr.trim().startsWith("{")) return; try { const j = JSON.parse(qr) as { hosts?: string[]; port?: number; fingerprint?: string; code?: string }; if (j.hosts?.[0]) setHost(j.hosts[0]); if (j.port) setPort(j.port); if (j.fingerprint) setFp(j.fingerprint); if (j.code) setCode(j.code); } catch { /* not QR JSON */ } }, [qr]);
  return <section className="space-y-4">
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <p>En la PC ejecuta <code>node miai-node.mjs --share CARPETA</code>. Pega el contenido del QR o escribe la dirección, el código y la huella que muestra.</p>
      <label className="block">Contenido del QR (opcional)<input className={inputCls} value={qr} onChange={(e) => setQr(e.target.value)} /></label>
      <div className="grid grid-cols-3 gap-2"><label className="col-span-2 block">Dirección<input className={inputCls} value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.20" /></label><label className="block">Puerto<input className={inputCls} type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} /></label></div>
      <div className="grid grid-cols-2 gap-2"><label className="block">Código<input className={inputCls} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></label><label className="block">Huella<input className={inputCls} value={fp} onChange={(e) => setFp(e.target.value)} placeholder="abcd-ef01-…" /></label></div>
      <Button disabled={busy || !host || !code || !fp} onClick={() => act((c) => pairNode(c.repo, { host: host.trim(), port, code: code.trim(), expectedFingerprint: fp }), "PC emparejada")}><Link2 />Emparejar</Button>
    </div>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => act((c) => heartbeat(c.repo))}><RefreshCw />Comprobar conexión</Button>
    {list.map((n) => { const info = JSON.parse(n.info || "{}") as Partial<NodeInfo>; return <article key={n.id} className="space-y-1 border-t py-3 text-sm">
      <h2 className="font-semibold">{n.name} <span className="font-normal text-muted-foreground">· {n.revoked ? "revocado" : n.status === "online" ? "conectado" : "desconectado"}</span></h2>
      <p className="text-muted-foreground">{n.host}:{n.port} · huella {n.fingerprint}</p>
      {info.cpus && <p>{info.os} · {info.cpus} CPU · RAM libre {gb(info.memFree)} de {gb(info.memTotal)} · GPU {info.gpu ?? "desconocida"} · aislamiento {info.isolation}</p>}
      {info.disks?.map((d) => <p key={d.index}>Carpeta «{d.name}»: {gb(d.freeBytes)} libres</p>)}
      {info.toolchains && <p className="break-words">Instalado: {Object.keys(info.toolchains).join(", ") || "nada detectado"}</p>}
      {!n.revoked && <Button size="sm" variant="outline" disabled={busy} onClick={() => { if (window.confirm("¿Revocar esta PC? Se cierran sus túneles y deja de poder usarse.")) act((c) => nodes.revoke(c.repo, n.id), "PC revocada"); }}>Revocar</Button>}
    </article>; })}
  </section>;
}
function Folders({ pid, act, busy }: { pid: string; act: Act; busy: boolean }) {
  const { data: list = [] } = useCoreQuery(["node-folders", pid], (c) => folders.list(c.repo, pid));
  const { data: nodeList = [] } = useCoreQuery(["pc-nodes"], (c) => nodes.list(c.repo));
  const [node, setNode] = useState(""), [idx, setIdx] = useState(0), [quota, setQuota] = useState(""), [view, setView] = useState<string | null>(null);
  const { data: listing } = useCoreQuery(["pc-files", pid, view], (c) => pcFiles.list(c.repo, pid, view!), !!view);
  const info = JSON.parse(nodeList.find((n) => n.id === node)?.info || "{}") as Partial<NodeInfo>;
  return <section className="space-y-4">
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <p>Solo las carpetas que la PC comparte explícitamente. Cada proyecto tiene su propio espacio; el disco completo nunca se comparte.</p>
      <label className="block">PC<select className={inputCls} value={node} onChange={(e) => setNode(e.target.value)}><option value="">Elegir</option>{nodeList.filter((n) => !n.revoked).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
      <label className="block">Carpeta compartida<select className={inputCls} value={idx} onChange={(e) => setIdx(Number(e.target.value))}>{(info.disks ?? [{ index: 0, name: "Carpeta 1" }]).map((d) => <option key={d.index} value={d.index}>{d.name}</option>)}</select></label>
      <label className="block">Cuota para este proyecto (MB, opcional)<input className={inputCls} inputMode="numeric" value={quota} onChange={(e) => setQuota(e.target.value)} /></label>
      <Button disabled={busy || !node} onClick={() => act((c) => folders.authorize(c.repo, pid, node, idx, quota ? Number(quota) * 2 ** 20 : null), "Carpeta autorizada")}><FolderPlus />Autorizar carpeta</Button>
    </div>
    {list.map((f) => <article key={f.id} className="space-y-1 border-t py-3 text-sm">
      <h2 className="font-semibold">{f.label}</h2><p className="text-muted-foreground">{nodeList.find((n) => n.id === f.node_id)?.name} · cuota {f.quota_bytes ? `${Math.round(f.quota_bytes / 2 ** 20)} MB` : "sin límite"}</p>
      <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setView(view === f.id ? null : f.id)}>Ver archivos</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => act((c) => pcFiles.reconcile(c.repo, pid, f.id), "Sincronización revisada")}><RefreshCw />Sincronizar</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => act((c) => folders.remove(c.repo, pid, f.id))}>Quitar</Button></div>
      {view === f.id && listing && <div>{!listing.online && <p className="text-destructive">PC desconectada: se muestran los datos guardados; los archivos no están disponibles ahora.</p>}<ul className="list-disc pl-5">{listing.files.slice(0, 200).map((x) => <li key={x.path} className="break-all">{x.path}{x.dir ? "/" : ""}{"state" in x ? ` · ${String((x as { state: string }).state)}` : ""}</li>)}</ul></div>}
    </article>)}
  </section>;
}
function Tunnels({ pid, act, busy }: { pid: string; act: Act; busy: boolean }) {
  const { data: list = [] } = useCoreQuery(["tunnels", pid], (c) => tunnels.list(c.repo, pid));
  const { data: nodeList = [] } = useCoreQuery(["pc-nodes"], (c) => nodes.list(c.repo));
  const { data: sshList = [] } = useCoreQuery(["connections", pid], (c) => connections.list(c.repo, pid));
  const [kind, setKind] = useState<keyof typeof TUNNEL_INFO>("pc.dev");
  const [node, setNode] = useState(""), [conn, setConn] = useState(""), [target, setTarget] = useState("127.0.0.1:5173"), [mins, setMins] = useState(30);
  const [remotePort, setRemotePort] = useState(8022), [allow, setAllow] = useState("127.0.0.1:5432"), [subnets, setSubnets] = useState("192.168.1.0/24");
  const info = tunnelKind(kind), viaPc = info.via === "pc";
  const ready = info.available && (viaPc ? !!node : !!conn);
  const describe = kind === "vpn" ? `VPN de ${mins} min solo hacia ${subnets}` : kind === "ssh.socks5" ? `SOCKS5 de ${mins} min solo hacia ${allow}` : kind === "pc.socks5" ? `SOCKS5 de ${mins} min en la PC` : kind === "ssh.reverse" ? `reenvío inverso de ${mins} min: puerto ${remotePort} del servidor → ${target}` : `túnel de ${mins} min hacia ${target}`;
  const open = () => act((c) => tunnels.open(c.repo, pid, { kind, nodeId: node || undefined, connectionId: conn || undefined, target, ttlMs: mins * 60_000, agent: "persona", remotePort, allow: allow.split(",").map((x) => x.trim()), subnets: subnets.split(",").map((x) => x.trim()) }), "Túnel abierto");
  return <section className="space-y-4">
    <div className="space-y-2 rounded-md border p-3 text-sm">
      <label className="block">Tipo<select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as keyof typeof TUNNEL_INFO)}>{Object.entries(TUNNEL_INFO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
      <p className="text-muted-foreground">{info.note}</p>
      {viaPc
        ? <label className="block">PC<select className={inputCls} value={node} onChange={(e) => setNode(e.target.value)}><option value="">Elegir</option>{nodeList.filter((n) => !n.revoked).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        : <label className="block">Servidor SSH (de Conexiones)<select className={inputCls} value={conn} onChange={(e) => setConn(e.target.value)}><option value="">Elegir</option>{sshList.filter((x) => x.kind === "ssh").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
      <div className="grid grid-cols-2 gap-2">
        {(kind === "pc.dev" || kind === "ssh.local" || kind === "ssh.reverse") && <label className="block">{kind === "ssh.reverse" ? "Servicio en el teléfono/red" : kind === "ssh.local" ? "Servicio visto desde el servidor" : "Destino permitido en la PC"}<input className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)} /></label>}
        {kind === "ssh.reverse" && <label className="block">Puerto en el servidor (≥1024)<input className={inputCls} type="number" min={1024} max={65535} value={remotePort} onChange={(e) => setRemotePort(Number(e.target.value))} /></label>}
        {kind === "ssh.socks5" && <label className="col-span-2 block">Destinos permitidos (host:puerto, separados por coma)<input className={inputCls} value={allow} onChange={(e) => setAllow(e.target.value)} /></label>}
        {kind === "vpn" && <label className="col-span-2 block">Subredes compartidas por la PC (coma)<input className={inputCls} value={subnets} onChange={(e) => setSubnets(e.target.value)} /></label>}
        <label className="block">Duración (min)<input className={inputCls} type="number" min={1} max={120} value={mins} onChange={(e) => setMins(Number(e.target.value))} /></label>
      </div>
      <Button disabled={busy || !ready} onClick={() => { if (window.confirm(`¿Abrir ${describe}? Se cerrará solo al vencer.`)) open(); }}><Cable />Abrir</Button>
    </div>
    {list.map((t) => { const cred = tunnelCredentials(t.id); return <article key={t.id} className="space-y-1 border-t py-3 text-sm">
      <p className="font-medium break-all">{TUNNEL_INFO[t.kind as keyof typeof TUNNEL_INFO]?.label ?? t.kind}: {t.target} → puerto {t.port ?? "—"} · {t.status}</p>
      <p className="text-muted-foreground">Por {t.agent} · {t.expires_at ? `vence ${new Date(t.expires_at).toLocaleTimeString()}` : ""}</p>
      {cred && t.status === "open" && <p className="break-all">Usuario SOCKS: <code>{cred.user}</code> · Clave: <code>{cred.pass}</code> (solo durante esta sesión)</p>}
      <details><summary className="cursor-pointer">Registro</summary><pre className="whitespace-pre-wrap text-xs">{(JSON.parse(t.log) as { at: number; event: string }[]).map((l) => `${new Date(l.at).toLocaleTimeString()} ${l.event}`).join("\n")}</pre></details>
      {t.status === "open" && <Button size="sm" variant="outline" disabled={busy} onClick={() => act((c) => tunnels.close(c.repo, pid, t.id))}>Cerrar</Button>}
    </article>; })}
  </section>;
}
function Tools({ pid }: { pid: string }) {
  const { data: report = [] } = useCoreQuery(["tool-report", pid], (c) => availabilityReport({ core: c, projectId: pid, runId: "", taskId: null, agent: "coordinator" }));
  return <ul className="space-y-1 text-sm">{report.map((t) => <li key={t.id} className="break-words"><b>{t.name}</b> <span className="text-muted-foreground">({t.family} · riesgo {t.risk}{t.approval === "always" ? " · pide aprobación" : ""})</span> — {t.ok ? "disponible" : `no disponible: ${t.reason}`}</li>)}</ul>;
}

function PhoneFiles({ pid }: { pid: string }) {
  const { data: files = [] } = useCoreQuery(["local-ws", pid], (c) => localWs.list(c.repo, pid));
  const [view, setView] = useState<{ path: string; text: string } | null>(null);
  const total = files.reduce((a, f) => a + f.size, 0);
  const exportZip = async () => {
    if (!confirm("¿Exportar una copia sin cifrar de los archivos del teléfono?")) return;
    try {
      const c = await (await import("@/lib/core")).getCore();
      const entries = []; for (const f of files) entries.push({ path: f.path, data: new TextEncoder().encode((await localWs.read(c.repo, pid, f.path)).text) });
      await saveExport(zipStore(entries), "espacio-del-proyecto.zip", "application/zip");
    } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo exportar."); }
  };
  return <section className="space-y-3">
    <p className="text-sm text-muted-foreground">Archivos que los agentes crean cuando trabajan en el teléfono. Se guardan cifrados dentro del proyecto. {files.length} archivos · {(total / 1024).toFixed(1)} KB</p>
    {files.length > 0 && <Button size="sm" variant="outline" onClick={exportZip}><Package />Exportar ZIP</Button>}
    {files.length > 0 && <ul className="divide-y rounded-md border">{files.map((f) => <li key={f.path}><button className="flex w-full items-center gap-2 p-2 text-left text-sm" onClick={async () => { const c = await (await import("@/lib/core")).getCore(); setView({ path: f.path, text: (await localWs.read(c.repo, pid, f.path)).text }); }}><span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span><span className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</span></button></li>)}</ul>}
    {!files.length && <p className="text-sm text-muted-foreground">Aún no hay archivos.</p>}
    {view && <div className="space-y-2 rounded-md border p-3"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate font-mono text-xs">{view.path}</p><Button size="sm" variant="ghost" onClick={() => setView(null)}><X />Cerrar</Button></div><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{view.text}</pre></div>}
  </section>;
}
