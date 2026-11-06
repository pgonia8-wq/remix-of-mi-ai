import { expect, it } from "vitest";
import { SUPPORT_EMAIL } from "@/lib/app-info";

it("usa el correo oficial proporcionado por Fer", () => {
  expect(SUPPORT_EMAIL).toBe("soporte@tramanetwork.lat");
});