import { parseMarkdown } from "@/lib/docs/markdown";

/** Safe Markdown preview (no HTML injection): headings, paragraphs, lists, tables. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm">
      {parseMarkdown(text).map((b, i) =>
        b.t === "h" ? <p key={i} className={b.level === 1 ? "text-lg font-bold" : b.level === 2 ? "text-base font-semibold" : "font-semibold"}>{b.text}</p>
        : b.t === "p" ? <p key={i} className="whitespace-pre-wrap">{b.text}</p>
        : b.t === "li" ? <p key={i} className="pl-3">• {b.text}</p>
        : b.t === "hr" ? <hr key={i} />
        : <div key={i} className="overflow-x-auto"><table className="w-full border-collapse text-xs">{b.rows.map((r, j) => <tr key={j} className={j === 0 ? "font-semibold" : ""}>{r.map((c, k) => <td key={k} className="border px-1.5 py-1">{c}</td>)}</tr>)}</table></div>,
      )}
    </div>
  );
}
