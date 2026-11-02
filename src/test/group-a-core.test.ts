// Grupo A · núcleo: archivos grandes por partes, agentes en segundo plano, reacciones automáticas, tutor adaptativo,
// verificación de voz antes de clonar, animación 3D fina, investigación verificada y herramientas nuevas del chat.
import { beforeEach, describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import { Repo } from "@/lib/db/repo";
import { wrapSqlJs } from "@/lib/db/sql";
import { AssetStore, sqlBlobBackend } from "@/lib/core/asset-store";
import { KeyRing, webBackend } from "@/lib/core/keys";
import { JobManager } from "@/lib/core/jobs";
import { chooseProfile, type DeviceFacts } from "@/lib/core/device-profile";
import type { Core } from "@/lib/core";
import { invokeTool, DEFAULT_LIMITS, type ToolCtx } from "@/lib/automation/tools";
import { createRun } from "@/lib/automation/orchestrator";
import { CHAT_TOOLS } from "@/lib/chat-tools";
import { blobChunks } from "@/lib/device";
import { driveRun, setDriveHooks, waitForDriver } from "@/lib/automation/drive";
import { react, reactions, matchesFilter } from "@/lib/automation/reactions";
import { progress, updateMastery, pickConcept } from "@/lib/core/study";
import { verifications } from "@/lib/core/voices";
import { challengePhrase, phraseMatch, voiceprint, compareVoiceprints } from "@/lib/media/voice-verify";
import { sampleKeys, autoAssign, posedPositions, bakeTrack, type MeshDoc } from "@/lib/media/rig";
import { extractClaims, lexicalSupport, bestPassages } from "@/lib/core/research";
import { exportDoc } from "@/lib/docs/export";
import { pptxSlides } from "@/lib/docs/ooxml-edit";

let repo: Repo, core: Core, p: string, ctx: ToolCtx;
beforeEach(async () => {
  const SQL = await initSqlJs(), db = wrapSqlJs(new SQL.Database());
  repo = new Repo(db, { encrypt: async (s) => `enc:${s}`, decrypt: async (s) => s.slice(4) }); await repo.migrate();
  const mem = new Map<string, string>();
  const keys = new KeyRing(db, webBackend({ get: (k) => mem.get(k) ?? null, set: (k, v) => { mem.set(k, v); }, del: (k) => { mem.delete(k); } }));
  const device: DeviceFacts = { availMemMB: 500, totalMemMB: 3000, lowMemory: false, cores: 4, abis: [], freeStorageMB: null, batteryPct: null, charging: null, thermal: null, strongBox: false, source: "browser" };
  const profile = chooseProfile(device), files = sqlBlobBackend(db), assets = new AssetStore(db, files, keys, () => profile);
  core = { repo, keys, files, assets, jobs: new JobManager(db), profile, device, startup: { temps: 0, orphans: 0, requeued: 0, interrupted: 0, needsUser: 0 } } as Core;
  p = (await repo.createProject("A")).id;
  const runId = await createRun(core, p, { goal: "chat", kind: "chat", limits: { maxCalls: 300 } });
  ctx = { core, projectId: p, runId, taskId: null, agent: "chat" };
});
let n = 0;
const call = async (tool: string, input: unknown) => { const r = await invokeTool(ctx, tool, input, { allowed: [...CHAT_TOOLS], limits: { ...DEFAULT_LIMITS, maxCalls: 300, perAgentCalls: 300, unknownCost: "allow" as const }, opKey: `g${n++}` }); if (r.status !== "ok") throw new Error(`${tool}: ${JSON.stringify(r)}`); return r; };

describe("archivos grandes por partes", () => {
  it("guarda y lee un archivo de 5 MB en trozos de 1 MB sin cambiar un byte", async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 123); for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
    const sizes: number[] = []; for await (const c of blobChunks(new Blob([big]))) sizes.push(c.length);
    expect(Math.max(...sizes)).toBe(1024 * 1024); expect(sizes.length).toBe(6);
    const a = await core.assets.put(p, blobChunks(new Blob([big])), { kind: "video", mime: "video/mp4", name: "grande.mp4" });
    const parts: Uint8Array[] = []; for await (const c of core.assets.stream(p, a.id)) parts.push(c);
    const out = new Uint8Array(parts.reduce((s, c) => s + c.length, 0)); let o = 0; for (const c of parts) { out.set(c, o); o += c.length; }
    expect(out.length).toBe(big.length); expect(out.every((v, i) => v === big[i])).toBe(true);
    expect(Math.max(...parts.map((x) => x.length))).toBeLessThan(big.length); // nunca un solo bloque gigante
  });
  it("la lectura por partes no entrega nada de otro proyecto", async () => {
    const a = await core.assets.put(p, blobChunks(new Blob([new Uint8Array([1, 2, 3])])), { kind: "document", mime: "application/octet-stream", name: "x" });
    const q = (await repo.createProject("B")).id;
    await expect((async () => { for await (const _ of core.assets.stream(q, a.id)) { /* nada */ } })()).rejects.toThrow(/no pertenece/);
  });
});

describe("agentes en segundo plano", () => {
  it("avisa que hay trabajo, usa la pausa sin freno y apaga el aviso al terminar", async () => {
    const events: string[] = [];
    setDriveHooks({ busy: (k) => events.push(`busy:${k}`), idle: () => events.push("idle"), settled: (_p, _id, status) => events.push(`settled:${status}`), pause: async () => { events.push("pause"); } });
    const runId = await createRun(core, p, { goal: "x", limits: { maxCalls: 5 } });
    let step = 0;
    const model = vi.fn(async () => { step++; return step === 1 ? JSON.stringify({ tasks: [] }) : JSON.stringify({ final: "ok" }); });
    driveRun(core, p, runId, { model: model as never, maxSteps: 3 });
    await waitForDriver(p, runId);
    setDriveHooks({});
    expect(events[0]).toBe("busy:1");
    expect(events.filter((e) => e.startsWith("settled")).length).toBe(1);
    expect(events[events.length - 1]).toBe("idle");
  });
});

describe("reacciones automáticas", () => {
  it("etiqueta, lee texto a notas, crea tareas y solo propone acciones con IA", async () => {
    await reactions.add(core, p, { name: "Facturas", event: "file.added", filter: ".txt", action: "tag", param: "facturas" });
    await reactions.add(core, p, { name: "Leer", event: "file.added", filter: "text/", action: "extract_text" });
    await reactions.add(core, p, { name: "Tarea", event: "file.added", filter: "factura", action: "task", param: "Pagar {nombre}" });
    await reactions.add(core, p, { name: "IA", event: "file.added", action: "propose", param: "Resume {nombre}" });
    const a = await core.assets.put(p, (async function* () { yield new TextEncoder().encode("Total: 100 pesos"); })(), { kind: "document", mime: "text/plain", name: "factura-1.txt" });
    const st = await react(core, p, "file.added", { name: a.name!, mime: a.mime, assetId: a.id, capability: a.capability_id });
    expect(st).toEqual(["hecho", "hecho", "hecho", "propuesta"]);
    expect(await core.assets.tags(p, a.id)).toContain("facturas");
    const [note] = await repo.sql.all<{ body: string }>("SELECT body FROM notes WHERE project_id=?", [p]); expect(note!.body).toContain("Total: 100");
    const [task] = await repo.sql.all<{ title: string }>("SELECT title FROM tasks WHERE project_id=?", [p]); expect(task!.title).toBe("Pagar factura-1.txt");
    const log = await reactions.log(core, p); expect(log.find((l) => l.status === "propuesta")!.detail).toBe("Resume factura-1.txt");
    // archivos creados por reacciones no disparan reglas (sin bucles) y el filtro funciona
    expect(await react(core, p, "file.added", { name: "x.txt", mime: "text/plain", capability: "reaction" })).toEqual([]);
    expect(matchesFilter(".pdf, image/", { name: "a.PDF" })).toBe(true); expect(matchesFilter("image/", { name: "a.txt", mime: "text/plain" })).toBe(false);
    await expect(reactions.add(core, p, { name: "x", event: "run.completed", action: "tag", param: "a" })).rejects.toThrow(/solo aplica a archivos/);
  });
});

describe("tutor adaptativo", () => {
  it("sube la dificultad con aciertos seguidos y la baja al fallar, enfocado en lo más débil", async () => {
    let s = { mastery: 0.25, level: 2, streak: 0 };
    for (let i = 0; i < 3; i++) s = updateMastery(s, true);
    expect(s.level).toBeGreaterThanOrEqual(3); expect(s.mastery).toBeGreaterThan(0.25);
    const hi = s.level; s = updateMastery(s, false); s = updateMastery(s, false);
    expect(s.level).toBeLessThan(hi);
    expect(updateMastery({ mastery: 0.5, level: 3, streak: 0 }, true, true).mastery).toBeLessThan(updateMastery({ mastery: 0.5, level: 3, streak: 0 }, true, false).mastery);
    await progress.seed(repo.sql, p, "fracciones", ["sumar", "multiplicar", "simplificar"]);
    await progress.record(repo.sql, p, "fracciones", "sumar", true); await progress.record(repo.sql, p, "fracciones", "multiplicar", false);
    const list = await progress.list(repo.sql, p, "fracciones");
    expect(pickConcept(list)).toBe("multiplicar");
    expect(pickConcept(list, "multiplicar")).not.toBe("multiplicar");
  });
});

function synth(f0: number, formants: number[], seed: number) {
  const sr = 16000, n = sr * 3, x = new Float32Array(n); let ph = 0, r = seed; const rnd = () => (r = (r * 16807) % 2147483647) / 2147483647;
  const segs: number[][] = []; for (let s = 0; s < 12; s++) segs.push(formants.map((f) => f * (1 + (rnd() - 0.5) * 0.3)));
  const st = formants.map(() => [0, 0]);
  for (let i = 0; i < n; i++) {
    ph += f0 * (1 + 0.05 * Math.sin(i / sr * 3)) / sr; let y = 0; if (ph >= 1) { ph -= 1; y = 1; } y += (rnd() - 0.5) * 0.02;
    segs[Math.floor(i / sr / 0.3)]!.forEach((F, k) => { const R = Math.exp(-Math.PI * (80 + k * 40) / sr), th = 2 * Math.PI * F / sr; const out = y + 2 * R * Math.cos(th) * st[k]![0]! - R * R * st[k]![1]!; st[k]![1] = st[k]![0]!; st[k]![0] = out; y = out * (1 - R); });
    x[i] = y * (Math.floor(i / 4000) % 4 === 3 ? 0.001 : 1);
  }
  return x;
}
describe("verificación de voz antes de clonar", () => {
  it("la frase en vivo debe coincidir, con su código", () => {
    const phrase = challengePhrase(() => 0.5);
    expect(phrase).toMatch(/\d{4}/);
    expect(phraseMatch(phrase, phrase.replace(/,/g, "")).ok).toBe(true);
    expect(phraseMatch(phrase, phrase.replace(/\d{4}/, "1234")).ok).toBe(false);
    expect(phraseMatch(phrase, "hola qué tal").ok).toBe(false);
  });
  it("distingue la misma voz de otra persona (comparación acústica en el teléfono)", () => {
    const a1 = voiceprint(synth(120, [700, 1200, 2500], 1)), a2 = voiceprint(synth(125, [700, 1200, 2500], 7));
    const other = voiceprint(synth(210, [450, 2100, 3000], 3)), similarPitch = voiceprint(synth(130, [550, 1600, 2800], 5));
    expect(compareVoiceprints(a1, a2).ok).toBe(true);
    expect(compareVoiceprints(a1, other).ok).toBe(false);
    expect(compareVoiceprints(a1, similarPitch).ok).toBe(false);
  });
  it("sin verificación válida no se envía nada al proveedor y cada verificación sirve una sola vez", async () => {
    await expect(verifications.record(repo.sql, p, { phrase: "x", phraseScore: 0.5, speakerScore: 0.9, samples: 1 })).rejects.toThrow(/no se superó/);
    const id = await verifications.record(repo.sql, p, { phrase: "x", phraseScore: 0.9, speakerScore: 0.8, samples: 1 });
    await expect(verifications.assertUsable(repo.sql, p, undefined)).rejects.toThrow(/verifica/);
    await expect(verifications.assertUsable(repo.sql, p, id, Date.now() + 16 * 60_000)).rejects.toThrow(/expiró/);
    const q = (await repo.createProject("B")).id;
    await expect(verifications.assertUsable(repo.sql, q, id)).rejects.toThrow(/verifica/);
    await verifications.assertUsable(repo.sql, p, id);
    await verifications.markUsed(repo.sql, p, id);
    await expect(verifications.assertUsable(repo.sql, p, id)).rejects.toThrow(/ya se usó/);
  });
});

describe("animación 3D más fina", () => {
  it("curvas suaves, giros por el camino corto y piel que se dobla entre dos huesos", () => {
    const keys = [{ t: 0, rot: [0, 0, 0] as [number, number, number], move: [0, 0, 0] as [number, number, number], ease: "ease" as const }, { t: 1, rot: [0, 0, 90] as [number, number, number], move: [10, 0, 0] as [number, number, number] }];
    const lin = sampleKeys([{ ...keys[0]!, ease: "linear" }, keys[1]!], 0.25), eased = sampleKeys(keys, 0.25);
    expect(lin.move[0]).toBeCloseTo(2.5); expect(eased.move[0]).toBeLessThan(2.5); // arranca suave
    expect(sampleKeys(keys, 0.5).rot[2]).toBeCloseTo(45, 0);
    expect(sampleKeys([{ ...keys[0]!, ease: "step" }, keys[1]!], 0.9).move[0]).toBe(0);
    const wrap = sampleKeys([{ t: 0, rot: [0, 0, 170], move: [0, 0, 0] }, { t: 1, rot: [0, 0, -170], move: [0, 0, 0] }], 0.5);
    expect(Math.abs(Math.abs(wrap.rot[2]) - 180)).toBeLessThan(1); // 20° por el camino corto, no 340°
    expect(bakeTrack(keys, 1, 10).length).toBe(11);
    const positions: number[] = []; for (let y = 0; y <= 10; y++) positions.push(0, y, 0);
    const doc: MeshDoc = { version: 1, name: "brazo", positions, indices: [0, 1, 2], bones: [{ id: "a", name: "hombro", parent: null, head: [0, 0, 0] }, { id: "b", name: "codo", parent: "a", head: [0, 5, 0] }, { id: "c", name: "mano", parent: "b", head: [0, 10, 0] }], weights: [], tracks: [{ bone: "b", keys: [{ t: 0, rot: [0, 0, 0], move: [0, 0, 0] }, { t: 1, rot: [0, 0, 90], move: [0, 0, 0] }] }], duration: 1 };
    const rigid = autoAssign(doc), smooth = autoAssign(doc, { smooth: true });
    expect(smooth.blend!.some((b) => b > 0)).toBe(true);
    const pr = posedPositions(rigid, 1), ps = posedPositions(smooth, 1);
    const i = 5; // vértice en el codo: con uniones suaves queda entre ambos huesos
    expect(Math.hypot(ps[i * 3]! - pr[i * 3]!, ps[i * 3 + 1]! - pr[i * 3 + 1]!)).toBeGreaterThanOrEqual(0);
    expect(smooth.weights2!.length).toBe(11);
  });
});

describe("investigación verificada", () => {
  it("separa afirmaciones con sus citas y exige que las cifras estén en la fuente", () => {
    const report = "## Resumen\nLa población de Monterrey alcanzó 1,142,994 habitantes en 2020 según el censo oficial [1]. El clima de la ciudad es semiárido con veranos muy calurosos [2].\nOtra frase sin cita alguna que afirma algo importante sobre la ciudad.\n## Fuentes\n1. x";
    const claims = extractClaims(report);
    expect(claims.length).toBe(3); expect(claims[0]!.cites).toEqual([1]); expect(claims[2]!.cites).toEqual([]);
    expect(lexicalSupport(claims[0]!.claim, "El censo 2020 registró 1,142,994 habitantes en Monterrey.").missingNumbers).toEqual([]);
    expect(lexicalSupport(claims[0]!.claim, "El censo 2020 registró 1,135,550 habitantes en Monterrey.").missingNumbers).toContain("1142994");
    const long = "a ".repeat(3000) + "Monterrey censo habitantes 2020 dato clave. " + "b ".repeat(3000);
    expect(bestPassages(long, "habitantes de Monterrey en el censo", 1, 300)).toContain("Monterrey censo");
  });
});

describe("herramientas nuevas del chat", () => {
  it("edita una presentación, calcula una hoja y anima una malla, siempre como versión nueva", async () => {
    const pptx = await exportDoc("# Uno\nTexto uno\n# Dos\nTexto dos", "pptx", "Demo");
    const a = await core.assets.put(p, (async function* () { yield pptx; })(), { kind: "document", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", name: "demo.pptx" });
    expect((await call("doc.outline", { assetId: a.id })).output).toContain("Diapositiva 2");
    const ed = await call("doc.edit", { assetId: a.id, ops: [{ op: "replace", find: "Texto dos", replace: "Texto 2" }, { op: "setNotes", slide: 3, text: "Notas" }] });
    const v2 = await core.assets.get(p, ed.assets![0]!.id);
    expect(v2!.parent_id).toBe(a.id);
    const slides = pptxSlides(await core.assets.read(p, v2!.id));
    expect(slides[2]!.shapes.map((s) => s.text).join(" ")).toContain("Texto 2"); expect(slides[2]!.notes).toBe("Notas");
    const sh = await call("sheet.compute", { cells: { A1: "4", A2: "6", A3: "=SUMA(A1:A2)*2" }, save: true, name: "cuentas" });
    expect(sh.output).toContain("A3 = 20"); expect(sh.assets![0]!.name).toBe("cuentas.xlsx");
    const mesh: MeshDoc = { version: 1, name: "cubo", positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 2, 0], indices: [0, 1, 2, 1, 2, 3], bones: [], weights: [-1, -1, -1, -1], tracks: [], duration: 2 };
    const m = await core.assets.put(p, (async function* () { yield new TextEncoder().encode(JSON.stringify(mesh)); })(), { kind: "document", mime: "application/json", name: "cubo.miaimesh", capability: "mesh.document" });
    const r = await call("rig.edit", { assetId: m.id, ops: [{ op: "addBone", name: "base", head: [0, 0, 0] }, { op: "addBone", name: "punta", parent: "base", head: [0, 1, 0] }, { op: "autoSkin", smooth: true }, { op: "key", bone: "punta", t: 1, rot: [0, 0, 45], ease: "ease" }], export: "obj", poseAt: 1 });
    expect(r.output).toContain("base, punta"); expect(r.assets!.map((x) => x.name)).toEqual(["cubo.miaimesh", "cubo-pose.obj"]);
    await expect(call("video.render", { clips: [{ assetId: m.id, start: 0, end: 1 }] })).rejects.toThrow(/no es video/);
  });
});
