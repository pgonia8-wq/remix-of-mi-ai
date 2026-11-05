import { describe, expect, it } from "vitest";
import { canSeeImages } from "@/lib/vision-models";

describe("Imágenes en el chat", () => {
  it("un modelo marcado con Visión las recibe", () => expect(canSeeImages(["chat", "vision"], "cualquiera")).toBe(true));
  it("familias que ven imágenes las reciben aunque no estén marcadas", () => { expect(canSeeImages(["chat"], "gpt-4o-mini")).toBe(true); expect(canSeeImages(["chat"], "gpt-5-chat")).toBe(true); });
  it("un modelo solo de texto no las recibe (la imagen queda para las herramientas)", () => expect(canSeeImages(["chat"], "deepseek-chat")).toBe(false));
});
