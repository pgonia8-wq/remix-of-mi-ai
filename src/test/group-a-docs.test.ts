// Grupo A · documentos: hoja con fórmulas, edición Word/PowerPoint conservando el resto del paquete, ODT y RTF.
import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { evaluateSheet, display, readSheetFile, writeSheetFile } from "@/lib/docs/sheet-formulas";
import { docxParagraphs, editDocx, pptxSlides, editPptx } from "@/lib/docs/ooxml-edit";
import { readOdt, writeOdt, readRtf, writeRtf } from "@/lib/docs/odf-rtf";
import { exportDoc } from "@/lib/docs/export";
import { extractText, docKind } from "@/lib/docs/extract";

describe("hoja de cálculo con fórmulas", () => {
  it("recalcula dependencias, rangos y funciones en español e inglés", () => {
    const v = evaluateSheet({ A1: "10", A2: "20", A3: "=SUMA(A1:A2)", B1: "=A3*2", B2: "=PROMEDIO(A1:A2)", C1: '=SI(B1>50;"alto";"bajo")', C2: "=ROUND(10/3, 2)", C3: '=A1&" u"' });
    expect(v.A3).toBe(30); expect(v.B1).toBe(60); expect(v.B2).toBe(15); expect(v.C1).toBe("alto"); expect(v.C2).toBe(3.33); expect(v.C3).toBe("10 u");
    // cambiar una celda recalcula todo lo que depende de ella
    const w = evaluateSheet({ A1: "100", A2: "20", A3: "=SUMA(A1:A2)", B1: "=A3*2", C1: '=SI(B1>50;"alto";"bajo")' });
    expect(w.B1).toBe(240);
  });
  it("detecta ciclos, división entre cero y nombres desconocidos", () => {
    const v = evaluateSheet({ A1: "=B1+1", B1: "=A1+1", C1: "=1/0", D1: "=NOEXISTE(1)" });
    expect(display(v.A1!)).toBe("#CIRC!"); expect(display(v.C1!)).toBe("#DIV/0!"); expect(display(v.D1!)).toBe("#NAME?");
  });
  it("SUMAR.SI, CONTAR.SI y BUSCARV", () => {
    const v = evaluateSheet({ A1: "pan", B1: "5", A2: "leche", B2: "7", A3: "pan", B3: "3", C1: '=SUMAR.SI(A1:A3;"pan";B1:B3)', C2: '=CONTAR.SI(B1:B3;">4")', C3: '=BUSCARV("leche";A1:B3;2;FALSO)', C4: "=2^3^2", C5: "=-2^2", C6: "=50%" });
    expect(v.C1).toBe(8); expect(v.C2).toBe(2); expect(v.C3).toBe(7); expect(v.C4).toBe(512); expect(v.C5).toBe(4); expect(v.C6).toBe(0.5);
  });
  it("guarda fórmulas y resultados en XLSX y los vuelve a leer", async () => {
    const bytes = await writeSheetFile([{ name: "Ventas", cells: { A1: "2", A2: "3", A3: "=A1*A2" } }], "xlsx");
    const [s] = await readSheetFile(bytes);
    expect(s!.name).toBe("Ventas"); expect(s!.cells.A3).toBe("=A1*A2"); expect(evaluateSheet(s!.cells).A3).toBe(6);
  });
});

async function sampleDocx() {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun } = await import("docx");
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Informe anual")] }),
    new Paragraph({ children: [new TextRun({ text: "Ventas de ", bold: true }), new TextRun({ text: "Mar", italics: true }), new TextRun({ text: "zo crecieron." })] }),
    new Paragraph({ children: [new ImageRun({ type: "png", data: png, transformation: { width: 10, height: 10 } })] }),
  ] }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

describe("editar Word conservando estilos e imágenes", () => {
  it("reemplaza texto que cruza varios fragmentos con formato y no toca la imagen", async () => {
    const src = await sampleDocx();
    const before = docxParagraphs(src);
    expect(before[1]!.text).toBe("Ventas de Marzo crecieron.");
    expect(before[2]!.hasImage).toBe(true);
    const { bytes, changes } = editDocx(src, [{ op: "replace", find: "Marzo", replace: "Abril" }, { op: "insertAfter", index: 0, text: "Resumen ejecutivo" }, { op: "setText", index: 0, text: "Informe 2026" }]);
    expect(changes).toBe(3);
    const after = docxParagraphs(bytes);
    expect(after.map((p) => p.text)).toEqual(["Informe 2026", "Resumen ejecutivo", "Ventas de Abril crecieron.", ""]);
    expect(after[0]!.style).toBe(before[0]!.style); // el título conserva su estilo
    const xml = strFromU8(unzipSync(bytes)["word/document.xml"]!);
    expect(xml).toMatch(/<w:b\/>.*Ventas de /s); // la negrita sigue en su fragmento
    const a = unzipSync(src), b = unzipSync(bytes);
    const media = Object.keys(a).filter((k) => k.startsWith("word/media/"));
    expect(media.length).toBe(1);
    for (const k of [...media, "word/styles.xml"]) expect(b[k]).toEqual(a[k]); // imagen y estilos idénticos byte a byte
    expect(() => editDocx(src, [{ op: "delete", index: 2 }])).toThrow(/imagen/);
    expect(() => editDocx(src, [{ op: "replace", find: "Inexistente", replace: "x" }])).toThrow(/No se encontró/);
  });
});

describe("editar PowerPoint: texto, notas y orden", () => {
  it("cambia textos, crea notas y mueve/elimina diapositivas", async () => {
    const src = await exportDoc("# Uno\n- punto a\n- punto b\n# Dos\nTexto dos\n# Tres\nTexto tres", "pptx", "Demo");
    const s0 = pptxSlides(src);
    expect(s0.length).toBe(4);
    expect(s0[1]!.shapes.some((x) => x.text.includes("punto a"))).toBe(true);
    const shape = s0[1]!.shapes.findIndex((x) => x.text.includes("punto a"));
    const { bytes } = editPptx(src, [
      { op: "replace", find: "Texto dos", replace: "Texto 2" },
      { op: "setShapeText", slide: 2, shape, text: "nuevo a\nnuevo b" },
      { op: "setNotes", slide: 2, text: "Decir esto en voz alta" },
      { op: "moveSlide", slide: 4, to: 2 },
      { op: "deleteSlide", slide: 1 },
    ]);
    const s1 = pptxSlides(bytes);
    expect(s1.length).toBe(3);
    expect(s1[0]!.shapes.map((x) => x.text).join(" ")).toContain("Texto tres");
    expect(s1[1]!.shapes.map((x) => x.text).join(" ")).toContain("nuevo a\nnuevo b");
    expect(s1[1]!.notes).toBe("Decir esto en voz alta");
    expect(s1[2]!.shapes.map((x) => x.text).join(" ")).toContain("Texto 2");
    expect((await extractText(bytes, "x.pptx", "")).text).toContain("[Notas] Decir esto en voz alta");
  });
});

describe("ODT y RTF", () => {
  it("crea y lee ODT con títulos, listas y tablas", async () => {
    const md = "# Plan\nTexto con acentos: canción.\n- uno\n- dos\n\n| A | B |\n|---|---|\n| 1 | 2 |";
    const bytes = writeOdt(md, "Mi plan");
    const files = unzipSync(bytes);
    expect(strFromU8(files["mimetype"]!)).toBe("application/vnd.oasis.opendocument.text");
    const text = readOdt(bytes);
    expect(text).toContain("# Mi plan"); expect(text).toContain("canción"); expect(text).toContain("- uno"); expect(text).toContain("| 1 | 2 |");
    expect(docKind("a.odt", "")).toBe("odt");
  });
  it("crea y lee RTF con Unicode, negritas y escapes", () => {
    const bytes = writeRtf("## Sección\nHola **mundo** {llaves} \\ ñandú 😀", "Título");
    const src = new TextDecoder().decode(bytes);
    expect(src.startsWith("{\\rtf1")).toBe(true); expect(src).toContain("{\\b mundo}");
    const back = readRtf(src);
    expect(back).toContain("Título"); expect(back).toContain("Hola mundo {llaves} \\ ñandú 😀");
    expect(readRtf("{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}Caf\\'e9 \\u8364? fin\\par}")).toBe("Café € fin");
    expect(docKind("a.rtf", "")).toBe("rtf");
  });
});
