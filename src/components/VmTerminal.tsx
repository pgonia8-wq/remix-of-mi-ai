import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, TerminalSquare } from "lucide-react";
import { getCore } from "@/lib/core";
import { ROLES, type Role } from "@/lib/automation/orchestrator";
import type { RemoteEntry } from "@/lib/automation/remote-activity";

const STATE: Record<RemoteEntry["state"], string> = { waiting: "espera tu aprobación", running: "ejecutándose…", ok: "terminado", failed: "terminó con error", uncertain: "sin confirmar", rejected: "no se ejecutó" };
const COLOR: Record<RemoteEntry["state"], string> = { waiting: "text-warning", running: "text-primary", ok: "text-success", failed: "text-destructive", uncertain: "text-warning", rejected: "text-muted-foreground" };
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Live terminal-style feed of what agents run on a VM/server/PC. Refreshes on its own. */
export function VmTerminal({ pid, runId, title = "Terminal de la VM" }: { pid: string; runId?: string; title?: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["core", "vm-terminal", pid, runId ?? "all"],
    queryFn: async () => { const { remoteActivity } = await import("@/lib/automation/remote-activity"); return remoteActivity((await getCore()).repo, pid, runId); },
    refetchInterval: (q) => (q.state.data ?? []).some((e) => e.state === "running" || e.state === "waiting") ? 2000 : 5000,
  });
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [data.length]);
  const live = data.some((e) => e.state === "running");
  return <section aria-label={title} className="space-y-2">
    <h3 className="flex items-center gap-2 text-sm font-semibold"><TerminalSquare className="h-4 w-4" />{title}{live && <Loader2 className="h-3 w-3 animate-spin text-primary" />}</h3>
    <div role="log" aria-live="polite" className="max-h-96 overflow-auto rounded-xl border bg-muted p-3 font-mono text-[11px] leading-relaxed">
      {isLoading ? <p className="text-muted-foreground">Cargando…</p> : !data.length ? <p className="text-muted-foreground">Todavía ningún agente ejecutó comandos en una VM, servidor o PC.</p> :
        data.map((e) => <div key={e.id} className="mb-3 break-words">
          <p className="text-muted-foreground">[{time(e.at)}] {e.agent ? (ROLES[e.agent as Role]?.name ?? e.agent) : "agente"} → {e.target} · <span className={COLOR[e.state]}>{STATE[e.state]}{e.exitCode !== null ? ` (código ${e.exitCode})` : ""}</span>{e.ms ? ` · ${(e.ms / 1000).toFixed(1)} s` : ""}</p>
          {e.command && <p className="whitespace-pre-wrap text-foreground"><span className="text-primary">$ </span>{e.command}</p>}
          {e.output && <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap text-foreground/80">{e.output.slice(-4000)}</pre>}
        </div>)}
      <div ref={end} />
    </div>
  </section>;
}
