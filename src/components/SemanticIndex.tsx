import { useState } from "react";
import { Brain } from "lucide-react";
import { toast } from "sonner";
import { useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { getCore } from "@/lib/core";
import { indexProject, indexStats, searchProject, type Hit } from "@/lib/core/semantic";
import { inputCls } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

/** Builds/uses the project's semantic index (documents, memory, notes, chats) with the user's embedding model. */
export function SemanticIndex({ pid }: { pid: string }) {
  const mutate = useCoreMutate();
  const { data: stats = [] } = useCoreQuery(["emb-stats", pid], (c) => indexStats(c.repo.sql, pid));
  const [progress, setProgress] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const total = stats.reduce((n, s) => n + s.n, 0);
  async function index() {
    setProgress("Preparando…");
    try {
      const r = await indexProject(await getCore(), pid, (d, t) => setProgress(`Indexando ${d}/${t} fragmentos…`));
      toast.success(r.added ? `${r.added} fragmentos nuevos indexados con ${r.model}` : "El índice ya estaba al día");
      await mutate(async () => undefined);
    } catch (e) { toast.error((e as Error).message); } finally { setProgress(null); }
  }
  async function search() {
    try { setHits(await searchProject(await getCore(), pid, q, 8)); } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <section className="mb-3 space-y-2 rounded-xl border bg-card p-3 text-sm">
      <div className="flex items-center gap-2"><Brain className="h-4 w-4 text-primary" /><span className="flex-1 font-semibold">Memoria inteligente</span><span className="text-xs text-muted-foreground">{total} fragmentos</span></div>
      <p className="text-[10px] text-muted-foreground">Busca por significado en documentos, memoria, notas y chats. Requiere un modelo con «embedding». Los textos se envían a ese modelo al indexar; los vectores se guardan cifrados en el teléfono. El chat los usa automáticamente.</p>
      <Button size="sm" variant="outline" className="w-full" disabled={!!progress} onClick={index}>{progress ?? "Actualizar índice"}</Button>
      {total > 0 && <div className="flex gap-2"><input className={inputCls} placeholder="Buscar por significado" value={q} onChange={(e) => setQ(e.target.value)} /><Button size="sm" disabled={!q.trim()} onClick={search}>Buscar</Button></div>}
      {hits && (hits.length ? hits.map((h, i) => <p key={i} className="rounded-md bg-secondary/50 p-2 text-xs"><b>{h.source_type}</b> · {(h.score * 100).toFixed(0)}% — {h.text.slice(0, 240)}</p>) : <p className="text-xs text-muted-foreground">Sin resultados.</p>)}
    </section>
  );
}
