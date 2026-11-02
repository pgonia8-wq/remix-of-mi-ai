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

// ---------- Adaptive tutor: a learner model per concept that adjusts difficulty and focus ----------
export type Progress = { project_id: string; topic: string; concept: string; mastery: number; level: number; attempts: number; correct: number; streak: number; updated_at: number };
export type TutorQ = QuizQ & { concept: string; hint: string; level: number };

/** Mastery moves toward 1 on correct answers and toward 0 on mistakes; harder questions weigh more when right,
 * easier ones weigh more when wrong (Elo-like). Level 1–5 follows mastery, with streaks speeding it up. */
export function updateMastery(p: Pick<Progress, "mastery" | "level" | "streak">, correct: boolean, usedHint = false) {
  const diff = (p.level - 1) / 4, k = 0.35;
  const expected = 1 / (1 + Math.exp(-6 * (p.mastery - diff)));
  const score = correct ? (usedHint ? 0.6 : 1) : 0;
  const mastery = Math.min(1, Math.max(0, p.mastery + k * (score - expected)));
  const streak = correct ? Math.max(1, p.streak + 1) : Math.min(-1, p.streak - 1);
  let level = Math.round(1 + mastery * 4);
  if (streak >= 3) level = Math.min(5, Math.max(level, p.level + 1));
  if (streak <= -2) level = Math.max(1, Math.min(level, p.level - 1));
  return { mastery: Math.round(mastery * 1000) / 1000, level: Math.min(5, Math.max(1, level)), streak };
}
/** Next concept to practice: the weakest one, avoiding repeating the very last concept when there are others. */
export function pickConcept(list: Pick<Progress, "concept" | "mastery" | "updated_at">[], last?: string) {
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a.mastery - b.mastery || a.updated_at - b.updated_at);
  return (sorted.find((x) => x.concept !== last) ?? sorted[0]!).concept;
}
export function validateTutorQ(raw: unknown, level: number): TutorQ {
  const [q] = validateQuiz([raw]);
  const r = raw as { concept?: unknown; hint?: unknown };
  const concept = String(r?.concept ?? "").trim().slice(0, 80);
  if (!concept) throw new Error("El modelo no indicó el concepto.");
  return { ...q!, concept, hint: String(r?.hint ?? "").slice(0, 400), level };
}
export const progress = {
  list: (db: SqlDb, projectId: string, topic: string) => { need(projectId); return db.all<Progress>(`SELECT * FROM study_progress WHERE project_id=? AND topic=? ORDER BY mastery`, [projectId, topic]); },
  topics: (db: SqlDb, projectId: string) => { need(projectId); return db.all<{ topic: string; mastery: number; concepts: number }>(`SELECT topic, AVG(mastery) AS mastery, COUNT(*) AS concepts FROM study_progress WHERE project_id=? GROUP BY topic ORDER BY MAX(updated_at) DESC`, [projectId]); },
  async seed(db: SqlDb, projectId: string, topic: string, concepts: string[], level = 2) {
    need(projectId);
    for (const c of concepts.slice(0, 12)) await db.run(`INSERT OR IGNORE INTO study_progress VALUES (?,?,?,?,?,0,0,0,?)`, [projectId, topic, c.trim().slice(0, 80), (level - 1) / 4, level, Date.now()]);
  },
  async record(db: SqlDb, projectId: string, topic: string, concept: string, correct: boolean, usedHint = false) {
    need(projectId);
    const [cur] = await db.all<Progress>(`SELECT * FROM study_progress WHERE project_id=? AND topic=? AND concept=?`, [projectId, topic, concept]);
    const base = cur ?? { mastery: 0.25, level: 2, streak: 0, attempts: 0, correct: 0 };
    const n = updateMastery(base, correct, usedHint);
    await db.run(`INSERT OR REPLACE INTO study_progress VALUES (?,?,?,?,?,?,?,?,?)`, [projectId, topic, concept, n.mastery, n.level, base.attempts + 1, base.correct + (correct ? 1 : 0), n.streak, Date.now()]);
    return n;
  },
};
