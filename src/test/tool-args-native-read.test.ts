import { describe, expect, test } from "vitest";
import { z } from "zod";
import { coerceArgs } from "@/lib/automation/coerce";
import { rangeSlice } from "@/lib/core";
import { shrinkForRetry, isContextOverflow } from "@/lib/chat-attachments";
import type { ChatMsg } from "@/lib/providers";

describe("lectura por rangos en Android (causa de «Encabezado ilegible»)", () => {
  const file = Uint8Array.from({ length: 100 }, (_, i) => i);
  test("206 que en realidad trae el archivo desde el byte 0 devuelve los bytes pedidos", () => {
    const r = rangeSlice(206, file, 8, 4, 100);
    expect([...r.bytes]).toEqual([8, 9, 10, 11]);
    expect(r.whole).toBe(true);
  });
  test("206 que ignora el final del rango (desde el offset hasta el final)", () => {
    expect([...rangeSlice(206, file.subarray(8), 8, 4, 100).bytes]).toEqual([8, 9, 10, 11]);
  });
  test("206 correcto y 200 completo", () => {
    expect([...rangeSlice(206, file.subarray(8, 12), 8, 4, 100).bytes]).toEqual([8, 9, 10, 11]);
    expect([...rangeSlice(200, file, 50, 2, 100).bytes]).toEqual([50, 51]);
  });
  test("respuesta corta se rechaza en vez de entregar bytes equivocados", () => {
    expect(() => rangeSlice(206, file.subarray(8, 10), 8, 4, 100)).toThrow();
  });
});

describe("argumentos de herramientas enviados por otros modelos", () => {
  const rel = z.string().min(1).refine((s) => !s.startsWith("/"), "Ruta fuera del proyecto");
  test("null en opcionales, claves extra y rutas con / se reparan", () => {
    const s = z.object({ from: rel, to: rel, copy: z.boolean().default(false) }).strict();
    const fixed = coerceArgs(s, { from: "/notas.txt", to: "./otra.txt", copy: null, reason: "x" });
    expect(s.parse(fixed)).toEqual({ from: "notas.txt", to: "otra.txt", copy: false });
  });
  test("números en celdas, números como texto, enum en mayúsculas y un valor suelto en lugar de lista", () => {
    const s = z.object({ cells: z.record(z.string(), z.string()), n: z.number().int(), fmt: z.enum(["zip", "7z"]), paths: z.array(z.string()) }).strict();
    expect(s.parse(coerceArgs(s, { cells: { A1: 10, A2: "=A1*2" }, n: "3", fmt: "ZIP", paths: "a.txt" }))).toEqual({ cells: { A1: "10", A2: "=A1*2" }, n: 3, fmt: "zip", paths: ["a.txt"] });
  });
  test("lo que no encaja sigue siendo inválido", () => {
    const s = z.object({ id: z.string().uuid() }).strict();
    expect(s.safeParse(coerceArgs(s, { id: "no-es-uuid" })).success).toBe(false);
  });
});

describe("contexto del chat", () => {
  test("un límite de velocidad (429) no se presenta como conversación demasiado larga", () => {
    expect(isContextOverflow(429, "Rate limit reached")).toBe(false);
    expect(isContextOverflow(400, "Requests to the ChatCompletions_Create Operation under Azure OpenAI API have exceeded token rate limit")).toBe(false);
    expect(isContextOverflow(400, "This model's maximum context length is 128000 tokens")).toBe(true);
  });
  test("al recortar se conservan el sistema y el último mensaje del usuario", () => {
    const msgs: ChatMsg[] = [{ role: "system", content: "s" }, ...Array.from({ length: 10 }, (_, i): ChatMsg => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` })), { role: "user", content: "último" }];
    expect(shrinkForRetry(msgs)).toBe(true);
    expect(msgs[0]!.content).toBe("s");
    expect(msgs.at(-1)!.content).toBe("último");
    expect(msgs[1]!.role).toBe("user");
    expect(msgs.length).toBeLessThan(12);
  });
  test("primero recorta resultados viejos de herramientas de la respuesta actual", () => {
    const big = "x".repeat(5000);
    const msgs: ChatMsg[] = [{ role: "system", content: "s" }, { role: "user", content: "u" }, { role: "tool", content: big, tool_call_id: "1" }, { role: "tool", content: big, tool_call_id: "2" }, { role: "tool", content: big, tool_call_id: "3" }];
    expect(shrinkForRetry(msgs)).toBe(true);
    expect(msgs[2]!.content.length).toBeLessThan(2000);
    expect(msgs[4]!.content.length).toBe(5000);
  });
});
