import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { useActiveProjectId, useCoreMutate } from "@/lib/use-app";
import { getCore } from "@/lib/core";
import { runResearch, type ResearchResult } from "@/lib/core/research";
import { exportDoc, EXPORT_MIME, type ExportFormat } from "@/lib/docs/export";
import { saveExport } from "@/lib/save-export";
import { NeedProject, inputCls } from "@/components/AppShell";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/research")({
  head: () => ({
    meta: [
      { title: "Investigar — MI AI" },
      { name: "description", content: "Investigación en internet con fuentes numeradas, usando tu propio buscador y modelo." },
      { property: "og:title", content: "Investigar — MI AI" },
      { property: "og:description", content: "Informes con citas verificables, guardados cifrados por proyecto." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Research,
});

function Research() {
  const pid = useActiveProjectId();
  const mutate = useCoreMutate();
  const [q, setQ] = useState("");
  const [deep, setDeep] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [res, setRes] = useState<ResearchResult | null>(null);
  if (!pid) return <NeedProject />;
  async function run() {
    if (!pid || !q.trim()) return;
    setRes(null); setStep("Iniciando…");
    try {
      const c = await getCore();
      setRes(await runResearch(c, pid, q.trim(), { deep, onStep: setStep }));
      await mutate(async () => undefined);
    } catch (e) { toast.error((e as Error).message); } finally { setStep(null); }
  }
  async function exp(f: ExportFormat) {
    if (!res) return;
    try { await saveExport(await exportDoc(`# ${q}\n\n${res.report}`, f, q), `investigacion-${q.slice(0, 40).replace(/[^\w-]+/g, "_")}.${f}`, EXPORT_MIME[f]); }
    catch (e) { toast.error((e as Error).message); }
  }
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-bold">Investigar</h1>
      <section className="space-y-2 rounded-xl border bg-card p-3">
        <textarea className={inputCls} rows={3} placeholder="¿Qué quieres investigar?" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} /> Investigación profunda (varias búsquedas; más costo)</label>
        <Button className="w-full" disabled={!!step || !q.trim()} onClick={run}><Search />{step ? "Investigando…" : "Investigar"}</Button>
        <p className="text-xs text-muted-foreground">Buscador: <Link to="/models" className="underline">SearXNG</Link> · Síntesis: tu modelo de chat.</p>
      </section>
      {step && <p className="text-xs text-primary">{step}</p>}
      {res && (
        <section className="space-y-2 rounded-xl border bg-card p-3">
          {res.invalidCitations.length > 0 && <p className="rounded-md bg-destructive/15 p-2 text-xs text-destructive">Atención: el informe cita fuentes inexistentes ({res.invalidCitations.map((n) => `[${n}]`).join(", ")}). Verifica esas afirmaciones.</p>}
          <Markdown text={res.report} />
          <div className="space-y-1 border-t pt-2">
            {res.sources.map((s, i) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer noopener" className="block truncate text-xs text-primary underline">[{i + 1}] {s.title}{s.read ? " · leída" : ""}</a>)}
          </div>
          <p className="text-[10px] text-muted-foreground">Búsquedas ({res.rounds} {res.rounds > 1 ? "rondas" : "ronda"}): {res.queries.join(" · ")}. {res.sources.filter((x) => x.read).length} páginas leídas completas. Guardado cifrado en la Biblioteca con la etiqueta «investigación».</p>
          <div className="grid grid-cols-5 gap-1">{(["pdf", "docx", "odt", "rtf", "md"] as const).map((f) => <Button key={f} size="sm" variant="outline" onClick={() => exp(f)}>{f.toUpperCase()}</Button>)}</div>
        </section>
      )}
    </div>
  );
}
