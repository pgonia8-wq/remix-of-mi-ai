// Export generated Markdown to PDF, Word (.docx), Excel (.xlsx) or Markdown — entirely on the phone.
import { parseMarkdown, tablesOf } from "./markdown";

export type ExportFormat = "pdf" | "docx" | "xlsx" | "md";
export const EXPORT_MIME: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  md: "text/markdown",
};

export async function exportDoc(md: string, format: ExportFormat, title: string): Promise<Uint8Array> {
  if (format === "md") return new TextEncoder().encode(md);
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
    return new Uint8Array(await (await d.Packer.toBlob(doc)).arrayBuffer());
  }
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const tables = tablesOf(md);
  if (!tables.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(md.split("\n").map((l) => [l])), "Contenido");
  tables.forEach((t, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t.map((r) => r.map((c) => (/^-?\d+(\.\d+)?$/.test(c) ? Number(c) : c)))), `Tabla ${i + 1}`));
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer);
}
