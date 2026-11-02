// Export generated Markdown to PDF, Word (.docx), Excel (.xlsx) or Markdown — entirely on the phone.
import { parseMarkdown, tablesOf } from "./markdown";

export type ExportFormat = "pdf" | "docx" | "xlsx" | "md" | "pptx" | "odt" | "rtf";
export const EXPORT_MIME: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  md: "text/markdown",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  rtf: "application/rtf",
};

export type Slide = { title: string; bullets: string[]; table?: string[][] };
/** One slide per H1/H2 section; bullets from paragraphs/list items (max 8 per slide, overflow continues). */
export function slidesFromMarkdown(md: string, title: string): Slide[] {
  const slides: Slide[] = [];
  let cur: Slide = { title, bullets: [] };
  const push = () => { if (cur.bullets.length || cur.table) slides.push(cur); };
  for (const b of parseMarkdown(md)) {
    if (b.t === "h" && b.level <= 2) { push(); cur = { title: b.text, bullets: [] }; }
    else if (b.t === "h" || b.t === "p" || b.t === "li") {
      if (cur.bullets.length >= 8) { push(); cur = { title: `${cur.title} (cont.)`, bullets: [] }; }
      cur.bullets.push(b.text.length > 220 ? b.text.slice(0, 217) + "…" : b.text);
    } else if (b.t === "table") { push(); cur = { title: cur.title, bullets: [], table: b.rows.slice(0, 12) }; push(); cur = { title: cur.title, bullets: [] }; }
  }
  push();
  return slides.length ? slides : [{ title, bullets: [md.slice(0, 200)] }];
}

export async function exportDoc(md: string, format: ExportFormat, title: string): Promise<Uint8Array> {
  if (format === "md") return new TextEncoder().encode(md);
  if (format === "odt") { const { writeOdt } = await import("./odf-rtf"); return writeOdt(md, title); }
  if (format === "rtf") { const { writeRtf } = await import("./odf-rtf"); return writeRtf(md, title); }
  if (format === "pptx") {
    const PptxGenJS = (await import("pptxgenjs")).default;
    const pres = new PptxGenJS();
    pres.layout = "LAYOUT_WIDE"; pres.title = title;
    const cover = pres.addSlide();
    cover.background = { color: "111827" };
    cover.addText(title, { x: 0.6, y: 2.6, w: 12, h: 1.4, fontSize: 40, bold: true, color: "FFFFFF", fontFace: "Arial" });
    for (const s of slidesFromMarkdown(md, title)) {
      const sl = pres.addSlide();
      sl.addText(s.title, { x: 0.5, y: 0.3, w: 12.3, h: 0.9, fontSize: 28, bold: true, color: "111827", fontFace: "Arial" });
      if (s.table) sl.addTable(s.table.map((r, i) => r.map((c) => ({ text: c, options: { bold: i === 0, fontSize: 12 } }))), { x: 0.5, y: 1.4, w: 12.3, border: { type: "solid", color: "CCCCCC", pt: 0.5 } });
      else sl.addText(s.bullets.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })), { x: 0.6, y: 1.4, w: 12, h: 5.6, fontSize: 18, color: "1F2937", valign: "top", fontFace: "Arial" });
    }
    const out = await pres.write({ outputType: "uint8array" });
    return out as Uint8Array;
  }
  const blocks = parseMarkdown(md);
  if (format === "pdf") {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight(), M = 50;
    let y = M;
    const write = (text: string, size: number, bold = false, indent = 0) => {
      pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(size);
      for (const line of pdf.splitTextToSize(text, W - 2 * M - indent) as string[]) {
        if (y > H - M) { pdf.addPage(); y = M; }
        pdf.text(line, M + indent, y); y += size * 1.35;
      }
    };
    pdf.setProperties({ title });
    for (const b of blocks) {
      if (b.t === "h") { y += 6; write(b.text, b.level === 1 ? 18 : b.level === 2 ? 14 : 12, true); y += 2; }
      else if (b.t === "p") { write(b.text, 11); y += 4; }
      else if (b.t === "li") write(`${b.ordered ? "–" : "•"} ${b.text}`, 11, false, 12);
      else if (b.t === "hr") { y += 6; pdf.line(M, y, W - M, y); y += 10; }
      else { for (const [i, r] of b.rows.entries()) write(r.join("  |  "), 10, i === 0); y += 6; }
    }
    return new Uint8Array(pdf.output("arraybuffer"));
  }
  if (format === "docx") {
    const d = await import("docx");
    const children: InstanceType<typeof d.Paragraph | typeof d.Table>[] = [];
    for (const b of blocks) {
      if (b.t === "h") children.push(new d.Paragraph({ text: b.text, heading: b.level === 1 ? d.HeadingLevel.HEADING_1 : b.level === 2 ? d.HeadingLevel.HEADING_2 : d.HeadingLevel.HEADING_3 }));
      else if (b.t === "p") children.push(new d.Paragraph({ children: [new d.TextRun(b.text)] }));
      else if (b.t === "li") children.push(new d.Paragraph({ text: b.text, bullet: { level: 0 } }));
      else if (b.t === "hr") children.push(new d.Paragraph({ text: "" }));
      else children.push(new d.Table({ width: { size: 100, type: d.WidthType.PERCENTAGE }, rows: b.rows.map((r, i) => new d.TableRow({ children: r.map((c) => new d.TableCell({ children: [new d.Paragraph({ children: [new d.TextRun({ text: c, bold: i === 0 })] })] })) })) }));
    }
    const doc = new d.Document({ creator: "MI AI", title, sections: [{ children }] });
    return new Uint8Array(await d.Packer.toArrayBuffer(doc));
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const tables = tablesOf(md);
  if (!tables.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(md.split("\n").map((l) => [l])), "Contenido");
  tables.forEach((t, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t.map((r) => r.map((c) => (/^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c)))), `Tabla ${i + 1}`));
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}
