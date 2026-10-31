import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { BookOpen, Check, GraduationCap, Layers, ListTodo, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useActiveProjectId, useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { getCore } from "@/lib/core";
import { askModel, clipSource, extractJson } from "@/lib/core/ai";
import { cards, validateCards, validateQuiz, type Card, type QuizQ } from "@/lib/core/study";
import { NeedProject, inputCls } from "@/components/AppShell";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/study")({
  head: () => ({
    meta: [
      { title: "Estudiar — MI AI" },
      { name: "description", content: "Explicaciones paso a paso, cuestionarios, tarjetas de repaso espaciado y planes de estudio." },
      { property: "og:title", content: "Estudiar — MI AI" },
      { property: "og:description", content: "Aprende cualquier tema o documento con tus propios modelos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Study,
});

type Mode = "explain" | "quiz" | "cards" | "plan" | "review";
const LEVELS = ["Primaria", "Secundaria", "Preparatoria", "Universidad", "Profesional"];

function Study() {
  const pid = useActiveProjectId();
  const [mode, setMode] = useState<Mode>("explain");
  const [topic, setTopic] = useState("");
  const [docId, setDocId] = useState("");
  const [level, setLevel] = useState("Preparatoria");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<QuizQ[] | null>(null);
  const mutate = useCoreMutate();
  const { data: docs = [] } = useCoreQuery(["docs", pid], (c) => c.repo.listDocs(pid!), !!pid);
  if (!pid) return <NeedProject />;

  async function run() {
    const doc = docs.find((d) => d.id === docId);
    if (!topic.trim() && !doc) { toast.error("Escribe un tema o elige un documento."); return; }
    const subject = `${topic.trim() ? `Tema: ${topic.trim()}` : ""}${doc?.text_content ? `\nMaterial «${doc.name}»:\n"""\n${clipSource(doc.text_content, 40_000)}\n"""` : ""}\nNivel: ${level}. Responde en español.`;
    setBusy(true); setText(null); setQuiz(null);
    try {
      const c = await getCore();
      if (mode === "explain") setText((await askModel(c, pid!, `Explica paso a paso, con ejemplos sencillos, analogías y un resumen final de 3 puntos.\n${subject}`, { save: { name: `Explicación — ${topic || doc?.name}.md` } })).text);
      if (mode === "plan") setText((await askModel(c, pid!, `Crea un plan de estudio semanal en Markdown con una tabla Semana | Objetivos | Actividades | Evaluación, y consejos de estudio.\n${subject}`, { save: { name: `Plan — ${topic || doc?.name}.md` } })).text);
      if (mode === "quiz") {
        const r = await askModel(c, pid!, `Crea un cuestionario de 8 preguntas de opción múltiple. Devuelve solo JSON: {"questions":[{"question":"...","options":["a","b","c","d"],"answer":0,"explanation":"..."}]} donde answer es el índice de la opción correcta.\n${subject}`);
        setQuiz(validateQuiz(extractJson(r.text)));
      }
      if (mode === "cards") {
        const r = await askModel(c, pid!, `Crea 15 tarjetas de estudio (pregunta breve al frente, respuesta concisa atrás). Devuelve solo JSON: {"cards":[{"front":"...","back":"..."}]}\n${subject}`);
        const list = validateCards(extractJson(r.text));
        const deck = (topic.trim() || doc?.name || "General").slice(0, 60);
        await cards.add(c.repo.sql, pid!, deck, list);
        await mutate(async () => undefined);
        toast.success(`${list.length} tarjetas en el mazo «${deck}». Repásalas en «Repasar».`);
        setMode("review");
      }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  const MODES: { id: Mode; label: string; icon: typeof BookOpen }[] = [
    { id: "explain", label: "Explicar", icon: BookOpen }, { id: "quiz", label: "Cuestionario", icon: GraduationCap },
    { id: "cards", label: "Tarjetas", icon: Layers }, { id: "plan", label: "Plan", icon: ListTodo }, { id: "review", label: "Repasar", icon: Check },
  ];
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-2xl font-bold">Estudiar</h1>
      <div className="flex flex-wrap gap-1">{MODES.map(({ id, label, icon: I }) => <button key={id} onClick={() => setMode(id)} className={`flex flex-1 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs ${mode === id ? "border-primary bg-primary text-primary-foreground" : ""}`}><I className="h-3.5 w-3.5" />{label}</button>)}</div>
      {mode === "review" ? <Review pid={pid} /> : (
        <section className="space-y-2 rounded-xl border bg-card p-3">
          <input className={inputCls} placeholder="Tema (p. ej. fotosíntesis, derivadas, Revolución Mexicana)" value={topic} onChange={(e) => setTopic(e.target.value)} />
          <div className="flex gap-2">
            <select aria-label="Documento" className={inputCls} value={docId} onChange={(e) => setDocId(e.target.value)}><option value="">Sin documento</option>{docs.filter((d) => d.text_content).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            <select aria-label="Nivel" className={inputCls + " w-36"} value={level} onChange={(e) => setLevel(e.target.value)}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
          </div>
          <Button className="w-full" disabled={busy} onClick={run}>{busy ? "Preparando…" : "Generar"}</Button>
        </section>
      )}
      {text && <section className="rounded-xl border bg-card p-3"><Markdown text={text} /></section>}
      {quiz && <Quiz qs={quiz} />}
    </div>
  );
}

function Quiz({ qs }: { qs: QuizQ[] }) {
  const [answers, setAnswers] = useState<(number | null)[]>(() => qs.map(() => null));
  const done = answers.every((a) => a !== null);
  const score = answers.filter((a, i) => a === qs[i]!.answer).length;
  return (
    <section className="space-y-3">
      {qs.map((q, i) => (
        <div key={i} className="space-y-1 rounded-xl border bg-card p-3 text-sm">
          <p className="font-medium">{i + 1}. {q.question}</p>
          {q.options.map((o, j) => {
            const picked = answers[i] === j, show = answers[i] !== null, right = j === q.answer;
            return <button key={j} disabled={show} onClick={() => setAnswers(answers.map((a, k) => (k === i ? j : a)))} className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs ${show && right ? "border-primary bg-primary/15" : show && picked ? "border-destructive bg-destructive/15" : ""}`}>{show && right ? <Check className="h-3 w-3" /> : show && picked ? <X className="h-3 w-3" /> : null}{o}</button>;
          })}
          {answers[i] !== null && <p className="text-xs text-muted-foreground">{q.explanation}</p>}
        </div>
      ))}
      {done && <p className="rounded-xl border bg-card p-3 text-center font-semibold">Resultado: {score}/{qs.length}</p>}
    </section>
  );
}

function Review({ pid }: { pid: string }) {
  const mutate = useCoreMutate();
  const [deck, setDeck] = useState("");
  const { data: decks = [] } = useCoreQuery(["decks", pid], (c) => cards.decks(c.repo.sql, pid));
  const { data: due = [] } = useCoreQuery(["due", pid, deck], (c) => cards.due(c.repo.sql, pid, deck || undefined));
  const [flip, setFlip] = useState(false);
  const card: Card | undefined = due[0];
  async function grade(g: 0 | 3 | 4 | 5) { if (!card) return; setFlip(false); await mutate((c) => cards.grade(c.repo.sql, pid, card, g)); }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        <button onClick={() => setDeck("")} className={`rounded-full border px-2 py-0.5 text-xs ${!deck ? "border-primary bg-primary text-primary-foreground" : ""}`}>Todos</button>
        {decks.map((d) => <span key={d.deck} className="flex items-center gap-1"><button onClick={() => setDeck(d.deck)} className={`rounded-full border px-2 py-0.5 text-xs ${deck === d.deck ? "border-primary bg-primary text-primary-foreground" : ""}`}>{d.deck} · {d.due}/{d.total}</button>
          <button aria-label={`Eliminar mazo ${d.deck}`} onClick={() => confirm(`¿Eliminar el mazo «${d.deck}»?`) && mutate((c) => cards.removeDeck(c.repo.sql, pid, d.deck))}><Trash2 className="h-3 w-3 text-muted-foreground" /></button></span>)}
      </div>
      {!card ? <p className="text-center text-sm text-muted-foreground">{decks.length ? "¡Al día! No hay tarjetas pendientes." : "Aún no hay tarjetas. Créalas en «Tarjetas»."}</p> : (
        <div className="space-y-3">
          <button onClick={() => setFlip(!flip)} className="flex min-h-48 w-full items-center justify-center rounded-xl border bg-card p-4 text-center">
            <span className="whitespace-pre-wrap text-base">{flip ? card.back : card.front}</span>
          </button>
          <p className="text-center text-[10px] text-muted-foreground">{flip ? "¿Qué tan bien la recordaste?" : "Toca la tarjeta para ver la respuesta"} · {due.length} pendientes</p>
          {flip && <div className="grid grid-cols-4 gap-1">{([[0, "Otra vez"], [3, "Difícil"], [4, "Bien"], [5, "Fácil"]] as const).map(([g, l]) => <Button key={g} size="sm" variant={g === 0 ? "destructive" : "outline"} onClick={() => grade(g)}>{l}</Button>)}</div>}
        </div>
      )}
    </div>
  );
}
