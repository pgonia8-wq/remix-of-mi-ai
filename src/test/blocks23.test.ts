import { describe, it, expect } from "vitest";
import { pivot, cleanColumn, correlation, loan, npv, irr, convertUnit, projectReport } from "@/lib/pro-tools";
import { isSafeSourceUrl, htmlToText, readSource } from "@/lib/core/research";
import { compareTexts } from "@/lib/docs/compare";
import { slidesFromMarkdown } from "@/lib/docs/export";
import { joinPages } from "@/lib/docs/ocr";
import { buildMask } from "@/components/MaskPainter";
import { mixPcm, resamplePcm } from "@/lib/audio-edit";
import { validateAudioTracks } from "@/lib/video-edit";
import { editForm } from "@/lib/core/adapters/openai";

const T = { name: "ventas", headers: ["region", "monto", "unidades"], rows: [["Norte", 100, 1], ["Sur", 50, 2], ["Norte", "  30 ", 3], [" sur ", null, 4], ["Norte", 100, 1]] };

describe("bloque 3 — datos", () => {
  it("tabla dinámica suma por grupo ignorando no numéricos", () => {
    expect(pivot(T, 0, 1, "sum")).toEqual([{ group: "Norte", value: 230, n: 3 }, { group: "Sur", value: 50, n: 1 }, { group: " sur ", value: 0, n: 0 }]);
    expect(pivot(T, 0, 1, "count").find((r) => r.group === "Norte")!.value).toBe(3);
  });
  it("limpieza no altera el original y quita duplicados", () => {
    const r = cleanColumn(T, 0, ["trim", "lower", "dedupe"]);
    expect(r.table.rows.map((x) => x[0])).toEqual(["norte", "sur", "norte", "sur"]);
    expect(r.removed).toBe(1);
    expect(T.rows[3]![0]).toBe(" sur ");
  });
  it("correlación perfecta = 1", () => {
    expect(correlation({ name: "x", headers: ["a", "b"], rows: [[1, 2], [2, 4], [3, 6]] }, 0, 1).r).toBe(1);
  });
});

describe("bloque 3 — calculadoras", () => {
  it("préstamo: 100 000 al 12% anual a 12 meses = 8 884.88 por mes", () => {
    const r = loan(100000, 12, 12);
    expect(r.payment).toBe(8884.88);
    expect(r.schedule.at(-1)!.balance).toBe(0);
    expect(loan(1200, 0, 12).payment).toBe(100);
  });
  it("VAN y TIR", () => {
    expect(npv(10, [-1000, 1100])).toBe(0);
    expect(irr([-1000, 1100])).toBeCloseTo(10, 3);
    expect(irr([100, 200])).toBeNull();
  });
  it("unidades", () => {
    expect(convertUnit(1, "mi", "km")).toBeCloseTo(1.609344);
    expect(convertUnit(100, "°C", "°F")).toBe(212);
    expect(() => convertUnit(1, "kg", "m")).toThrow();
  });
  it("informe del proyecto cuenta tareas vencidas", () => {
    const md = projectReport({ name: "P", tasks: [{ title: "a", done: 0, due_at: 1 }, { title: "b", done: 1, due_at: null }], notes: [], spend: { totalUsd: 2, includesEstimates: true }, budget: 10, at: 1000 });
    expect(md).toContain("Completadas: 1 de 2. Vencidas: 1.");
    expect(md).toContain("incluye estimados");
  });
});

describe("bloque 3 — investigación", () => {
  it("solo abre páginas https públicas", () => {
    expect(isSafeSourceUrl("https://es.wikipedia.org/wiki/X")).toBe(true);
    for (const u of ["http://a.com", "https://localhost/x", "https://192.168.1.2/", "https://user:pw@a.com", "javascript:alert(1)", "https://10.0.0.1"]) expect(isSafeSourceUrl(u)).toBe(false);
  });
  it("extrae texto sin scripts", () => {
    expect(htmlToText("<html><script>evil()</script><p>Hola &amp; adiós</p></html>")).toBe("Hola & adiós");
  });
  it("si la página no se puede leer, conserva el resumen del buscador", async () => {
    const s = { title: "t", url: "https://a.com/x", snippet: "resumen" };
    const failing = (async () => { throw new TypeError("CORS"); }) as unknown as typeof fetch;
    expect(await readSource(s, failing)).toMatchObject({ read: false, excerpt: "resumen" });
    const ok = (async () => new Response(`<p>${"texto ".repeat(80)}</p>`, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    expect((await readSource(s, ok)).read).toBe(true);
  });
});

describe("bloque 2 — documentos y medios", () => {
  it("comparación de documentos cuenta líneas añadidas y eliminadas", () => {
    const c = compareTexts("a\nb\nc\n", "a\nB\nc\nd\n");
    expect(c.added).toBe(2); expect(c.removed).toBe(1); expect(c.unchanged).toBe(2);
  });
  it("PowerPoint: una diapositiva por sección, máximo 8 viñetas", () => {
    const md = "# Uno\n" + Array.from({ length: 10 }, (_, i) => `- p${i}`).join("\n") + "\n## Dos\ntexto";
    const s = slidesFromMarkdown(md, "T");
    expect(s.map((x) => x.title)).toEqual(["Uno", "Uno (cont.)", "Dos"]);
    expect(s[0]!.bullets).toHaveLength(8);
  });
  it("OCR une páginas con marcadores y confianza media", () => {
    expect(joinPages([{ text: "a", confidence: 80 }, { text: "b", confidence: 60 }])).toEqual({ text: "--- Página 1 ---\na\n\n--- Página 2 ---\nb", confidence: 70, pages: 2 });
  });
  it("máscara: lo pintado queda transparente y el resto opaco", () => {
    const painted = new Uint8ClampedArray([0, 0, 0, 0, 255, 0, 0, 140]);
    expect([...buildMask(painted, 2, 1)].filter((_, i) => i % 4 === 3)).toEqual([255, 0]);
  });
  it("la máscara se envía en el campo mask del API de edición", () => {
    const f = editForm({ capability: "image.edit", model: "m", prompt: "p", files: [{ bytes: new Uint8Array([1]), mime: "image/png", name: "entrada.png" }, { bytes: new Uint8Array([2]), mime: "image/png", name: "mask.png" }] }, true);
    expect(f.getAll("image[]")).toHaveLength(1);
    expect(f.get("mask")).toBeTruthy();
  });
  it("mezcla pistas con distinta frecuencia (remuestreo)", () => {
    const a = { sampleRate: 48000, channels: [new Float32Array(48000)] }, b = { sampleRate: 24000, channels: [new Float32Array(24000).fill(0.5)] };
    expect(resamplePcm(b, 48000).channels[0]!.length).toBe(48000);
    expect(mixPcm([{ audio: a, offset: 0, gain: 1 }, { audio: b, offset: 0, gain: 1 }]).sampleRate).toBe(48000);
  });
  it("pistas de fondo del video deben empezar dentro de la duración", () => {
    expect(() => validateAudioTracks([{ assetId: "a", name: "m", offset: 20, gain: 1 }], 10)).toThrow();
    expect(() => validateAudioTracks([{ assetId: "a", name: "m", offset: 2, gain: 0.5 }], 10)).not.toThrow();
  });
});
