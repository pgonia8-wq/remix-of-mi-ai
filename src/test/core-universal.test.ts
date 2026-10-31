import { describe, it, expect, beforeEach } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs, type SqlDb } from "@/lib/db/sql";
import { importRawKey, randomBytes } from "@/lib/crypto";
import { makeVault } from "@/lib/app-db";
import { SCHEMA } from "@/lib/db/schema";
import { route } from "@/lib/core/router";
import { JobManager, JobError } from "@/lib/core/jobs";
import { AssetStore, sqlBlobBackend } from "@/lib/core/asset-store";
import { KeyRing, webBackend } from "@/lib/core/keys";
import { chooseProfile } from "@/lib/core/device-profile";
import { createBackup, openBackup, restoreBackup, argonParams, ARGON_LIMITS } from "@/lib/core/backup";
import { INITIAL_CAPABILITIES } from "@/lib/core/capabilities";
import { getAdapter } from "@/lib/core/adapters";
import { azureUrl } from "@/lib/core/adapters/azure";
import { AssetIntegrityError } from "@/lib/core/asset-crypto";

const MB = 1024 * 1024;
let SQL: Awaited<ReturnType<typeof initSqlJs>>;
let raw: import("sql.js").Database, db: SqlDb, repo: Repo, keys: KeyRing, store: Map<string, string>, assets: AssetStore, jobs: JobManager;
const memStore = (m: Map<string, string>) => ({ get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => void m.set(k, v), del: (k: string) => void m.delete(k) });
const bytes = (n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(n, i + 65536))); return b; };
async function* once(b: Uint8Array) { yield b; }
const profile = () => ({ name: "economico" as const, blockSize: 64 * 1024, concurrency: 1, reasons: [] });

beforeEach(async () => {
  SQL ??= await initSqlJs();
  raw = new SQL.Database();
  db = wrapSqlJs(raw);
  repo = new Repo(db, makeVault(await importRawKey(randomBytes(32))));
  await repo.migrate();
  store = new Map();
  keys = new KeyRing(db, webBackend(memStore(store)));
  assets = new AssetStore(db, sqlBlobBackend(db), keys, profile);
  jobs = new JobManager(db);
});

describe("migración v3 aditiva", () => {
  it("una base v2 con datos conserva todo y refleja los proveedores en el registro sin copiar la clave", async () => {
    const v2 = new SQL.Database();
    const d2 = wrapSqlJs(v2);
    for (const s of SCHEMA) await d2.run(s);
    const r2 = new Repo(d2, makeVault(await importRawKey(randomBytes(32))));
    const p = await r2.createProject("P");
    const c = await r2.createChat(p.id);
    await r2.addMessage(p.id, c.id, "user", "hola");
    await d2.run(`INSERT INTO providers VALUES ('prov1','Azure','azure_openai','https://x.services.ai.azure.com/openai/v1','ENC','mi-deploy','mi-deploy',NULL,NULL,1,1)`);
    await d2.run(`INSERT INTO provider_verifications VALUES ('prov1','verified',1)`);
    await r2.migrate(); // v2 -> v3
    expect((await r2.listMessages(p.id, c.id))[0]!.content).toBe("hola");
    const prov = (await r2.listProviders())[0]!;
    expect(prov.verification_status).toBe("verified");
    const models = await r2.registry.listModels();
    expect(models.map((m) => [m.remote_id, m.capabilities])).toEqual([["mi-deploy", ["chat"]]]);
    const dump = JSON.stringify(await d2.all(`SELECT * FROM auth_refs`)) + JSON.stringify(await d2.all(`SELECT * FROM endpoints`));
    expect(dump).not.toContain("ENC");
    await r2.migrate(); // idempotent
    expect((await r2.registry.listModels()).length).toBe(1);
  });
});

describe("registro universal", () => {
  it("carga las capacidades iniciales y admite capacidades nuevas sin cambiar el esquema", async () => {
    expect((await repo.registry.listCapabilities()).length).toBe(21);
    expect(INITIAL_CAPABILITIES.map((c) => c.id)).toContain("speech.realtime");
    await repo.registry.registerCapability({ ...INITIAL_CAPABILITIES[0]!, id: "model3d.generate", label: "3D", outputs: ["model3d"] });
    expect((await repo.registry.listCapabilities()).length).toBe(22);
    await expect(repo.registry.registerCapability({ ...INITIAL_CAPABILITIES[0]!, id: "Bad Id" })).rejects.toThrow();
  });

  it("un modelo con varias capacidades; un proveedor con varios modelos; importar marca retirados", async () => {
    const pid = await repo.saveProvider({ name: "OpenAI", kind: "openai", model: "gpt-4o-mini", apiKey: "sk-test" });
    const img = await repo.registry.upsertModel({ providerId: pid, remoteId: "gpt-image-1", source: "manual" });
    await repo.registry.setModelCapabilities(img, ["image.generate", "image.edit"]);
    await expect(repo.registry.setModelCapabilities(img, ["no.existe"])).rejects.toThrow();
    let models = await repo.registry.listModels();
    expect(models.length).toBe(2);
    expect(models.find((m) => m.id === img)!.capabilities.sort()).toEqual(["image.edit", "image.generate"]);
    await repo.registry.applyImport(pid, ["a", "b"]);
    const r = await repo.registry.applyImport(pid, ["a"]);
    expect(r.retired).toBe(1);
    models = await repo.registry.listModels();
    expect(models.find((m) => m.remote_id === "b")!.status).toBe("retired");
  });

  it("borrar el proveedor antiguo elimina sus entradas del registro", async () => {
    const pid = await repo.saveProvider({ name: "X", kind: "mistral", model: "m", apiKey: "k" });
    await repo.deleteProvider(pid);
    expect(await repo.registry.listModels()).toEqual([]);
    expect(await repo.registry.listProviders()).toEqual([]);
  });
});

describe("Model Router", () => {
  async function setup() {
    const pid = await repo.saveProvider({ name: "OpenAI", kind: "openai", model: "gpt-4o-mini", apiKey: "sk" });
    const a = await repo.registry.upsertModel({ providerId: pid, remoteId: "img-a", source: "manual" });
    const b = await repo.registry.upsertModel({ providerId: pid, remoteId: "img-b", source: "manual" });
    await repo.registry.setModelCapabilities(a, ["image.generate"]);
    await repo.registry.setModelCapabilities(b, ["image.generate", "image.edit"]);
    return { pid, a, b };
  }
  it("nunca elige un modelo incompatible y no ejecuta si no hay compatible", async () => {
    const { a } = await setup();
    const models = await repo.registry.listModels();
    const d = route(models, { capability: "audio.tts", mode: "auto" });
    expect(d.ok).toBe(false);
    const m = route(models, { capability: "image.edit", mode: "manual", manualModelId: a });
    expect(m.ok).toBe(false);
  });
  it("automático prefiere verificado; favorito respeta favoritos; explica la razón y el costo desconocido", async () => {
    const { a, b } = await setup();
    await repo.registry.recordTest(a, "image.generate", true, 200, "ok");
    let d = route(await repo.registry.listModels(), { capability: "image.generate", mode: "auto" });
    expect(d.ok && d.model.id).toBe(a);
    expect(d.ok && d.reasons.join(" ")).toContain("costo desconocido");
    await repo.registry.setFavorite(b, true);
    d = route(await repo.registry.listModels(), { capability: "image.generate", mode: "favorite" });
    expect(d.ok && d.model.id).toBe(b);
    expect(d.ok && d.alternatives.map((x) => x.id)).toEqual([a]);
  });
  it("excluye modelos retirados y proveedores deshabilitados", async () => {
    const { pid } = await setup();
    await repo.setProviderEnabled(pid, false);
    expect(route(await repo.registry.listModels(), { capability: "image.generate", mode: "auto" }).ok).toBe(false);
  });
});

describe("gestor de trabajos", () => {
  it("transiciones válidas e inválidas; aislamiento por proyecto", async () => {
    const p = await repo.createProject("A"), q = await repo.createProject("B");
    const j = await jobs.create(p.id, { capability: "image.generate" });
    await expect(jobs.transition(p.id, j.id, "completed")).rejects.toBeInstanceOf(JobError);
    await expect(jobs.get(q.id, j.id)).resolves.toBeNull();
    await expect(jobs.transition(q.id, j.id, "submitting")).rejects.toBeInstanceOf(JobError);
    await jobs.markSent(p.id, j.id);
    await jobs.transition(p.id, j.id, "completed", { phase: "received" });
    await expect(jobs.transition(p.id, j.id, "queued")).rejects.toBeInstanceOf(JobError);
  });
  it("recuperación al reabrir: sin enviar → cola; enviado sin verificación → recovery_required y no se reintenta solo", async () => {
    const p = await repo.createProject("A");
    const notSent = await jobs.create(p.id, { capability: "chat" });
    await db.run(`UPDATE jobs SET status='submitting' WHERE id=?`, [notSent.id]); // crashed before markSent finished network
    const sent = await jobs.create(p.id, { capability: "image.generate" });
    await jobs.markSent(p.id, sent.id);
    const r = await new JobManager(db).recoverOnStart(() => false); // "app reopened"
    expect(r).toEqual({ requeued: 1, interrupted: 0, needsUser: 1 });
    expect((await jobs.get(p.id, sent.id))!.status).toBe("recovery_required");
    expect((await jobs.get(p.id, sent.id))!.phase).toBe("unknown");
    await expect(jobs.retry(p.id, sent.id, false)).rejects.toThrow(/Confirma/);
    await jobs.retry(p.id, sent.id, true);
    expect((await jobs.get(p.id, sent.id))!.status).toBe("queued");
    expect((await jobs.get(p.id, sent.id))!.attempts).toBe(1);
  });
  it("cada trabajo tiene una llave de idempotencia única", async () => {
    const p = await repo.createProject("A");
    const a = await jobs.create(p.id, { capability: "chat" }), b = await jobs.create(p.id, { capability: "chat" });
    expect(a.idempotency_key).not.toBe(b.idempotency_key);
  });
});

describe("biblioteca cifrada", () => {
  it("historial de versiones: familia completa desde cualquier versión, solo del proyecto", async () => {
    const p = await repo.createProject("A"), q = await repo.createProject("B");
    const v1 = await assets.put(p.id, once(bytes(10)), { kind: "image", mime: "image/png" });
    const v2 = await assets.put(p.id, once(bytes(10)), { kind: "image", mime: "image/png", parentId: v1.id });
    const v3 = await assets.put(p.id, once(bytes(10)), { kind: "image", mime: "image/png", parentId: v2.id });
    await assets.put(p.id, once(bytes(10)), { kind: "image", mime: "image/png" });
    expect((await assets.versions(p.id, v3.id)).map((x) => x.id)).toEqual([v1.id, v2.id, v3.id]);
    expect((await assets.versions(p.id, v1.id)).length).toBe(3);
    expect(await assets.versions(q.id, v1.id)).toEqual([]);
  });
  it("guarda cifrado, lee verificado, aísla proyectos y versiona", async () => {
    const p = await repo.createProject("A"), q = await repo.createProject("B");
    const data = bytes(200 * 1024);
    const a = await assets.put(p.id, once(data), { kind: "image", mime: "image/png", prompt: "gato" });
    const blob = (await db.all<{ data: Uint8Array }>(`SELECT data FROM asset_blobs WHERE path=?`, [a.path]))[0]!.data;
    expect(Buffer.from(blob).includes(Buffer.from(data.subarray(0, 64)))).toBe(false); // no plaintext at rest
    expect(await assets.read(p.id, a.id)).toEqual(data);
    await expect(assets.read(q.id, a.id)).rejects.toThrow();
    expect(await assets.list(q.id)).toEqual([]);
    const v2 = await assets.put(p.id, once(bytes(10)), { kind: "image", mime: "image/png", parentId: a.id });
    expect(v2.version).toBe(2);
    await expect(assets.put(q.id, once(bytes(10)), { kind: "image", mime: "image/png", parentId: a.id })).rejects.toThrow();
    await assets.tag(p.id, a.id, "Gatos");
    expect((await assets.list(p.id, { tag: "gatos" })).map((x) => x.id)).toEqual([a.id]);
    expect((await assets.list(p.id, { search: "gato" })).length).toBe(1);
  });
  it("archivo alterado en disco se rechaza y queda marcado", async () => {
    const p = await repo.createProject("A");
    const a = await assets.put(p.id, once(bytes(5000)), { kind: "audio", mime: "audio/mpeg" });
    const [{ data }] = (await db.all<{ data: Uint8Array }>(`SELECT data FROM asset_blobs WHERE path=?`, [a.path])) as [{ data: Uint8Array }];
    const bad = new Uint8Array(data); bad[bad.length - 30]! ^= 1;
    await db.run(`UPDATE asset_blobs SET data=? WHERE path=?`, [bad, a.path]);
    await expect(assets.read(p.id, a.id)).rejects.toBeInstanceOf(AssetIntegrityError);
    expect((await assets.get(p.id, a.id))!.enc_state).toBe("corrupt");
  });
  it("error de almacenamiento (sin espacio) no registra un activo ni deja temporales", async () => {
    const p = await repo.createProject("A");
    const fs = sqlBlobBackend(db);
    const full = new AssetStore(db, { ...fs, append: async () => { throw new Error("ENOSPC"); } }, keys, profile);
    await expect(full.put(p.id, once(bytes(100)), { kind: "image", mime: "image/png" })).rejects.toThrow("ENOSPC");
    expect(await assets.list(p.id)).toEqual([]);
    expect(await fs.list("assets/")).toEqual([]);
  });
  it("limpieza al iniciar: temporales abandonados y archivos sin registro", async () => {
    const p = await repo.createProject("A");
    const fs = sqlBlobBackend(db);
    await fs.create(`assets/${p.id}/.tmp-x`);
    await fs.create(`assets/${p.id}/huerfano.miai`);
    const keep = await assets.put(p.id, once(bytes(10)), { kind: "image", mime: "image/png" });
    expect(await assets.cleanup()).toEqual({ temps: 1, orphans: 1 });
    expect(await assets.read(p.id, keep.id)).toBeTruthy();
  });
  it("borrar el proyecto elimina filas y luego los archivos en la limpieza", async () => {
    const p = await repo.createProject("A");
    await assets.put(p.id, once(bytes(10)), { kind: "image", mime: "image/png" });
    await repo.deleteProject(p.id);
    expect(await db.all(`SELECT * FROM assets`)).toEqual([]);
    expect((await assets.cleanup()).orphans).toBe(1);
  });
});

describe("rotación de llaves", () => {
  it("re-envuelve llaves de datos, los archivos antiguos siguen legibles y la llave vieja se destruye solo sin dependientes", async () => {
    const p = await repo.createProject("A");
    const data = bytes(3000);
    const a = await assets.put(p.id, once(data), { kind: "image", mime: "image/png" });
    expect(a.key_id).toBe(1);
    const r = await keys.rotate();
    expect(r).toMatchObject({ newVersion: 2, rewrapped: 1, retired: [1] });
    expect((await assets.get(p.id, a.id))!.key_id).toBe(2);
    expect(await assets.read(p.id, a.id)).toEqual(data);
    expect(store.has("miai_master_v1")).toBe(false);
  });
  it("una rotación interrumpida se reanuda sin pérdida", async () => {
    const p = await repo.createProject("A");
    const d1 = bytes(100), d2 = bytes(100);
    const a = await assets.put(p.id, once(d1), { kind: "image", mime: "image/png" });
    const b = await assets.put(p.id, once(d2), { kind: "image", mime: "image/png" });
    // simulate crash after creating v2 and re-wrapping only asset a
    await db.run(`INSERT INTO key_versions (id,status,protection,created_at) VALUES (2,'rotating','preview-insecure',1)`);
    const dek = await keys.unwrapDek(1, a.wrapped_dek, a.id, p.id);
    const backend = webBackend(memStore(store));
    const w = await backend.wrap(2, dek, KeyRing.aad(a.id, p.id));
    let s = ""; for (const x of w) s += String.fromCharCode(x);
    await db.run(`UPDATE assets SET key_id=2, wrapped_dek=? WHERE id=?`, [btoa(s), a.id]);
    expect(await assets.read(p.id, b.id)).toEqual(d2); // still readable mid-rotation (v1 retained)
    const r = await keys.rotate();
    expect(r.newVersion).toBe(2);
    expect(await assets.read(p.id, a.id)).toEqual(d1);
    expect(await assets.read(p.id, b.id)).toEqual(d2);
  });
});

describe("respaldo v2 y migración a otro dispositivo", () => {
  it("Argon2id: contraseña correcta restaura en un dispositivo NUEVO (otra llave maestra); incorrecta se rechaza", async () => {
    const p = await repo.createProject("A");
    const data = bytes(70 * 1024);
    const a = await assets.put(p.id, once(data), { kind: "image", mime: "image/png", prompt: "x" });
    await repo.saveProvider({ name: "OpenAI", kind: "openai", model: "m", apiKey: "sk-SECRETO-123" });
    const file = await createBackup({ repo, keys, fs: sqlBlobBackend(db), password: "Contraseña-Fuerte-2026!", deviceMemGB: 2 });
    expect(file).not.toContain("sk-SECRETO-123");
    expect(JSON.parse(file).kdf).toMatchObject({ alg: "argon2id", memKiB: ARGON_LIMITS.minMemKiB, iterations: 2 });
    await expect(openBackup(file, "incorrecta")).rejects.toThrow(/incorrecta/);
    // new phone: empty DB, NEW master key store
    const raw2 = new SQL.Database(); const db2 = wrapSqlJs(raw2);
    const repo2 = new Repo(db2, makeVault(await importRawKey(randomBytes(32)))); await repo2.migrate();
    const store2 = new Map<string, string>();
    const keys2 = new KeyRing(db2, webBackend(memStore(store2)));
    const fs2 = sqlBlobBackend(db2);
    const payload = await openBackup(file, "Contraseña-Fuerte-2026!");
    await restoreBackup({ payload, repo: repo2, db: db2, keys: keys2, fs: fs2 });
    await restoreBackup({ payload, repo: repo2, db: db2, keys: keys2, fs: fs2 }); // re-run (interrupted restore) is safe
    const assets2 = new AssetStore(db2, fs2, keys2, profile);
    expect(await assets2.read(p.id, a.id)).toEqual(data);
    expect(store2.get("miai_master_v1")).not.toBe(store.get("miai_master_v1"));
    const prov = (await repo2.listProviders())[0]!;
    expect(prov.has_key).toBe(false); // API keys must be re-entered
    expect(prov.verification_status).toBe("unverified");
  });
  it("PBKDF2 (compatibilidad) con al menos 600 000 iteraciones", async () => {
    await repo.createProject("A");
    const file = await createBackup({ repo, keys, fs: sqlBlobBackend(db), password: "otra-contraseña-larga", kdf: "pbkdf2" });
    expect(JSON.parse(file).kdf.iterations).toBeGreaterThanOrEqual(600_000);
    expect((await openBackup(file, "otra-contraseña-larga")).dump.tables["projects"]!.length).toBe(1);
  });
  it("respaldo alterado se rechaza antes de restaurar", async () => {
    await repo.createProject("A");
    const f = JSON.parse(await createBackup({ repo, keys, fs: sqlBlobBackend(db), password: "x".repeat(12), kdf: "pbkdf2" }));
    f.kdf.iterations = 700_000;
    await expect(openBackup(JSON.stringify(f), "x".repeat(12))).rejects.toThrow();
  });
  it("parámetros Argon2id según memoria, dentro de límites", () => {
    expect(argonParams(8).memKiB).toBe(64 * 1024);
    expect(argonParams(null).memKiB).toBe(ARGON_LIMITS.minMemKiB);
  });
});

describe("perfiles de rendimiento", () => {
  const f = { availMemMB: 4000, totalMemMB: 12000, lowMemory: false, cores: 8, abis: [], freeStorageMB: 50000, batteryPct: 80, charging: false, thermal: 0, strongBox: true, source: "native" as const };
  it("elige por datos medidos y baja de perfil por calor, batería o memoria baja; misma criptografía", () => {
    expect(chooseProfile(f)).toMatchObject({ name: "alto", blockSize: 4 * MB, concurrency: 4 });
    expect(chooseProfile({ ...f, thermal: 3 }).name).toBe("intermedio");
    expect(chooseProfile({ ...f, availMemMB: 1500, cores: 8 }).name).toBe("intermedio");
    expect(chooseProfile({ ...f, availMemMB: 900 })).toMatchObject({ name: "economico", blockSize: MB, concurrency: 1 });
    expect(chooseProfile({ ...f, availMemMB: null }).name).toBe("economico");
  });
});

describe("adaptadores", () => {
  it("cada adaptador declara solo lo que soporta", () => {
    expect(getAdapter("openai").supports("image.generate")).toBe(true);
    expect(getAdapter("elevenlabs").supports("image.generate")).toBe(false);
    expect(getAdapter("text:mistral").supports("audio.tts")).toBe(false);
    expect(getAdapter("azure_openai").supports("audio.tts")).toBe(false);
  });
  it("Azure imágenes: /openai/v1 en el cuerpo; URL clásica en la ruta con api-version", () => {
    const c = { kind: "azure_openai" as const, endpoint: "https://r.services.ai.azure.com/openai/v1/chat/completions", apiKey: "k", deployment: "img", apiVersion: null, model: "img", extraParams: null };
    expect(azureUrl(c, "img", "images/generations")).toEqual({ url: "https://r.services.ai.azure.com/openai/v1/images/generations", v1: true });
    expect(azureUrl({ ...c, endpoint: "https://r.openai.azure.com", apiVersion: "2025-04-01-preview" }, "img", "images/generations").url).toBe("https://r.openai.azure.com/openai/deployments/img/images/generations?api-version=2025-04-01-preview");
    expect(() => azureUrl({ ...c, endpoint: "https://r.openai.azure.com" }, "img", "images/generations")).toThrow();
  });
});
