import { describe, it, expect } from "vitest";
import { maskIssue } from "@/lib/core/request-compatibility";
import { isSafeSourceUrl, readSource } from "@/lib/core/research";
import { linesOfBlob } from "@/lib/core/backup-stream";
import { loan, npv, convertUnit } from "@/lib/pro-tools";

describe("máscaras solo a proveedores compatibles", () => {
  const img = { name: "entrada.png", mime: "image/png" }, mask = { name: "mask.png", mime: "image/png" };
  it("OpenAI y Azure aceptan máscara en image.edit", () => {
    expect(maskIssue("image.edit", "openai", [img, mask])).toBeNull();
    expect(maskIssue("image.edit", "azure_openai", [img, mask])).toBeNull();
  });
  it("otro proveedor la rechaza", () => { expect(maskIssue("image.edit", "runway", [img, mask])).not.toBeNull(); });
  it("otra capacidad la rechaza", () => { expect(maskIssue("image.generate", "openai", [img, mask])).not.toBeNull(); });
  it("máscara sin imagen se rechaza", () => { expect(maskIssue("image.edit", "openai", [mask])).not.toBeNull(); });
});

describe("investigación: direcciones privadas", () => {
  it.each(["https://100.64.0.1/x", "https://[::ffff:127.0.0.1]/", "https://2130706433/", "https://0x7f000001/", "https://intranet/", "https://0177.0.0.1/"])("rechaza %s", (u) => {
    expect(isSafeSourceUrl(u)).toBe(false);
  });
  it("acepta página pública", () => { expect(isSafeSourceUrl("https://es.wikipedia.org/wiki/Sol")).toBe(true); });
  it("si la respuesta terminó en dirección privada, usa el resumen", async () => {
    const fake = (async () => ({ url: "https://192.168.1.1/", ok: true, headers: new Headers({ "content-type": "text/html" }), text: async () => "x".repeat(500) })) as unknown as typeof fetch;
    const r = await readSource({ title: "t", url: "https://ejemplo.com/a", snippet: "resumen" }, fake);
    expect(r.read).toBe(false);
    expect(r.excerpt).toBe("resumen");
  });
});

describe("respaldo leído por partes", () => {
  it("divide líneas aunque crucen trozos", async () => {
    const big = "a".repeat(100_000) + "\nb\n\nc";
    const out: string[] = [];
    for await (const l of linesOfBlob(new Blob([big]))) out.push(l);
    expect(out).toEqual(["a".repeat(100_000), "b", "", "c"]);
  });
});

describe("calculadoras con valores concretos", () => {
  it("préstamo 10000 al 12% anual en 12 meses ≈ 888.49 por mes", () => {
    expect(loan(10000, 12, 12).payment).toBeCloseTo(888.49, 2);
  });
  it("VAN de [-1000, 1100] al 10% es 0", () => { expect(npv(10, [-1000, 1100])).toBeCloseTo(0, 6); });
  it("1 km = 1000 m", () => { expect(convertUnit(1, "km", "m")).toBeCloseTo(1000, 6); });
});
