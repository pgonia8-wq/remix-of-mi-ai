import { describe, it, expect } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { importRawKey, randomBytes } from "@/lib/crypto";
import { makeVault } from "@/lib/app-db";
import { exportModels, importModels, MODELS_EXT } from "@/lib/core/models-transfer";
import { packForBluetooth, projectFileText, unpackReceived, bluetoothName, isProjectFileName } from "@/lib/core/project-transfer";
import { applyInsets } from "@/lib/device";

let SQL: Awaited<ReturnType<typeof initSqlJs>>;
async function phone() {
  SQL ??= await initSqlJs();
  const repo = new Repo(wrapSqlJs(new SQL.Database()), makeVault(await importRawKey(randomBytes(32))));
  await repo.migrate();
  return repo;
}
const PW = "Modelos-Seguros-2026!";

describe("enviar modelos a otro teléfono", () => {
  it("lleva proveedores, modelos y capacidades, pero nunca la API key", async () => {
    const a = await phone();
    const pid = await a.saveProvider({ name: "Azure TTS", kind: "azure_openai", endpoint: "https://x.openai.azure.com/openai/v1", deployment: "gpt-4o-mini-tts", model: "gpt-4o-mini-tts", apiKey: "SECRETO-AZURE-123" });
    const mid = await a.registry.upsertModel({ providerId: pid, remoteId: "extra-model", name: "Extra", source: "manual" });
    await a.registry.setModelCapabilities(mid, ["chat"]);
    await a.registry.setFavorite(mid, true);
    const file = await exportModels({ repo: a, password: PW, kdf: "pbkdf2" });
    expect(file).not.toContain("SECRETO-AZURE-123");
    expect(file).not.toContain("gpt-4o-mini-tts"); // sealed, not readable without the password

    const b = await phone();
    const r = await importModels({ repo: b, text: file, password: PW });
    expect(r.added).toBe(1);
    const [p] = await b.listProviders();
    expect(p!.deployment).toBe("gpt-4o-mini-tts");
    expect(p!.has_key).toBe(false);
    const extra = (await b.registry.listModels()).find((m) => m.remote_id === "extra-model")!;
    expect(extra.capabilities).toEqual(["chat"]);
    expect(extra.favorite).toBe(1);
  });

  it("rechaza la contraseña incorrecta sin escribir nada y no duplica lo que ya existe", async () => {
    const a = await phone();
    await a.saveProvider({ name: "OpenAI", kind: "openai", model: "gpt-x", apiKey: "k" });
    const file = await exportModels({ repo: a, password: PW, kdf: "pbkdf2" });
    const b = await phone();
    await expect(importModels({ repo: b, text: file, password: "otra-clave-larga-1!" })).rejects.toThrow(/Contraseña incorrecta/);
    expect(await b.listProviders()).toEqual([]);
    await importModels({ repo: b, text: file, password: PW });
    const again = await importModels({ repo: b, text: file, password: PW });
    expect(again).toMatchObject({ added: 0, skipped: 1 });
    expect((await b.listProviders()).length).toBe(1);
  });
});

describe("paquete Bluetooth", () => {
  it("el ZIP enviado por Bluetooth se abre igual que el archivo original", async () => {
    const zip = await packForBluetooth('{"format":"miai-project"}', "Mi proyecto");
    expect(zip[0]).toBe(0x50);
    expect(await projectFileText(zip)).toBe('{"format":"miai-project"}');
    expect(await projectFileText(new TextEncoder().encode("plano"))).toBe("plano");
    expect(bluetoothName("Mi proyecto")).toBe("Mi_proyecto.miaiproj.zip");
    expect(isProjectFileName("Mi_proyecto.miaiproj.zip")).toBe(true);
    const mz = await packForBluetooth("m", "MI-AI-modelos", MODELS_EXT);
    expect(await unpackReceived(mz, MODELS_EXT, "modelos")).toBe("m");
    await expect(unpackReceived(mz, ".miaiproj", "un proyecto")).rejects.toThrow(/no contiene/);
  });
});

describe("bordes de pantalla", () => {
  it("aplica barra de estado, navegación y teclado como espacio real", () => {
    const el = document.createElement("div");
    applyInsets({ top: 32.4, right: 0, bottom: 24, left: 0, ime: 300 }, el);
    expect(el.style.getPropertyValue("--sat")).toBe("32.4px");
    expect(el.style.getPropertyValue("--sab")).toBe("24px");
    expect(el.style.getPropertyValue("--kb")).toBe("276px"); // keyboard minus the navigation bar it covers
  });
});
