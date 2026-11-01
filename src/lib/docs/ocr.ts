// Local OCR (Tesseract WASM, lazy-loaded). Recognition runs on the phone; only the public language pack is
// downloaded once on first use (no document data leaves the device).
export const OCR_LANGS = { spa: "Español", eng: "Inglés", "spa+eng": "Español + inglés" } as const;
export type OcrLang = keyof typeof OCR_LANGS;
export const MAX_OCR_PAGES = 30;

type Worker = { recognize(img: unknown): Promise<{ data: { text: string; confidence: number } }>; terminate(): Promise<unknown> };

async function worker(lang: OcrLang, onProgress?: (p: number) => void): Promise<Worker> {
  const { createWorker } = await import("tesseract.js");
  return (await createWorker(lang, 1, { logger: (m: { status: string; progress: number }) => { if (m.status === "recognizing text") onProgress?.(m.progress); } })) as unknown as Worker;
}

/** Joins OCR'd pages with the same page markers used by PDF text extraction. */
export function joinPages(pages: { text: string; confidence: number }[]) {
  const text = pages.map((p, i) => `--- Página ${i + 1} ---\n${p.text.trim()}`).join("\n\n");
  const confidence = pages.length ? Math.round(pages.reduce((a, p) => a + p.confidence, 0) / pages.length) : 0;
  return { text, confidence, pages: pages.length };
}

export async function ocrImage(bytes: Uint8Array, mime: string, lang: OcrLang = "spa", onProgress?: (p: number) => void) {
  const w = await worker(lang, onProgress);
  try {
    const r = await w.recognize(new Blob([bytes as BlobPart], { type: mime }));
    return joinPages([{ text: r.data.text, confidence: r.data.confidence }]);
  } finally { await w.terminate(); }
}

/** Renders each page of a scanned PDF to a canvas at ~2x and recognizes it. */
export async function ocrPdf(bytes: Uint8Array, lang: OcrLang = "spa", onStep?: (s: string) => void) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const w = await worker(lang);
  const pages: { text: string; confidence: number }[] = [];
  try {
    const n = Math.min(doc.numPages, MAX_OCR_PAGES);
    for (let i = 1; i <= n; i++) {
      onStep?.(`Leyendo página ${i} de ${n}…`);
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(vp.width, 3000); canvas.height = Math.min(vp.height, 4200);
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp } as never).promise;
      const r = await w.recognize(canvas);
      pages.push({ text: r.data.text, confidence: r.data.confidence });
      page.cleanup(); canvas.width = 0;
    }
    return { ...joinPages(pages), truncated: doc.numPages > MAX_OCR_PAGES };
  } finally { await w.terminate(); await doc.destroy(); }
}
