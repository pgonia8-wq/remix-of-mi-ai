// Minimal Markdown model shared by the PDF/DOCX/XLSX exporters.
export type Block =
  | { t: "h"; level: 1 | 2 | 3; text: string }
  | { t: "p"; text: string }
  | { t: "li"; text: string; ordered: boolean }
  | { t: "table"; rows: string[][] }
  | { t: "hr" };

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
export const stripInline = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1").replace(/\[(.+?)\]\((.+?)\)/g, "$1 ($2)");

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push({ t: "p", text: stripInline(para.join(" ")) }); para = []; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { flush(); out.push({ t: "h", level: h[1]!.length as 1 | 2 | 3, text: stripInline(h[2]!) }); continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? "")) {
      flush();
      const rows = [cells(l)];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!).map(stripInline));
      i--;
      out.push({ t: "table", rows });
      continue;
    }
    const li = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) { flush(); out.push({ t: "li", text: stripInline(li[2]!), ordered: /\d/.test(li[1]!) }); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { flush(); out.push({ t: "hr" }); continue; }
    if (!l.trim()) { flush(); continue; }
    para.push(l.trim());
  }
  flush();
  return out;
}

export const tablesOf = (md: string) => parseMarkdown(md).filter((b): b is Extract<Block, { t: "table" }> => b.t === "table").map((b) => b.rows);
