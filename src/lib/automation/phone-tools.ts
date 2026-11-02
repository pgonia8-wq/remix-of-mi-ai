// Phone tools: capabilities that run on the Android device itself (or reach the user's PC/VM when they paired one).
// They are ordinary ToolDefs: every call still goes through invokeTool() (allowlist, role, policy, schema, limits,
// budget, availability, exact-action approval, checkpoint, observation). Nothing here grants permissions.
import { z } from "zod";
import type { Family, ToolCtx, ToolDef, ToolOut, ToolAsset } from "./tools";

export type PhoneHelpers = {
  ToolRejected: new (m: string) => Error;
  onPhone: (ctx: ToolCtx) => boolean;
  wsReady: (ctx: ToolCtx) => Promise<{ ok: boolean; reason?: string }>;
  hasWorker: () => Promise<{ ok: boolean; reason?: string }>;
  modelFor: (ctx: ToolCtx, capability: string) => Promise<{ ok: true; model: any } | { ok: false; reason: string }>;
  relPath: z.ZodType<string>;
  ws: {
    list: (ctx: ToolCtx, dir?: string) => Promise<{ path: string; size: number }[]>;
    read: (ctx: ToolCtx, path: string) => Promise<{ text: string; hash: string }>;
    write: (ctx: ToolCtx, path: string, content: string, baseHash: string | null) => Promise<{ hash: string; conflict?: false } | { conflict: true; currentHash: string | null }>;
    remove: (ctx: ToolCtx, path: string) => Promise<void>;
  };
  assertLock: (ctx: ToolCtx, path: string) => Promise<void>;
  getTool: (id: string) => ToolDef | null;
};

const ok = async () => ({ ok: true });
const assetId = z.string().uuid();
type Base = Omit<ToolDef, "availability" | "run"> & { availability?: ToolDef["availability"]; run: NonNullable<ToolDef["run"]> };
const tool = (t: Partial<Base> & Pick<Base, "id" | "name" | "description" | "input" | "run">): ToolDef => ({
  family: "productividad", output: "texto", permissions: [], network: false, cost: "none", maxCalls: 40, timeoutMs: 120_000, parallel: true,
  env: ["android"], risk: "low", approval: "never", sideEffect: false, roles: "all", availability: ok, ...t,
} as ToolDef);

const MIME_BY_EXT: Record<string, string> = { md: "text/markdown", txt: "text/plain", json: "application/json", js: "text/javascript", ts: "text/plain", py: "text/x-python", html: "text/html", css: "text/css", csv: "text/csv", xml: "application/xml", svg: "image/svg+xml", yaml: "text/yaml", yml: "text/yaml" };
export const mimeFor = (path: string) => MIME_BY_EXT[path.split(".").pop()?.toLowerCase() ?? ""] ?? "text/plain";
const kindFor = (mime: string) => mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : mime.startsWith("video/") ? "video" : mime === "model/gltf-binary" ? "model3d" : "document";
const cleanName = (s: string, fallback = "archivo") => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 120) || fallback;

async function saveAsset(ctx: ToolCtx, bytes: Uint8Array, name: string, mime: string, kind = kindFor(mime), parentId: string | null = null): Promise<ToolAsset> {
  const a = await ctx.core.assets.put(ctx.projectId, (async function* () { yield bytes; })(), { kind, name, mime, capability: "chat.tool", parentId });
  return { id: a.id, mime: a.mime, name };
}
async function loadAsset(ctx: ToolCtx, id: string, H: PhoneHelpers) {
  const a = await ctx.core.assets.get(ctx.projectId, id);
  if (!a) throw new H.ToolRejected("Archivo inexistente en este proyecto. Usa assets.list para ver los ids.");
  return { meta: a, bytes: await ctx.core.assets.read(ctx.projectId, id) };
}
const b64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const isNative = async () => { try { const { Capacitor } = await import("@capacitor/core"); return Capacitor.isNativePlatform(); } catch { return false; } };

// ---------- Code index (definitions and references) ----------
const SYMBOL_RULES: { ext: RegExp; rules: [RegExp, string][] }[] = [
  { ext: /\.(m?[jt]sx?|cjs)$/, rules: [
    [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/, "función"],
    [/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, "clase"],
    [/^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/, "interfaz"],
    [/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, "tipo"],
    [/^\s*(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/, "enum"],
    [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/, "variable"],
    [/^\s+(?:public\s+|private\s+|protected\s+|static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{\s*$/, "método"],
  ] },
  { ext: /\.py$/, rules: [[/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, "función"], [/^\s*class\s+([A-Za-z_]\w*)/, "clase"], [/^([A-Z_][A-Z0-9_]*)\s*=/, "constante"]] },
  { ext: /\.go$/, rules: [[/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, "función"], [/^type\s+([A-Za-z_]\w*)/, "tipo"]] },
  { ext: /\.rs$/, rules: [[/^\s*(?:pub\s+)?fn\s+([A-Za-z_]\w*)/, "función"], [/^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/, "tipo"]] },
  { ext: /\.(java|kt|kts|cs|swift)$/, rules: [[/^\s*(?:[\w@]+\s+)*(?:class|interface|object|enum|struct)\s+([A-Za-z_]\w*)/, "clase"], [/^\s*(?:[\w@<>[\],]+\s+)*fun\s+([A-Za-z_]\w*)/, "función"]] },
  { ext: /\.(c|h|cpp|hpp|cc)$/, rules: [[/^[A-Za-z_][\w\s*&:<>]*\s+\**([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?\s*$/, "función"], [/^\s*(?:typedef\s+)?(?:struct|class|enum)\s+([A-Za-z_]\w*)/, "tipo"]] },
];
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function", "else", "do", "try", "constructor"]);
export function indexSymbols(path: string, text: string) {
  const set = SYMBOL_RULES.find((s) => s.ext.test(path)); if (!set) return [];
  const out: { name: string; kind: string; path: string; line: number }[] = [];
  text.split("\n").forEach((l, i) => { for (const [re, kind] of set.rules) { const m = re.exec(l); if (m?.[1] && !KEYWORDS.has(m[1])) { out.push({ name: m[1], kind, path, line: i + 1 }); break; } } });
  return out;
}

// ---------- Patches ----------
export function applyEdits(text: string, edits: { find: string; replace: string; all?: boolean }[]) {
  let out = text;
  for (const [n, e] of edits.entries()) {
    const count = out.split(e.find).length - 1;
    if (!count) throw new Error(`Edición ${n + 1}: no se encontró el texto a reemplazar. Lee el archivo y copia el fragmento exacto.`);
    if (count > 1 && !e.all) throw new Error(`Edición ${n + 1}: el texto aparece ${count} veces; agrega más contexto o usa all=true.`);
    out = e.all ? out.split(e.find).join(e.replace) : out.replace(e.find, () => e.replace);
  }
  return out;
}

// ---------- HTTP (public https only) ----------
async function httpCall(method: string, url: string, headers: Record<string, string>, body: string | undefined, binary: boolean, H: PhoneHelpers) {
  const { isSafeSourceUrl } = await import("../core/research");
  if (!isSafeSourceUrl(url)) throw new H.ToolRejected("Solo se permiten direcciones https públicas (sin localhost, redes privadas ni credenciales en la URL).");
  if (await isNative()) {
    const { CapacitorHttp } = await import("@capacitor/core");
    const r = await CapacitorHttp.request({ url, method, headers, ...(body !== undefined ? { data: body } : {}), responseType: binary ? "arraybuffer" : "text", connectTimeout: 20_000, readTimeout: 60_000 });
    if (r.url && r.url !== url && !isSafeSourceUrl(r.url)) throw new H.ToolRejected("La respuesta redirigió a un destino no permitido.");
    const type = Object.entries(r.headers ?? {}).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
    const bytes = binary ? (typeof r.data === "string" ? unb64(r.data) : new Uint8Array(r.data as ArrayBuffer)) : null;
    return { status: r.status, type: String(type), headers: r.headers ?? {}, text: binary ? "" : typeof r.data === "string" ? r.data : JSON.stringify(r.data), bytes };
  }
  const res = await fetch(url, { method, headers, body, credentials: "omit", redirect: "error" });
  const type = res.headers.get("content-type") ?? "";
  const h: Record<string, string> = {}; res.headers.forEach((v, k) => { h[k] = v; });
  if (binary) return { status: res.status, type, headers: h, text: "", bytes: new Uint8Array(await res.arrayBuffer()) };
  return { status: res.status, type, headers: h, text: (await res.text()).slice(0, 2_000_000), bytes: null };
}

// ---------- Local SQLite databases (encrypted assets, every write keeps the previous version) ----------
async function sqljs() {
  const initSqlJs = (await import("sql.js")).default;
  const node = typeof window === "undefined" && typeof process !== "undefined" && !!process.versions?.node;
  return initSqlJs(node ? {} : { locateFile: (f: string) => `/wasm/${f}` });
}
async function latestDb(ctx: ToolCtx, name: string) {
  const list = await ctx.core.assets.list(ctx.projectId, { kind: "database" });
  return list.filter((a) => a.name === `${name}.sqlite`).sort((a, b) => b.created_at - a.created_at || b.version - a.version)[0] ?? null;
}
const READ_SQL = /^\s*(select|with|pragma\s+table_info|pragma\s+table_list|explain)\b/i;

// ---------- Charts / QR (SVG, no network) ----------
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
export function chartSvg(c: { title: string; type: "bar" | "line" | "pie"; labels: string[]; values: number[] }) {
  const W = 800, Hh = 480, pad = 60, colors = ["#8b5cf6", "#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#14b8a6", "#ec4899", "#64748b"];
  const max = Math.max(...c.values.map(Math.abs), 1);
  let body = "";
  if (c.type === "pie") {
    const total = c.values.reduce((a, v) => a + Math.max(0, v), 0) || 1; let a0 = -Math.PI / 2;
    c.values.forEach((v, i) => { const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2, r = 170, cx = 300, cy = 260; const large = a1 - a0 > Math.PI ? 1 : 0;
      body += `<path d="M${cx},${cy} L${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)} Z" fill="${colors[i % colors.length]}"/>`;
      body += `<rect x="520" y="${110 + i * 28}" width="16" height="16" fill="${colors[i % colors.length]}"/><text x="544" y="${123 + i * 28}" font-size="14" fill="#e5e7eb">${esc(c.labels[i] ?? "")} (${v})</text>`; a0 = a1; });
  } else {
    const n = c.values.length, step = (W - pad * 2) / Math.max(n, 1), y = (v: number) => Hh - pad - (v / max) * (Hh - pad * 2);
    body += `<line x1="${pad}" y1="${Hh - pad}" x2="${W - pad}" y2="${Hh - pad}" stroke="#6b7280"/>`;
    if (c.type === "bar") c.values.forEach((v, i) => { body += `<rect x="${pad + i * step + step * 0.15}" y="${Math.min(y(v), Hh - pad)}" width="${step * 0.7}" height="${Math.abs(Hh - pad - y(v))}" fill="${colors[0]}" rx="4"/>`; });
    else body += `<polyline fill="none" stroke="${colors[0]}" stroke-width="3" points="${c.values.map((v, i) => `${pad + i * step + step / 2},${y(v)}`).join(" ")}"/>`;
    c.values.forEach((v, i) => { body += `<text x="${pad + i * step + step / 2}" y="${Hh - pad + 20}" font-size="12" text-anchor="middle" fill="#d1d5db">${esc((c.labels[i] ?? "").slice(0, 14))}</text><text x="${pad + i * step + step / 2}" y="${y(v) - 6}" font-size="12" text-anchor="middle" fill="#e5e7eb">${v}</text>`; });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}"><rect width="100%" height="100%" fill="#111118"/><text x="${W / 2}" y="36" font-size="22" text-anchor="middle" fill="#f9fafb" font-family="sans-serif">${esc(c.title)}</text><g font-family="sans-serif">${body}</g></svg>`;
}

export function phoneTools(H: PhoneHelpers): ToolDef[] {
  const R = H.ToolRejected;
  const rel = H.relPath;
  const providerFile = (id: string, name: string, capability: string, family: Family, needsPrompt: boolean): ToolDef => tool({
    id, name, description: `${name} sobre un archivo del proyecto con el modelo verificado que declare «${capability}».`, family,
    input: z.object({ assetId, text: needsPrompt ? z.string().min(1).max(4000) : z.string().max(4000).default("") }).strict(),
    permissions: ["provider", "network"], network: true, cost: "provider", capability, maxCalls: 10, timeoutMs: 300_000, approval: "if-cost", sideEffect: false,
    availability: async (ctx) => { const m = await H.modelFor(ctx, capability); return m.ok ? { ok: true } : { ok: false, reason: m.reason }; },
    run: async (ctx, i) => {
      const m = await H.modelFor(ctx, capability); if (!m.ok) throw new R(m.reason);
      const { meta, bytes } = await loadAsset(ctx, i.assetId, H);
      const { execute } = await import("../core/executor");
      const r = await execute(ctx.core, ctx.projectId, m.model, { capability, ...(i.text ? { prompt: i.text } : {}), files: [{ bytes, mime: meta.mime, name: meta.name ?? "archivo" }], parentAssetId: meta.id, saveText: true, ...(ctx.signal ? { signal: ctx.signal } : {}) });
      if (r.pending) return { output: `Trabajo remoto ${r.jobId} en curso; revisar en Trabajos.`, trusted: true };
      const files = r.text ? [] : r.assets.filter((a) => a.mime !== "text/plain").map((a) => ({ id: a.id, mime: a.mime, name: a.name ?? "archivo" }));
      return { output: (r.text ?? files.map((f) => `Archivo ${f.name}`).join("\n")).slice(0, 20_000), trusted: false, ...(files.length ? { assets: files } : {}) };
    },
  });

  return [
    // ===== Archivos del espacio de trabajo =====
    tool({ id: "fs.patch", name: "Editar archivo con parches", family: "ingenieria", description: "Reemplaza fragmentos exactos de un archivo (buscar → reemplazar) sin reescribirlo entero; guarda versión previa.",
      input: z.object({ path: rel, edits: z.array(z.object({ find: z.string().min(1).max(40_000), replace: z.string().max(80_000), all: z.boolean().default(false) }).strict()).min(1).max(30) }).strict(),
      permissions: ["pc.write"], sideEffect: true, parallel: false, env: ["android", "pc"], availability: H.wsReady,
      run: async (ctx, i) => {
        await H.assertLock(ctx, i.path);
        const cur = await H.ws.read(ctx, i.path);
        const next = applyEdits(cur.text, i.edits);
        const r = await H.ws.write(ctx, i.path, next, cur.hash);
        if (r.conflict) return { output: `CONFLICTO: ${i.path} cambió mientras se editaba. Vuelve a leerlo.`, trusted: true };
        return { output: `parcheado ${i.path} (${i.edits.length} cambios) hash=${r.hash}`, trusted: true };
      } }),
    tool({ id: "fs.move", name: "Mover, copiar o renombrar", family: "ingenieria", description: "Mueve, renombra o copia un archivo del espacio de trabajo. No sobrescribe un destino existente.",
      input: z.object({ from: rel, to: rel, copy: z.boolean().default(false) }).strict(), permissions: ["pc.write"], sideEffect: true, parallel: false, env: ["android", "pc"], availability: H.wsReady,
      run: async (ctx, i) => {
        if (i.from === i.to) throw new R("Origen y destino son iguales.");
        await H.assertLock(ctx, i.to); if (!i.copy) await H.assertLock(ctx, i.from);
        const src = await H.ws.read(ctx, i.from);
        const w = await H.ws.write(ctx, i.to, src.text, null);
        if (w.conflict) throw new R(`Ya existe ${i.to}; elige otro nombre o bórralo primero.`);
        if (!i.copy) await H.ws.remove(ctx, i.from);
        return { output: `${i.copy ? "copiado" : "movido"} ${i.from} → ${i.to}`, trusted: true };
      } }),
    tool({ id: "code.symbols", name: "Índice de código (símbolos)", family: "ingenieria", description: "Indexa funciones, clases, tipos y variables del espacio (JS/TS, Python, Go, Rust, Java/Kotlin, C/C++). Filtra por nombre o carpeta.",
      input: z.object({ query: z.string().max(120).default(""), path: z.string().max(400).default("") }).strict(), env: ["android", "pc"], availability: H.wsReady,
      run: async (ctx, i) => {
        const files = (await H.ws.list(ctx, i.path)).filter((f) => SYMBOL_RULES.some((s) => s.ext.test(f.path))).slice(0, 400);
        const q = i.query.toLowerCase(); const out: ReturnType<typeof indexSymbols> = [];
        for (const f of files) { const t = await H.ws.read(ctx, f.path).catch(() => null); if (t) out.push(...indexSymbols(f.path, t.text).filter((s) => !q || s.name.toLowerCase().includes(q))); if (out.length > 800) break; }
        return { output: JSON.stringify({ files: files.length, symbols: out.slice(0, 800) }), trusted: false };
      } }),
    tool({ id: "code.refs", name: "Definiciones y referencias", family: "ingenieria", description: "Encuentra dónde se define un símbolo y todos los lugares donde se usa.",
      input: z.object({ symbol: z.string().regex(/^[A-Za-z_$][\w$]{0,120}$/) }).strict(), env: ["android", "pc"], availability: H.wsReady,
      run: async (ctx, i) => {
        const re = new RegExp(`(^|[^\\w$])${i.symbol.replace(/\$/g, "\\$")}(?![\\w$])`);
        const defs: ReturnType<typeof indexSymbols> = [], refs: { path: string; line: number; text: string }[] = [];
        for (const f of (await H.ws.list(ctx)).slice(0, 600)) {
          const t = await H.ws.read(ctx, f.path).catch(() => null); if (!t) continue;
          defs.push(...indexSymbols(f.path, t.text).filter((s) => s.name === i.symbol));
          t.text.split("\n").forEach((l, n) => { if (refs.length < 400 && re.test(l)) refs.push({ path: f.path, line: n + 1, text: l.trim().slice(0, 200) }); });
        }
        return { output: JSON.stringify({ definitions: defs, references: refs }), trusted: false };
      } }),
    tool({ id: "ws.snapshot", name: "Punto de restauración", family: "ingenieria", description: "Guarda una copia completa del espacio de trabajo del teléfono como punto de restauración.",
      input: z.object({ label: z.string().min(1).max(80) }).strict(), permissions: ["local.write"], sideEffect: true, parallel: false, availability: async (ctx) => H.onPhone(ctx) ? { ok: true } : { ok: false, reason: "Los puntos de restauración aplican al espacio del teléfono; en PC usa git." },
      run: async (ctx, i) => {
        const files = await H.ws.list(ctx); if (!files.length) throw new R("El espacio está vacío.");
        const { zipStore } = await import("../zip");
        const enc = new TextEncoder(), entries = [];
        for (const f of files) entries.push({ path: f.path, data: enc.encode((await H.ws.read(ctx, f.path)).text) });
        const a = await saveAsset(ctx, zipStore(entries), `restauracion-${cleanName(i.label)}.zip`, "application/zip", "snapshot");
        return { output: `Punto de restauración ${a.id} con ${files.length} archivos.`, trusted: true };
      } }),
    tool({ id: "ws.restore", name: "Revertir a un punto de restauración", family: "ingenieria", description: "Devuelve el espacio del teléfono al estado de un punto de restauración (ws.snapshot). Las versiones actuales quedan recuperables.",
      input: z.object({ assetId }).strict(), permissions: ["local.write"], sideEffect: true, parallel: false, risk: "medium", approval: "always",
      target: (i) => `restaurar ${i.assetId}`, availability: async (ctx) => H.onPhone(ctx) ? { ok: true } : { ok: false, reason: "Solo para el espacio del teléfono." },
      run: async (ctx, i) => {
        const { meta, bytes } = await loadAsset(ctx, i.assetId, H);
        if (meta.kind !== "snapshot") throw new R("Ese archivo no es un punto de restauración.");
        const { extractArchive, asText } = await import("../archive");
        const entries = await extractArchive(bytes, "snapshot.zip");
        const keep = new Set(entries.map((e) => e.path));
        for (const f of await H.ws.list(ctx)) if (!keep.has(f.path)) await H.ws.remove(ctx, f.path);
        for (const e of entries) { const t = asText(e.data) ?? ""; const cur = await H.ws.read(ctx, e.path).catch(() => null); if (cur?.text !== t) await H.ws.write(ctx, e.path, t, cur?.hash ?? null); }
        return { output: `Espacio restaurado: ${entries.length} archivos.`, trusted: true };
      } }),

    // ===== Archivos del proyecto (biblioteca cifrada) =====
    tool({ id: "assets.list", name: "Archivos del proyecto", description: "Lista imágenes, audios, videos, documentos, bases y comprimidos del proyecto con su id (para usarlos en otras herramientas).",
      input: z.object({ kind: z.string().max(30).optional(), search: z.string().max(120).optional() }).strict(),
      run: async (ctx, i) => { const list = await ctx.core.assets.list(ctx.projectId, { ...(i.kind ? { kind: i.kind } : {}), ...(i.search ? { search: i.search } : {}) }); return { output: JSON.stringify(list.slice(0, 150).map((a) => ({ id: a.id, name: a.name, kind: a.kind, mime: a.mime, size: a.size, created: new Date(a.created_at).toISOString() }))), trusted: false }; } }),
    tool({ id: "files.attach", name: "Entregar archivo en el chat", description: "Adjunta a la respuesta un archivo existente del proyecto para verlo o descargarlo.",
      input: z.object({ assetId }).strict(), run: async (ctx, i) => { const { meta } = await loadAsset(ctx, i.assetId, H); return { output: `Adjuntado ${meta.name ?? meta.id}`, trusted: true, assets: [{ id: meta.id, mime: meta.mime, name: meta.name ?? "archivo" }] }; } }),
    tool({ id: "files.export", name: "Exportar archivos del espacio", description: "Convierte archivos del espacio de trabajo en descargables (uno tal cual, varios en ZIP).",
      input: z.object({ paths: z.array(rel).min(1).max(500), name: z.string().max(80).default("exportacion") }).strict(), permissions: ["local.write"], sideEffect: true, env: ["android", "pc"], availability: H.wsReady,
      run: async (ctx, i) => {
        const enc = new TextEncoder();
        if (i.paths.length === 1) { const p = i.paths[0]!; const t = await H.ws.read(ctx, p); const a = await saveAsset(ctx, enc.encode(t.text), p.split("/").pop()!, mimeFor(p)); return { output: `Exportado ${p}`, trusted: true, assets: [a] }; }
        const { zipStore } = await import("../zip");
        const entries = []; for (const p of i.paths) entries.push({ path: p, data: enc.encode((await H.ws.read(ctx, p)).text) });
        const a = await saveAsset(ctx, zipStore(entries), `${cleanName(i.name)}.zip`, "application/zip");
        return { output: `Exportados ${i.paths.length} archivos en ZIP`, trusted: true, assets: [a] };
      } }),
    tool({ id: "archive.create", name: "Crear comprimido", family: "ingenieria", description: "Crea ZIP, 7z, TAR o TAR.GZ con archivos del espacio de trabajo y/o archivos del proyecto. (RAR solo se puede extraer: su formato de creación es propietario.)",
      input: z.object({ format: z.enum(["zip", "7z", "tar", "tar.gz"]), name: z.string().min(1).max(80), paths: z.array(rel).max(2000).default([]), assetIds: z.array(assetId).max(100).default([]), all: z.boolean().default(false) }).strict(),
      permissions: ["local.write"], sideEffect: true, timeoutMs: 300_000, parallel: false, env: ["android", "pc"], availability: H.wsReady,
      run: async (ctx, i) => {
        const enc = new TextEncoder(); const paths = i.all ? (await H.ws.list(ctx)).map((f) => f.path) : i.paths;
        const entries = []; for (const p of paths) entries.push({ path: p, data: enc.encode((await H.ws.read(ctx, p)).text) });
        for (const id of i.assetIds) { const { meta, bytes } = await loadAsset(ctx, id, H); entries.push({ path: `archivos/${cleanName(meta.name ?? id)}`, data: bytes }); }
        if (!entries.length) throw new R("Indica paths, assetIds o all=true.");
        const { createArchive } = await import("../archive");
        const bytes = await createArchive(entries, i.format);
        const mime = { zip: "application/zip", "7z": "application/x-7z-compressed", tar: "application/x-tar", "tar.gz": "application/gzip" }[i.format as "zip"];
        const a = await saveAsset(ctx, bytes, `${cleanName(i.name)}.${i.format}`, mime, "archive");
        return { output: `Creado ${a.name} (${entries.length} archivos, ${bytes.length} bytes)`, trusted: true, assets: [a] };
      } }),
    tool({ id: "archive.extract", name: "Extraer comprimido", family: "ingenieria", description: "Extrae ZIP, 7z, RAR, TAR, GZ, BZ2 o XZ de un archivo del proyecto: los de texto van al espacio de trabajo (carpeta `into`) y los binarios a la biblioteca.",
      input: z.object({ assetId, into: z.string().max(200).default("") }).strict(), permissions: ["local.write"], sideEffect: true, timeoutMs: 300_000, parallel: false,
      availability: async (ctx) => H.onPhone(ctx) ? { ok: true } : { ok: false, reason: "La extracción escribe en el espacio del teléfono." },
      run: async (ctx, i) => {
        const { meta, bytes } = await loadAsset(ctx, i.assetId, H);
        const { extractArchive, asText } = await import("../archive");
        const entries = await extractArchive(bytes, meta.name ?? "archivo.zip");
        const base = i.into.replace(/^\/+|\/+$/g, ""); let texts = 0; const bins: ToolAsset[] = [], skipped: string[] = [];
        for (const e of entries) {
          const t = asText(e.data), path = base ? `${base}/${e.path}` : e.path;
          if (t !== null) { const cur = await H.ws.read(ctx, path).catch(() => null); const w = await H.ws.write(ctx, path, t, cur?.hash ?? null).catch((x) => { skipped.push(`${path}: ${x.message}`); return null; }); if (w && !w.conflict) texts++; }
          else if (bins.length < 60) bins.push(await saveAsset(ctx, e.data, e.path.split("/").pop() ?? "archivo", "application/octet-stream", "document", meta.id));
          else skipped.push(e.path);
        }
        return { output: `Extraídos ${entries.length}: ${texts} de texto al espacio${base ? ` (${base}/)` : ""}, ${bins.length} binarios a la biblioteca.${skipped.length ? ` Omitidos: ${skipped.slice(0, 10).join("; ")}` : ""}`, trusted: true, ...(bins.length ? { assets: bins.slice(0, 10) } : {}) };
      } }),

    // ===== Ejecutar código en el teléfono =====
    tool({ id: "code.python", name: "Ejecutar Python", family: "desarrollo", description: "Ejecuta Python 3 (biblioteca estándar) en un sandbox aislado del teléfono sin red, archivos de la app ni claves. Usa print() para mostrar resultados.",
      input: z.object({ source: z.string().min(1).max(120_000), input: z.string().max(60_000).default("") }).strict(), env: ["sandbox"], timeoutMs: 100_000, maxCalls: 30, availability: H.hasWorker,
      run: async (ctx, i) => { const { runPython } = await import("../code/python"); const r = await runPython(i.source, i.input, ctx.signal); return { output: r.ok ? r.output || "(sin salida)" : `Error:\n${r.error}\n${r.output}`, trusted: true, evidence: { kind: "exec", status: r.ok ? "passed" : "failed", command: "python (pyodide)", output: (r.ok ? r.output : `${r.error}\n${r.output}`).slice(0, 4000) } }; } }),
    tool({ id: "code.ts", name: "Ejecutar TypeScript", family: "desarrollo", description: "Transpila TypeScript y lo ejecuta en el sandbox aislado (sin imports, red ni almacenamiento). Usa console.log.",
      input: z.object({ source: z.string().min(1).max(60_000), input: z.string().max(60_000).default("") }).strict(), env: ["sandbox"], timeoutMs: 20_000, availability: H.hasWorker,
      run: async (ctx, i) => {
        const { transpileTs } = await import("../code/python"); let js: string;
        try { js = await transpileTs(i.source); } catch (e) { return { output: `Error de TypeScript: ${(e as Error).message}`, trusted: true }; }
        const { runCode } = await import("../code/run"); const r = await runCode(js, i.input, ctx.signal);
        return { output: r.ok ? r.output : `Error: ${r.error}\n${r.output}`, trusted: true, evidence: { kind: "exec", status: r.ok ? "passed" : "failed", command: "typescript→quickjs", output: (r.output || r.error || "").slice(0, 4000) } };
      } }),
    tool({ id: "code.file", name: "Ejecutar archivo .py/.ts/.js del espacio", family: "desarrollo", description: "Ejecuta un archivo Python, TypeScript o JavaScript autocontenido del espacio de trabajo en el sandbox aislado.",
      input: z.object({ path: rel, input: z.string().max(60_000).default("") }).strict(), env: ["sandbox"], timeoutMs: 100_000,
      availability: async (ctx) => { const w = await H.hasWorker(); return w.ok ? H.wsReady(ctx) : w; },
      run: async (ctx, i) => {
        const src = (await H.ws.read(ctx, i.path)).text;
        let r;
        if (i.path.endsWith(".py")) { const { runPython } = await import("../code/python"); r = await runPython(src, i.input, ctx.signal); }
        else if (/\.(m?js|ts)$/.test(i.path)) { const { transpileTs } = await import("../code/python"); const { runCode } = await import("../code/run"); r = await runCode(i.path.endsWith(".ts") ? await transpileTs(src) : src, i.input, ctx.signal); }
        else throw new R("Solo .py, .ts o .js en el teléfono. Otros lenguajes: pc.exec o ssh.exec.");
        return { output: r.ok ? `estado=ok\n${r.output}` : `estado=error\n${r.error}\n${r.output}`, trusted: true, evidence: { kind: "exec", status: r.ok ? "passed" : "failed", command: `run ${i.path}`, output: (r.ok ? r.output : `${r.error}\n${r.output}`).slice(0, 4000) } };
      } }),

    // ===== Internet y APIs =====
    tool({ id: "web.fetch", name: "Leer página web", family: "investigacion", description: "Descarga una página https pública y devuelve su texto legible (o JSON/texto tal cual). Sin cookies ni claves.",
      input: z.object({ url: z.string().url().max(2000) }).strict(), permissions: ["network"], network: true, timeoutMs: 60_000,
      run: async (ctx, i) => {
        const r = await httpCall("GET", i.url, { accept: "text/html,application/json,text/plain,*/*" }, undefined, false, H);
        const { htmlToText } = await import("../core/research");
        const body = r.type.includes("html") ? htmlToText(r.text, 20_000) : r.text.slice(0, 20_000);
        return { output: `HTTP ${r.status} ${r.type}\n${body}`, trusted: false };
      } }),
    tool({ id: "web.download", name: "Descargar archivo de internet", family: "investigacion", description: "Descarga un archivo https público (máx. 50 MB) a la biblioteca del proyecto.",
      input: z.object({ url: z.string().url().max(2000), name: z.string().max(120).optional() }).strict(), permissions: ["network", "local.write"], network: true, sideEffect: true, timeoutMs: 180_000, maxCalls: 20,
      run: async (ctx, i) => {
        const r = await httpCall("GET", i.url, {}, undefined, true, H);
        if (r.status >= 400) throw new R(`HTTP ${r.status}`);
        if (!r.bytes || r.bytes.length > 50 * 1024 * 1024) throw new R("Archivo vacío o mayor a 50 MB.");
        const name = cleanName(i.name ?? decodeURIComponent(new URL(i.url).pathname.split("/").pop() || "descarga"));
        const a = await saveAsset(ctx, r.bytes, name, r.type.split(";")[0]?.trim() || "application/octet-stream");
        return { output: `Descargado ${name} (${r.bytes.length} bytes, id ${a.id})`, trusted: true, assets: [a] };
      } }),
    tool({ id: "http.request", name: "Petición HTTP / probar API", family: "desarrollo", description: "Envía una petición HTTP (GET, POST, PUT, PATCH, DELETE) a una API https pública y devuelve estado, cabeceras y cuerpo. Pide aprobación.",
      input: z.object({ method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]), url: z.string().url().max(2000), headers: z.record(z.string().max(4000)).default({}), body: z.string().max(200_000).optional() }).strict(),
      permissions: ["network"], network: true, sideEffect: true, risk: "medium", approval: "always", timeoutMs: 90_000, maxCalls: 30, parallel: false,
      target: (i) => `${i.method} ${i.url}`,
      run: async (ctx, i) => {
        const t0 = Date.now(); const r = await httpCall(i.method, i.url, i.headers, i.body, false, H);
        const hdr = Object.entries(r.headers).filter(([k]) => !/set-cookie/i.test(k)).slice(0, 30).map(([k, v]) => `${k}: ${v}`).join("\n");
        return { output: `HTTP ${r.status} (${Date.now() - t0} ms)\n${hdr}\n\n${r.text.slice(0, 15_000)}`, trusted: false };
      } }),

    // ===== Bases de datos locales =====
    tool({ id: "db.list", name: "Bases de datos del proyecto", family: "datos", description: "Lista las bases SQLite locales del proyecto y sus versiones (respaldos automáticos).", input: z.object({}).strict(),
      run: async (ctx) => { const list = await ctx.core.assets.list(ctx.projectId, { kind: "database" }); const by: Record<string, { versions: number; latest: string; size: number }> = {}; for (const a of list) { const n = (a.name ?? "").replace(/\.sqlite$/, ""); const e = by[n] ??= { versions: 0, latest: a.id, size: a.size }; e.versions++; } return { output: JSON.stringify(by), trusted: true }; } }),
    tool({ id: "db.sql", name: "SQL en base local", family: "datos", description: "Ejecuta SQL en una base SQLite local del proyecto (se crea si no existe). write=true permite crear tablas, insertar, migrar (varias sentencias en una transacción); cada escritura guarda la versión anterior como respaldo.",
      input: z.object({ db: z.string().regex(/^[\w-]{1,60}$/), sql: z.string().min(1).max(100_000), params: z.array(z.union([z.string(), z.number(), z.null()])).max(200).default([]), write: z.boolean().default(false) }).strict(),
      permissions: ["local.write"], sideEffect: true, parallel: false, timeoutMs: 60_000, maxCalls: 80,
      run: async (ctx, i) => {
        if (!i.write && !READ_SQL.test(i.sql)) throw new R("Consulta de solo lectura: usa write=true para modificar.");
        if (!i.write && /;\s*\S/.test(i.sql.trim().replace(/;$/, ""))) throw new R("Solo una sentencia en modo lectura.");
        if (/\b(attach|detach|load_extension)\b/i.test(i.sql)) throw new R("ATTACH/DETACH/extensiones no permitidos.");
        const SQL = await sqljs(); const prev = await latestDb(ctx, i.db);
        const db = new SQL.Database(prev ? await ctx.core.assets.read(ctx.projectId, prev.id) : undefined);
        try {
          let res;
          if (i.write) { db.run("BEGIN"); try { res = i.params.length ? [db.exec(i.sql, i.params)].flat() : db.exec(i.sql); db.run("COMMIT"); } catch (e) { db.run("ROLLBACK"); throw new R(`SQL revertido: ${(e as Error).message}`); } }
          else res = db.exec(i.sql, i.params);
          let saved = "";
          if (i.write) { const a = await saveAsset(ctx, db.export(), `${i.db}.sqlite`, "application/vnd.sqlite3", "database", prev?.id ?? null); saved = ` Guardado (versión ${a.id}${prev ? `, anterior ${prev.id} conservada` : ", base nueva"}).`; }
          const rows = res.map((r) => ({ columns: r.columns, rows: r.values.slice(0, 200), total: r.values.length }));
          return { output: `${JSON.stringify(rows).slice(0, 18_000)}${saved} Filas modificadas: ${db.getRowsModified()}`, trusted: false };
        } finally { db.close(); }
      } }),

    // ===== Documentos, imágenes, audio, 3D =====
    tool({ id: "doc.read", name: "Leer documento", family: "productividad", description: "Extrae el texto de un PDF, Word, Excel/CSV o texto del proyecto.", input: z.object({ assetId }).strict(), timeoutMs: 180_000,
      run: async (ctx, i) => { const { meta, bytes } = await loadAsset(ctx, i.assetId, H); const { extractText } = await import("../docs/extract"); const r = await extractText(bytes, meta.name ?? "archivo", meta.mime); return { output: `${r.warning ? `Aviso: ${r.warning}\n` : ""}${r.text.slice(0, 30_000)}`, trusted: false }; } }),
    { ...tool({ id: "media.ocr", name: "Leer texto de imagen (OCR)", family: "multimedia", description: "Reconoce texto en una imagen o PDF escaneado del proyecto con OCR local (español/inglés, sin internet).",
      input: z.object({ assetId, lang: z.enum(["spa", "eng", "spa+eng"]).default("spa+eng") }).strict(), timeoutMs: 600_000, parallel: false, maxCalls: 10,
      run: async (ctx, i) => {
        const { meta, bytes } = await loadAsset(ctx, i.assetId, H); const ocr = await import("../docs/ocr");
        const r = meta.mime === "application/pdf" ? await ocr.ocrPdf(bytes, i.lang) : meta.mime.startsWith("image/") ? await ocr.ocrImage(bytes, meta.mime, i.lang) : null;
        if (!r) throw new R("OCR solo para imágenes o PDF.");
        return { output: JSON.stringify(r).slice(0, 30_000), trusted: false };
      } }) },
    providerFile("image.edit", "Editar imagen con IA", "image.edit", "multimedia", true),
    providerFile("image.upscale", "Mejorar resolución con IA", "image.upscale", "multimedia", false),
    providerFile("image.remove_bg", "Quitar fondo con IA", "image.remove_bg", "multimedia", false),
    providerFile("audio.transcribe", "Transcribir audio", "audio.transcribe", "multimedia", false),
    providerFile("audio.translate", "Traducir audio al inglés", "audio.translate", "multimedia", false),
    tool({ id: "image.process", name: "Procesar imagen localmente", family: "multimedia", description: "Redimensiona, recorta, gira, voltea, pasa a blanco y negro, ajusta brillo/contraste y convierte a PNG/JPEG/WebP en el teléfono (sin IA ni internet).",
      input: z.object({ assetId, width: z.number().int().min(8).max(8192).optional(), height: z.number().int().min(8).max(8192).optional(), crop: z.object({ x: z.number().int().min(0), y: z.number().int().min(0), w: z.number().int().min(1), h: z.number().int().min(1) }).optional(), rotate: z.enum(["0", "90", "180", "270"]).default("0"), flip: z.enum(["none", "h", "v"]).default("none"), grayscale: z.boolean().default(false), brightness: z.number().min(0).max(3).default(1), contrast: z.number().min(0).max(3).default(1), format: z.enum(["png", "jpeg", "webp"]).default("png"), quality: z.number().min(0.1).max(1).default(0.9) }).strict(),
      permissions: ["local.write"], sideEffect: true, maxCalls: 30,
      availability: async () => typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined" ? { ok: false, reason: "Este entorno no tiene lienzo de imagen." } : { ok: true },
      run: async (ctx, i) => {
        const { meta, bytes } = await loadAsset(ctx, i.assetId, H);
        if (!meta.mime.startsWith("image/")) throw new R("No es una imagen.");
        let bmp = await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer], { type: meta.mime }));
        if (i.crop) bmp = await createImageBitmap(bmp, i.crop.x, i.crop.y, Math.min(i.crop.w, bmp.width - i.crop.x), Math.min(i.crop.h, bmp.height - i.crop.y));
        const ratio = bmp.width / bmp.height;
        const w = i.width ?? (i.height ? Math.round(i.height * ratio) : bmp.width), h = i.height ?? (i.width ? Math.round(i.width / ratio) : bmp.height);
        const rot = Number(i.rotate), swap = rot === 90 || rot === 270;
        const canvas = new OffscreenCanvas(swap ? h : w, swap ? w : h); const g = canvas.getContext("2d")!;
        g.filter = `${i.grayscale ? "grayscale(1) " : ""}brightness(${i.brightness}) contrast(${i.contrast})`;
        g.translate(canvas.width / 2, canvas.height / 2); g.rotate((rot * Math.PI) / 180); g.scale(i.flip === "h" ? -1 : 1, i.flip === "v" ? -1 : 1);
        g.drawImage(bmp, -w / 2, -h / 2, w, h);
        const blob = await canvas.convertToBlob({ type: `image/${i.format}`, quality: i.quality });
        const out = new Uint8Array(await blob.arrayBuffer());
        const a = await saveAsset(ctx, out, `${(meta.name ?? "imagen").replace(/\.\w+$/, "")}-editada.${i.format === "jpeg" ? "jpg" : i.format}`, `image/${i.format}`, "image", meta.id);
        return { output: `Imagen ${canvas.width}×${canvas.height} ${i.format} (${out.length} bytes)`, trusted: true, assets: [a] };
      } }),
    tool({ id: "audio.convert", name: "Convertir y procesar audio", family: "multimedia", description: "Convierte audio a WAV en el teléfono, recorta (inicio/fin en segundos) y normaliza volumen a LUFS con límite de pico real. Video se convierte en Editor de video o PC.",
      input: z.object({ assetId, start: z.number().min(0).default(0), end: z.number().min(0).optional(), lufs: z.number().min(-40).max(-5).optional(), truePeak: z.number().min(-9).max(0).default(-1) }).strict(),
      permissions: ["local.write"], sideEffect: true, timeoutMs: 300_000, parallel: false, maxCalls: 10,
      availability: async () => typeof AudioContext === "undefined" && typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext === "undefined" ? { ok: false, reason: "Este entorno no decodifica audio." } : { ok: true },
      run: async (ctx, i) => {
        const { meta, bytes } = await loadAsset(ctx, i.assetId, H);
        const { decodeAudio, encodeWav } = await import("../audio-edit");
        let pcm = await decodeAudio(bytes);
        const s = Math.floor(i.start * pcm.sampleRate), e = i.end ? Math.floor(i.end * pcm.sampleRate) : pcm.channels[0]!.length;
        if (e <= s) throw new R("El fin debe ser mayor que el inicio.");
        pcm = { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice(s, e)) };
        let note = "";
        if (i.lufs !== undefined) { const { normalizeLoudness } = await import("../media/loudness"); const r = normalizeLoudness(pcm, { lufs: i.lufs, truePeak: i.truePeak }) as unknown as { audio?: typeof pcm; after?: { integratedLufs: number } } & typeof pcm; pcm = r.audio ?? r; note = r.after ? ` (${r.after.integratedLufs.toFixed(1)} LUFS)` : ""; }
        const wav = encodeWav(pcm);
        const a = await saveAsset(ctx, wav, `${(meta.name ?? "audio").replace(/\.\w+$/, "")}.wav`, "audio/wav", "audio", meta.id);
        return { output: `Audio WAV ${(pcm.channels[0]!.length / pcm.sampleRate).toFixed(1)} s${note}`, trusted: true, assets: [a] };
      } }),
    tool({ id: "cad.create", name: "Modelado 3D paramétrico (CAD)", family: "multimedia", description: "Construye un sólido 3D con cajas, esferas, cilindros, extrusiones y uniones/restas/intersecciones (milímetros) y lo exporta a STL, OBJ o STEP. Documento: {version:1, unit:'mm', name, features:[{id, kind, size:[x,y,z], position, rotation (grados), scale:[1,1,1], refs:[ids para booleanas], points:[[x,y]] para extrude, visible}]}.",
      input: z.object({ doc: z.object({ version: z.literal(1), unit: z.literal("mm"), name: z.string().min(1).max(80), features: z.array(z.object({ id: z.string().min(1).max(40), kind: z.enum(["box", "sphere", "cylinder", "extrude", "union", "subtract", "intersect"]), size: z.tuple([z.number(), z.number(), z.number()]).default([20, 20, 20]), position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]), rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]), scale: z.tuple([z.number(), z.number(), z.number()]).default([1, 1, 1]), refs: z.array(z.string()).max(16).default([]), points: z.array(z.tuple([z.number(), z.number()])).max(128).default([]), visible: z.boolean().default(true) }).strict()).min(1).max(64) }).strict(), format: z.enum(["stl", "obj", "step"]).default("stl") }).strict(),
      permissions: ["local.write"], sideEffect: true, timeoutMs: 120_000, maxCalls: 20,
      run: async (ctx, i) => {
        const { exportCad, cadMetrics } = await import("../media/cad");
        const bytes = await exportCad(i.doc, i.format); const m = cadMetrics(i.doc);
        const mime = i.format === "step" ? "model/step" : i.format === "obj" ? "model/obj" : "model/stl";
        const a = await saveAsset(ctx, bytes, `${cleanName(i.doc.name)}.${i.format}`, mime, "model3d");
        return { output: `Modelo ${i.format.toUpperCase()} creado; volumen ${m.volumeMm3.toFixed(1)} mm³.`, trusted: true, assets: [a] };
      } }),
    tool({ id: "chart.create", name: "Crear gráfica", family: "datos", description: "Genera una gráfica de barras, líneas o pastel como imagen SVG.",
      input: z.object({ title: z.string().max(120), type: z.enum(["bar", "line", "pie"]), labels: z.array(z.string().max(60)).min(1).max(60), values: z.array(z.number()).min(1).max(60) }).strict(), permissions: ["local.write"], sideEffect: true,
      run: async (ctx, i) => { if (i.labels.length !== i.values.length) throw new R("labels y values deben tener el mismo largo."); const a = await saveAsset(ctx, new TextEncoder().encode(chartSvg(i)), `${cleanName(i.title, "grafica")}.svg`, "image/svg+xml", "image"); return { output: "Gráfica creada", trusted: true, assets: [a] }; } }),
    tool({ id: "qr.generate", name: "Crear código QR", description: "Genera un código QR (SVG) con un texto o enlace.", input: z.object({ text: z.string().min(1).max(2000) }).strict(), permissions: ["local.write"], sideEffect: true,
      run: async (ctx, i) => { const QR = await import("qrcode"); const svg = await QR.toString(i.text, { type: "svg", margin: 2, width: 512 }); const a = await saveAsset(ctx, new TextEncoder().encode(svg), "codigo-qr.svg", "image/svg+xml", "image"); return { output: "QR creado", trusted: true, assets: [a] }; } }),
    tool({ id: "data.analyze", name: "Analizar datos (CSV/Excel)", family: "datos", description: "Estadísticas por columna (conteo, faltantes, mín, máx, media, mediana, desviación, anomalías) de un CSV o Excel del proyecto.",
      input: z.object({ assetId }).strict(), timeoutMs: 120_000,
      run: async (ctx, i) => {
        const { bytes } = await loadAsset(ctx, i.assetId, H); const da = await import("../data-analysis");
        const tables = await da.readTables(bytes);
        const out = tables.slice(0, 5).map((t) => ({ table: t.name, rows: t.rows.length, headers: t.headers, stats: t.headers.map((_, n) => { try { const s = da.analyzeColumn(t, n); return s.count ? s : { column: t.headers[n], numeric: false }; } catch { return { column: t.headers[n], numeric: false }; } }), sample: t.rows.slice(0, 5) }));
        return { output: JSON.stringify(out).slice(0, 25_000), trusted: false };
      } }),

    // ===== Utilidades =====
    tool({ id: "datetime.now", name: "Fecha y hora actual", description: "Devuelve la fecha, hora y zona horaria del teléfono.", input: z.object({}).strict(),
      run: async () => { const d = new Date(); return { output: JSON.stringify({ iso: d.toISOString(), local: d.toLocaleString("es-MX", { dateStyle: "full", timeStyle: "long" }), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, epochMs: d.getTime() }), trusted: true }; } }),
    tool({ id: "text.diff", name: "Comparar textos o archivos", family: "ingenieria", description: "Muestra las diferencias (diff unificado) entre dos textos o dos archivos del espacio.",
      input: z.object({ a: z.string().max(400_000).optional(), b: z.string().max(400_000).optional(), aPath: rel.optional(), bPath: rel.optional() }).strict(),
      run: async (ctx, i) => {
        const a = i.aPath ? (await H.ws.read(ctx, i.aPath)).text : i.a, b = i.bPath ? (await H.ws.read(ctx, i.bPath)).text : i.b;
        if (a === undefined || b === undefined) throw new R("Indica a/b o aPath/bPath.");
        const { createTwoFilesPatch } = await import("diff");
        return { output: createTwoFilesPatch(i.aPath ?? "a", i.bPath ?? "b", a, b).slice(0, 25_000), trusted: false };
      } }),
    tool({ id: "hash.compute", name: "Calcular hash", description: "Calcula MD5, SHA-1, SHA-256 o SHA-512 de un texto, archivo del espacio o archivo del proyecto.",
      input: z.object({ algo: z.enum(["md5", "sha1", "sha256", "sha512"]).default("sha256"), text: z.string().max(400_000).optional(), path: rel.optional(), assetId: assetId.optional() }).strict(),
      run: async (ctx, i) => {
        const data = i.assetId ? (await loadAsset(ctx, i.assetId, H)).bytes : new TextEncoder().encode(i.path ? (await H.ws.read(ctx, i.path)).text : i.text ?? "");
        let hex: string;
        if (i.algo === "md5") { const { md5 } = await import("hash-wasm"); hex = await md5(data); }
        else { const d = await crypto.subtle.digest({ sha1: "SHA-1", sha256: "SHA-256", sha512: "SHA-512" }[i.algo as "sha1"], data.slice().buffer as ArrayBuffer); hex = [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
        return { output: `${i.algo}=${hex} (${data.length} bytes)`, trusted: true };
      } }),
    tool({ id: "calc.finance", name: "Cálculos financieros", family: "datos", description: "Préstamo/amortización (principal, tasa anual %, meses), VAN (tasa %, flujos) o TIR (flujos).",
      input: z.object({ kind: z.enum(["loan", "npv", "irr"]), principal: z.number().positive().optional(), annualRate: z.number().min(0).max(1000).optional(), months: z.number().int().min(1).max(1200).optional(), rate: z.number().optional(), cashflows: z.array(z.number()).max(600).optional() }).strict(),
      run: async (_c, i) => {
        const pt = await import("../pro-tools");
        if (i.kind === "loan") { if (!i.principal || i.annualRate === undefined || !i.months) throw new R("loan necesita principal, annualRate y months."); const r = pt.loan(i.principal, i.annualRate, i.months) as unknown as Record<string, unknown> & { schedule?: unknown[] }; return { output: JSON.stringify({ ...r, schedule: r.schedule?.slice(0, 24) }), trusted: true }; }
        if (!i.cashflows?.length) throw new R("Indica cashflows.");
        return { output: JSON.stringify(i.kind === "npv" ? { npv: pt.npv(i.rate ?? 0, i.cashflows) } : { irrPct: pt.irr(i.cashflows) }), trusted: true };
      } }),
    tool({ id: "unit.convert", name: "Convertir unidades", description: "Convierte longitud, masa, temperatura, volumen, área, velocidad, datos, etc.",
      input: z.object({ value: z.number(), from: z.string().max(20), to: z.string().max(20) }).strict(),
      run: async (_c, i) => { const pt = await import("../pro-tools"); try { return { output: `${i.value} ${i.from} = ${pt.convertUnit(i.value, i.from, i.to)} ${i.to}`, trusted: true }; } catch (e) { return { output: `${(e as Error).message}. Unidades: ${JSON.stringify(pt.UNIT_GROUPS)}`, trusted: true }; } } }),
    tool({ id: "clipboard.write", name: "Copiar al portapapeles", description: "Copia un texto al portapapeles del teléfono.", input: z.object({ text: z.string().min(1).max(100_000) }).strict(), sideEffect: true,
      run: async (_c, i) => { const { Clipboard } = await import("@capacitor/clipboard"); await Clipboard.write({ string: i.text }); return { output: "Copiado al portapapeles", trusted: true }; } }),
    tool({ id: "clipboard.read", name: "Leer portapapeles", description: "Lee el texto del portapapeles del teléfono (pide aprobación por privacidad).", input: z.object({}).strict(), permissions: ["sensitive"], approval: "always", risk: "medium",
      target: () => "leer portapapeles",
      run: async () => { const { Clipboard } = await import("@capacitor/clipboard"); const r = await Clipboard.read(); return { output: (r.value ?? "").slice(0, 20_000) || "(vacío)", trusted: false }; } }),
    tool({ id: "device.info", name: "Recursos del teléfono", family: "infraestructura", description: "Modelo, sistema, núcleos, RAM, memoria usada por la app, almacenamiento, batería y GPU del teléfono.", input: z.object({}).strict(),
      run: async () => {
        const info: Record<string, unknown> = { cores: navigator.hardwareConcurrency, ramGb: (navigator as { deviceMemory?: number }).deviceMemory ?? null };
        try { const { Device } = await import("@capacitor/device"); const d = await Device.getInfo(); Object.assign(info, { model: d.model, manufacturer: d.manufacturer, os: `${d.operatingSystem} ${d.osVersion}`, androidSdk: d.androidSDKVersion, webView: d.webViewVersion, appMemoryUsedMb: d.memUsed ? Math.round(d.memUsed / 1048576) : null, diskFreeGb: d.realDiskFree ? +(d.realDiskFree / 1e9).toFixed(1) : null, diskTotalGb: d.realDiskTotal ? +(d.realDiskTotal / 1e9).toFixed(1) : null }); const b = await Device.getBatteryInfo(); info["battery"] = { level: b.batteryLevel, charging: b.isCharging }; } catch { /* web */ }
        try { const est = await navigator.storage?.estimate?.(); if (est) info["appStorageMb"] = { used: Math.round((est.usage ?? 0) / 1048576), quota: Math.round((est.quota ?? 0) / 1048576) }; } catch { /* ignore */ }
        try { const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(1, 1) : null; const gl = c?.getContext("webgl") as WebGLRenderingContext | null; const ext = gl?.getExtension("WEBGL_debug_renderer_info"); if (gl && ext) info["gpu"] = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL); } catch { /* ignore */ }
        return { output: JSON.stringify(info), trusted: true };
      } }),
    tool({ id: "notify.now", name: "Notificación local", description: "Muestra una notificación en el teléfono (ahora o en N minutos).", input: z.object({ title: z.string().min(1).max(80), body: z.string().max(300).default(""), minutes: z.number().int().min(0).max(60 * 24 * 30).default(0) }).strict(), sideEffect: true, maxCalls: 10,
      run: async (_c, i) => {
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const perm = await LocalNotifications.requestPermissions(); if (perm.display !== "granted") throw new R("Permiso de notificaciones denegado.");
        await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2_000_000_000), title: i.title, body: i.body, ...(i.minutes ? { schedule: { at: new Date(Date.now() + i.minutes * 60_000), allowWhileIdle: false } } : {}) }] });
        return { output: i.minutes ? `Notificación programada en ${i.minutes} min` : "Notificación mostrada", trusted: true };
      } }),
    tool({ id: "schedule.add", name: "Programar revisiones periódicas", description: "Programa una serie de alarmas de revisión (cada N minutos, hasta 30 veces). Al sonar abren la revisión; por seguridad nunca ejecutan acciones con costo solas.",
      input: z.object({ everyMinutes: z.number().int().min(5).max(60 * 24 * 30), times: z.number().int().min(1).max(30), note: z.string().max(300) }).strict(), permissions: ["local.write"], sideEffect: true, maxCalls: 5, parallel: false,
      run: async (ctx, i) => { const { scheduleReview } = await import("./triggers"); for (let n = 1; n <= i.times; n++) await scheduleReview(ctx.core.repo, ctx.projectId, ctx.runId, Date.now() + n * i.everyMinutes * 60_000, "reminder", i.note); return { output: `${i.times} revisiones programadas cada ${i.everyMinutes} min`, trusted: true }; } }),
    tool({ id: "logs.read", name: "Registros de ejecución", family: "infraestructura", description: "Lee el registro de herramientas, errores y evidencias del proyecto (opcionalmente de una ejecución).",
      input: z.object({ runId: z.string().uuid().optional(), limit: z.number().int().min(1).max(200).default(50), errorsOnly: z.boolean().default(false) }).strict(),
      run: async (ctx, i) => {
        const rows = await ctx.core.repo.sql.all<{ run_id: string; agent: string | null; kind: string; tool: string | null; output: string; created_at: number }>(`SELECT run_id, agent, kind, tool, output, created_at FROM auto_observations WHERE project_id=?${i.runId ? " AND run_id=?" : ""}${i.errorsOnly ? " AND kind IN ('rejected','uncertain')" : ""} ORDER BY created_at DESC LIMIT ?`, [ctx.projectId, ...(i.runId ? [i.runId] : []), i.limit]);
        const jobs = await ctx.core.repo.sql.all<{ id: string; capability_id: string; status: string; error: string | null; updated_at: number }>("SELECT id, capability_id, status, error, updated_at FROM jobs WHERE project_id=? AND status IN ('failed','recovery_required','interrupted') ORDER BY updated_at DESC LIMIT 20", [ctx.projectId]).catch(() => []);
        return { output: JSON.stringify({ tools: rows.map((r) => ({ ...r, output: r.output.slice(0, 300), at: new Date(r.created_at).toISOString() })), failedJobs: jobs }).slice(0, 25_000), trusted: false };
      } }),
    tool({ id: "secrets.list", name: "Credenciales guardadas", family: "infraestructura", description: "Lista qué proveedores y servidores tienen credenciales en el almacén cifrado (Keystore). Nunca devuelve los valores.", input: z.object({}).strict(),
      run: async (ctx) => {
        const prov = await ctx.core.repo.listProviders();
        const cons = await ctx.core.repo.sql.all<{ name: string; kind: string }>("SELECT name, kind FROM connections WHERE project_id=?", [ctx.projectId]).catch(() => []);
        return { output: JSON.stringify({ providers: prov.map((p) => ({ name: p.name, kind: p.kind, enabled: !!p.enabled })), connections: cons, note: "Los valores están cifrados con AES-GCM y su llave vive en el Keystore; ningún modelo puede leerlos." }), trusted: true };
      } }),
    tool({ id: "jobs.list", name: "Trabajos remotos", family: "infraestructura", description: "Estado de los trabajos largos (videos, música, 3D) del proyecto.", input: z.object({ limit: z.number().int().min(1).max(50).default(15) }).strict(),
      run: async (ctx, i) => { const rows = await ctx.core.repo.sql.all("SELECT id, capability_id, status, phase, progress, error, updated_at FROM jobs WHERE project_id=? ORDER BY updated_at DESC LIMIT ?", [ctx.projectId, i.limit]); return { output: JSON.stringify(rows).slice(0, 15_000), trusted: true }; } }),
    tool({ id: "agents.status", name: "Estado de trabajos de agentes", description: "Lista las ejecuciones autónomas del proyecto o el detalle (tareas y avance) de una.",
      input: z.object({ runId: z.string().uuid().optional() }).strict(),
      run: async (ctx, i) => {
        const { autoRuns } = await import("./orchestrator");
        if (!i.runId) return { output: JSON.stringify((await autoRuns.list(ctx.core, ctx.projectId)).filter((r) => r.kind !== "chat").slice(0, 20).map((r) => ({ id: r.id, goal: r.goal.slice(0, 160), status: r.status, phase: r.phase, spentUsd: r.spent_usd }))), trusted: true };
        const run = await autoRuns.get(ctx.core, ctx.projectId, i.runId); if (!run) throw new R("Ejecución inexistente en este proyecto.");
        const tasks = await autoRuns.tasks(ctx.core, ctx.projectId, i.runId);
        return { output: JSON.stringify({ status: run.status, phase: run.phase, error: run.error, tasks: tasks.map((t) => ({ title: t.title, role: t.role, status: t.status })) }), trusted: true };
      } }),
    tool({ id: "agents.control", name: "Pausar, reanudar o detener agentes", description: "Pausa, reanuda o detiene una ejecución autónoma del proyecto.",
      input: z.object({ runId: z.string().uuid(), action: z.enum(["pause", "resume", "stop"]) }).strict(), sideEffect: true, roles: ["chat"], risk: "medium",
      approval: "never", target: (i) => `${i.action} ${i.runId}`,
      run: async (ctx, i) => {
        const { autoRuns } = await import("./orchestrator");
        if (!await autoRuns.get(ctx.core, ctx.projectId, i.runId)) throw new R("Ejecución inexistente en este proyecto.");
        if (i.action === "pause") await autoRuns.pause(ctx.core, ctx.projectId, i.runId);
        else if (i.action === "stop") await autoRuns.cancel(ctx.core, ctx.projectId, i.runId);
        else { await autoRuns.resume(ctx.core, ctx.projectId, i.runId); const { driveRun } = await import("./drive"); driveRun(ctx.core, ctx.projectId, i.runId); }
        return { output: `Ejecución ${i.runId}: ${i.action}`, trusted: true };
      } }),

    // ===== PC o VM emparejada desde el chat =====
    tool({ id: "pc.exec", name: "Comando en la PC/VM emparejada", family: "ingenieria", description: "Ejecuta un programa (argv, sin shell) en la carpeta autorizada de la PC o VM emparejada con PC Node: bash/powershell (argv:[\"bash\",\"-lc\",\"...\"]), python, node/npm, compilar, pruebas, lint, git local, docker, playwright, etc. Pide aprobación por comando.",
      input: z.object({ argv: z.array(z.string().max(4000)).min(1).max(64), cwd: z.string().max(400).default(""), network: z.boolean().default(false) }).strict(),
      permissions: ["pc.exec"], sideEffect: true, risk: "high", approval: "always", env: ["pc", "vm"], roles: ["chat"], timeoutMs: 620_000, parallel: false,
      target: (i) => `${i.cwd || "."}: ${i.argv.join(" ")}${i.network ? " (con red)" : ""}`,
      availability: async (ctx) => (await pcTarget(ctx)) ? { ok: true } : { ok: false, reason: "No hay PC/VM con PC Node en línea y carpeta autorizada para este proyecto (Sistema autónomo → PC Node). Para VM sin PC Node usa ssh.exec." },
      run: async (ctx, i) => {
        const t = await pcTarget(ctx); if (!t) throw new R("PC Node desconectado.");
        const shell = H.getTool("shell.exec"); if (!shell?.run) throw new R("Ejecución en PC no disponible.");
        const pctx = { ...ctx, nodeId: t.nodeId, folderId: t.folderId };
        const parsed = shell.input.safeParse(i); if (!parsed.success) throw new R(parsed.error.issues[0]?.message ?? "Entrada inválida");
        return shell.run(pctx, parsed.data) as Promise<ToolOut>;
      } }),
  ];
}

async function pcTarget(ctx: ToolCtx) {
  const { folders } = await import("../nodes/storage");
  const { nodes } = await import("../nodes/client");
  for (const f of await folders.list(ctx.core.repo, ctx.projectId)) {
    const n = await nodes.get(ctx.core.repo, f.node_id);
    if (n && !n.revoked && n.status === "online") return { nodeId: f.node_id, folderId: f.id };
  }
  return null;
}
export { b64 };
