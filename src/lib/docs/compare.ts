// Local document comparison (no model): line-level diff with word-level detail and summary counts.
import { diffLines, diffWordsWithSpace } from "diff";

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };
export type Comparison = { parts: DiffPart[]; added: number; removed: number; unchanged: number; similarity: number };

export function compareTexts(a: string, b: string, granularity: "lines" | "words" = "lines"): Comparison {
  const raw = granularity === "lines" ? diffLines(a, b) : diffWordsWithSpace(a, b);
  const parts: DiffPart[] = raw.map((p) => ({ kind: p.added ? "added" : p.removed ? "removed" : "same", text: p.value }));
  const count = (k: DiffPart["kind"]) => parts.filter((p) => p.kind === k).reduce((n, p) => n + (granularity === "lines" ? p.text.split("\n").filter(Boolean).length : p.text.trim().split(/\s+/).filter(Boolean).length), 0);
  const added = count("added"), removed = count("removed"), unchanged = count("same");
  const total = unchanged + Math.max(added, removed);
  return { parts, added, removed, unchanged, similarity: total ? Math.round((unchanged / total) * 100) : 100 };
}

/** Markdown report usable by export (PDF/DOCX). */
export function comparisonMarkdown(nameA: string, nameB: string, c: Comparison) {
  const lines = [`# Comparación: ${nameA} vs ${nameB}`, "", `Similitud: ${c.similarity}% · Añadidas: ${c.added} · Eliminadas: ${c.removed} · Sin cambios: ${c.unchanged}`, ""];
  for (const p of c.parts) {
    if (p.kind === "same") continue;
    for (const l of p.text.split("\n").filter((x) => x.trim())) lines.push(`- ${p.kind === "added" ? "**Añadido:**" : "~~Eliminado:~~"} ${l.trim()}`);
  }
  return lines.join("\n");
}
