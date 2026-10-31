// Study mode: quizzes, flashcards with spaced repetition (SM-2), explanations and study plans.
import type { SqlDb } from "../db/sql";

export type QuizQ = { question: string; options: string[]; answer: number; explanation: string };
export type Card = { id: string; project_id: string; deck: string; front: string; back: string; ease: number; interval_days: number; reps: number; due_at: number; created_at: number };

export function validateQuiz(raw: unknown): QuizQ[] {
  const arr = Array.isArray(raw) ? raw : (raw as { questions?: unknown[] })?.questions;
  if (!Array.isArray(arr)) throw new Error("Cuestionario inválido.");
  const qs = arr.map((q: any) => ({ question: String(q?.question ?? "").trim(), options: Array.isArray(q?.options) ? q.options.map(String) : [], answer: Number(q?.answer), explanation: String(q?.explanation ?? "") }))
    .filter((q) => q.question && q.options.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
  if (!qs.length) throw new Error("El modelo no generó preguntas válidas. Intenta de nuevo.");
  return qs;
}

export function validateCards(raw: unknown): { front: string; back: string }[] {
  const arr = Array.isArray(raw) ? raw : (raw as { cards?: unknown[] })?.cards;
  if (!Array.isArray(arr)) throw new Error("Tarjetas inválidas.");
  const cs = arr.map((c: any) => ({ front: String(c?.front ?? "").trim(), back: String(c?.back ?? "").trim() })).filter((c) => c.front && c.back);
  if (!cs.length) throw new Error("El modelo no generó tarjetas válidas.");
  return cs;
}

const DAY = 86_400_000;
/** SM-2: grade 0 (otra vez) · 3 (difícil) · 4 (bien) · 5 (fácil). */
export function schedule(c: Pick<Card, "ease" | "interval_days" | "reps">, grade: 0 | 3 | 4 | 5, now = Date.now()) {
  if (grade < 3) return { ease: Math.max(1.3, c.ease - 0.2), interval_days: 0, reps: 0, due_at: now + 10 * 60_000 };
  const reps = c.reps + 1;
  const ease = Math.max(1.3, c.ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  const interval_days = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(c.interval_days * ease);
  return { ease, interval_days, reps, due_at: now + interval_days * DAY };
}

const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
export const cards = {
  async add(db: SqlDb, projectId: string, deck: string, list: { front: string; back: string }[]) {
    need(projectId);
    for (const c of list) await db.run(`INSERT INTO flashcards (id, project_id, deck, front, back, due_at, created_at) VALUES (?,?,?,?,?,?,?)`, [crypto.randomUUID(), projectId, deck, c.front, c.back, Date.now(), Date.now()]);
  },
  due: (db: SqlDb, projectId: string, deck?: string) => { need(projectId); return db.all<Card>(`SELECT * FROM flashcards WHERE project_id=? AND due_at<=? ${deck ? "AND deck=?" : ""} ORDER BY due_at LIMIT 50`, deck ? [projectId, Date.now(), deck] : [projectId, Date.now()]); },
  decks: (db: SqlDb, projectId: string) => { need(projectId); return db.all<{ deck: string; total: number; due: number }>(`SELECT deck, COUNT(*) AS total, SUM(CASE WHEN due_at<=? THEN 1 ELSE 0 END) AS due FROM flashcards WHERE project_id=? GROUP BY deck ORDER BY deck`, [Date.now(), projectId]); },
  async grade(db: SqlDb, projectId: string, c: Card, g: 0 | 3 | 4 | 5) {
    need(projectId);
    const n = schedule(c, g);
    await db.run(`UPDATE flashcards SET ease=?, interval_days=?, reps=?, due_at=? WHERE id=? AND project_id=?`, [n.ease, n.interval_days, n.reps, n.due_at, c.id, projectId]);
  },
  removeDeck: (db: SqlDb, projectId: string, deck: string) => { need(projectId); return db.run(`DELETE FROM flashcards WHERE project_id=? AND deck=?`, [projectId, deck]); },
};
