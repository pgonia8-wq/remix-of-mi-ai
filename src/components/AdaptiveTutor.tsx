import { useState } from "react";
import { Lightbulb, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { inputCls } from "./AppShell";
import { getCore } from "@/lib/core";
import { askModel, extractJson } from "@/lib/core/ai";
import { useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { pickConcept, progress, validateTutorQ, type TutorQ } from "@/lib/core/study";

const LEVEL_TXT = ["", "muy básica", "básica", "intermedia", "avanzada", "experta"];

/** One question at a time: harder when you get it right, simpler with an explanation when you miss, always on the weakest concept. */
export function AdaptiveTutor({ pid, material }: { pid: string; material: string }) {
  const [topic, setTopic] = useState(""), [active, setActive] = useState(""), [q, setQ] = useState<TutorQ | null>(null);
  const [picked, setPicked] = useState<number | null>(null), [hint, setHint] = useState(false), [busy, setBusy] = useState(false), [coach, setCoach] = useState("");
  const mutate = useCoreMutate();
  const { data: topics = [] } = useCoreQuery(["tutor-topics", pid], (c) => progress.topics(c.repo.sql, pid));
  const { data: concepts = [] } = useCoreQuery(["tutor-concepts", pid, active], (c) => progress.list(c.repo.sql, pid, active), !!active);
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); } };

  async function next(t: string, last?: string, missed?: { q: TutorQ; chosen: string }) {
    const c = await getCore();
    let list = await progress.list(c.repo.sql, pid, t);
    if (!list.length) {
      const r = await askModel(c, pid, `Lista de 4 a 8 conceptos clave, de lo básico a lo avanzado, para aprender «${t}». Devuelve solo JSON {"concepts":["..."]}.${material}`);
      const cs = (extractJson<{ concepts: string[] }>(r.text).concepts ?? []).filter((x) => typeof x === "string" && x.trim());
      if (!cs.length) throw new Error("No se pudieron identificar conceptos del tema.");
      await progress.seed(c.repo.sql, pid, t, cs); list = await progress.list(c.repo.sql, pid, t);
    }
    // After a miss, stay on the same concept one level easier; otherwise practice the weakest concept.
    const concept = missed ? missed.q.concept : pickConcept(list, last)!;
    const cur = list.find((x) => x.concept === concept), level = Math.max(1, cur?.level ?? 2);
    const r = await askModel(c, pid, `Eres un tutor paciente. Tema «${t}». Crea UNA pregunta de opción múltiple de dificultad ${LEVEL_TXT[level]} (nivel ${level}/5) sobre el concepto «${concept}».${missed ? ` La persona acaba de fallar «${missed.q.question}» eligiendo «${missed.chosen}»: aborda ese malentendido con una pregunta más sencilla.` : ""} Devuelve solo JSON {"concept":"${concept}","question":"...","options":["a","b","c","d"],"answer":0,"explanation":"explicación clara con un ejemplo","hint":"pista que no revele la respuesta"}.${material}`);
    setQ(validateTutorQ(extractJson(r.text), level)); setPicked(null); setHint(false);
  }
  async function answer(i: number) {
    if (!q || picked !== null) return;
    setPicked(i);
    const ok = i === q.answer;
    const n = await mutate((c) => progress.record(c.repo.sql, pid, active, q.concept, ok, hint));
    setCoach(ok ? (n.level > q.level ? "¡Bien! Subimos la dificultad." : "¡Correcto!") : "No pasa nada: te explico y practicamos lo mismo más sencillo.");
  }

  return <div className="space-y-3">
    {!active ? <section className="space-y-2 rounded-xl border bg-card p-3">
      <input className={inputCls} aria-label="Tema del tutor" placeholder="¿Qué quieres aprender? (p. ej. fracciones, SQL, anatomía)" value={topic} onChange={(e) => setTopic(e.target.value)} />
      <Button className="w-full" disabled={busy || !topic.trim()} onClick={() => run(async () => { const t = topic.trim(); setActive(t); await next(t); })}><Sparkles />{busy ? "Preparando…" : "Empezar con el tutor"}</Button>
      {topics.length > 0 && <div className="space-y-1 pt-1"><p className="text-xs text-muted-foreground">Continuar donde te quedaste:</p>{topics.map((t) => <button key={t.topic} className="flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs" onClick={() => void run(async () => { setActive(t.topic); await next(t.topic); })}><span className="flex-1 truncate">{t.topic}</span><span>{Math.round(t.mastery * 100)} % dominado</span></button>)}</div>}
    </section> : <>
      <div className="flex items-center gap-2"><p className="flex-1 truncate font-medium">{active}</p><Button size="sm" variant="ghost" onClick={() => { setActive(""); setQ(null); }}>Cambiar tema</Button></div>
      <div className="grid grid-cols-2 gap-1">{concepts.map((c) => <div key={c.concept} className="rounded-md border p-1.5 text-[11px]"><div className="flex justify-between gap-1"><span className="truncate">{c.concept}</span><span>N{c.level}</span></div><div className="mt-1 h-1.5 rounded bg-muted"><div className="h-1.5 rounded bg-primary" style={{ width: `${Math.round(c.mastery * 100)}%` }} /></div></div>)}</div>
      {q && <section className="space-y-2 rounded-xl border bg-card p-3 text-sm">
        <p className="text-xs text-muted-foreground">{q.concept} · dificultad {q.level}/5</p>
        <p className="font-medium">{q.question}</p>
        {q.options.map((o, j) => { const show = picked !== null, right = j === q.answer; return <button key={j} disabled={show || busy} onClick={() => void answer(j)} className={`flex w-full rounded-lg border px-2 py-1.5 text-left text-xs ${show && right ? "border-primary bg-primary/15" : show && picked === j ? "border-destructive bg-destructive/10" : ""}`}>{o}</button>; })}
        {picked === null && q.hint && !hint && <Button size="sm" variant="ghost" onClick={() => setHint(true)}><Lightbulb />Ver pista</Button>}
        {hint && picked === null && <p className="text-xs text-muted-foreground">Pista: {q.hint}</p>}
        {picked !== null && <><p className="text-xs font-medium text-primary">{coach}</p><p className="text-xs text-muted-foreground">{q.explanation}</p>
          <Button size="sm" disabled={busy} onClick={() => run(() => next(active, q.concept, picked === q.answer ? undefined : { q, chosen: q.options[picked]! }))}>{busy ? "Preparando…" : "Siguiente pregunta"}</Button></>}
      </section>}
    </>}
  </div>;
}
