// On-device text extraction (no upload): PDF, DOCX, XLSX/XLS/CSV, plain text. Libraries load lazily, client-only.
export type Extracted = { text: string; pages?: number; sheets?: string[]; warning?: string };

export const DOC_ACCEPT = ".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.json,.html,.xml,.log,.yaml,.yml";
export const MAX_DOC_BYTES = 50 * 1024 * 1024;
export const MAX_TEXT_CHARS = 2_000_000;

export function docKind(name: string, mime: string): "pdf" | "docx" | "sheet" | "text" | "unsupported" {
  const n = name.toLowerCase();
  if (mime === "application/pdf" || n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".docx") || mime.includes("wordprocessingml")) return "docx";
  if (/\.(xlsx|xls|csv)$/.test(n) || mime.includes("spreadsheetml") || mime === "text/csv") return "sheet";
  if (mime.startsWith("text/") || /\.(md|txt|json|xml|html|log|ya?ml)$/.test(n)) return "text";
  return "unsupported";
}

const clip = (t: string) => (t.length > MAX_TEXT_CHARS ? t.slice(0, MAX_TEXT_CHARS) : t);

export async function extractText(bytes: Uint8Array, name: string, mime: string): Promise<Extracted> {
  if (bytes.length > MAX_DOC_BYTES) throw new Error("Documento demasiado grande (máximo 50 MB).");
  const kind = docKind(name, mime);
  if (kind === "text") return { text: clip(new TextDecoder().decode(bytes)) };
  if (kind === "pdf") {
    const pdfjs = await import("pdfjs-dist");
    const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    const out: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      out.push(`--- Página ${i} ---\n` + tc.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : " ") : "")).join(""));
      page.cleanup();
      if (out.join("").length > MAX_TEXT_CHARS) break;
    }
    const text = clip(out.join("\n\n"));
    await doc.destroy();
    return { text, pages: doc.numPages, ...(text.replace(/--- Página \d+ ---|\s/g, "").length < 20 ? { warning: "El PDF parece escaneado (sin texto). Usa «Analizar» con una foto de la página." } : {}) };
  }
  if (kind === "docx") {
    const mammoth = (await import("mammoth/mammoth.browser")).default;
    const r = await mammoth.extractRawText({ arrayBuffer: bytes.slice().buffer });
    return { text: clip(r.value) };
  }
  if (kind === "sheet") {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(bytes, { type: "array" });
    const parts = wb.SheetNames.map((s) => `### Hoja: ${s}\n${XLSX.utils.sheet_to_csv(wb.Sheets[s]!)}`);
    return { text: clip(parts.join("\n\n")), sheets: wb.SheetNames };
  }
  throw new Error("Formato no admitido. Usa PDF, Word (.docx), Excel (.xlsx/.xls), CSV o texto.");
}
