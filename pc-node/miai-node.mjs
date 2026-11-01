#!/usr/bin/env node
// MI AI PC Node: authorized execution + private storage extension for the MI AI Android app.
// Standalone (Node 20+, no dependencies). Runs on Windows, Linux and macOS. LAN only; no Internet needed.
// Usage: node miai-node.mjs --share <folder> [--share <folder>] [--port 47820] [--allow-target 127.0.0.1:5173] [--vpn-subnet 192.168.1.0/24] [--state <dir>] [--isolation auto|docker|process]
import http from "node:http";
import { mediaMethods } from "./media.mjs";
import net from "node:net";
import dgram from "node:dgram";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { startSocks, startVpn, parseCidr, ipToInt, inCidrs } from "./relay.mjs";
import { randomBytes } from "node:crypto";
import { generateKeys, fingerprint, pairProof, nodeProof, safeEqual, sessionKey, seal, open } from "./protocol.mjs";

export const VERSION = "1.0.0";
const TOOLCHAINS = [
  ["ffmpeg", ["-version"]], ["demucs", ["--help"]], ["node", ["--version"]], ["npm", ["--version"]], ["python3", ["--version"]], ["python", ["--version"]], ["pip", ["--version"]],
  ["java", ["-version"]], ["kotlinc", ["-version"]], ["gradle", ["--version"]], ["sdkmanager", ["--version"]], ["gcc", ["--version"]], ["clang", ["--version"]],
  ["cmake", ["--version"]], ["ninja", ["--version"]], ["rustc", ["--version"]], ["cargo", ["--version"]], ["go", ["version"]], ["dotnet", ["--version"]],
  ["git", ["--version"]], ["sqlite3", ["--version"]], ["psql", ["--version"]], ["forge", ["--version"]], ["npx", ["--version"]], ["docker", ["--version"]], ["podman", ["--version"]],
];

function parseArgs(argv) {
  const o = { share: [], port: 47820, allowTargets: [], vpnSubnets: [], state: path.join(os.homedir(), ".miai-node"), isolation: "auto", name: os.hostname(), discovery: true, host: "0.0.0.0" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], v = argv[i + 1];
    if (a === "--demucs-models") { o.demucsModels = path.resolve(v); i++; } else if (a === "--share") { o.share.push(path.resolve(v)); i++; } else if (a === "--port") { o.port = Number(v); i++; }
    else if (a === "--allow-target") { o.allowTargets.push(v); i++; } else if (a === "--vpn-subnet") { o.vpnSubnets.push(v); i++; } else if (a === "--state") { o.state = path.resolve(v); i++; }
    else if (a === "--isolation") { o.isolation = v; i++; } else if (a === "--name") { o.name = v; i++; }
    else if (a === "--host") { o.host = v; i++; } else if (a === "--no-discovery") o.discovery = false;
  }
  return o;
}

export function detectToolchains() {
  const found = {};
  for (const [bin, args] of TOOLCHAINS) {
    try {
      const r = spawnSync(bin, args, { timeout: 5000, encoding: "utf8", shell: false, windowsHide: true });
      if (r.status === 0 || (r.stdout || r.stderr)) { if (r.error) continue; found[bin] = String(r.stdout || r.stderr).split("\n")[0].trim().slice(0, 120); }
    } catch { /* not installed */ }
  }
  return found;
}

export async function startNode(opts) {
  const cfg = { ...parseArgs([]), ...opts };
  await fsp.mkdir(cfg.state, { recursive: true, mode: 0o700 });
  const statePath = path.join(cfg.state, "state.json");
  let state = { keys: null, devices: {}, jobs: {}, tunnels: [] };
  try { state = { ...state, ...JSON.parse(await fsp.readFile(statePath, "utf8")) }; } catch { /* first run */ }
  if (!state.keys) state.keys = await generateKeys();
  // A powered-off node never claims a job is still running.
  for (const j of Object.values(state.jobs)) if (j.status === "running") { j.status = "lost"; j.endedAt = Date.now(); }
  for (const t of state.tunnels) if (t.status === "open") { t.status = "nodo reiniciado"; t.closedAt = Date.now(); }
  // Serialized atomic writes: concurrent requests never interleave temp files.
  let saving = Promise.resolve();
  const save = () => (saving = saving.catch(() => {}).then(async () => { const tmp = `${statePath}.${randomUUID()}.tmp`; await fsp.writeFile(tmp, JSON.stringify(state), { mode: 0o600 }); await fsp.rename(tmp, statePath); }));
  await save();
  const fp = await fingerprint(state.keys.publicRaw);
  const toolchains = detectToolchains();
  const isolation = cfg.isolation === "auto" ? (toolchains.docker ? "docker" : "process") : cfg.isolation;
  let pairing = null; // { code, expires, attempts }
  const newCode = () => { pairing = { code: String(randomInt(0, 1_000_000)).padStart(6, "0"), expires: Date.now() + 10 * 60_000, attempts: 0 }; return pairing.code; };
  const keyCache = new Map();
  const procs = new Map();
  const servers = new Map();
  const audit = (entry) => fsp.appendFile(path.join(cfg.state, "audit.log"), JSON.stringify({ at: Date.now(), ...entry }) + "\n").catch(() => {});

  const keyFor = async (deviceId) => {
    const d = state.devices[deviceId]; if (!d || d.revoked) throw new Error("Dispositivo no autorizado");
    if (!keyCache.has(deviceId)) keyCache.set(deviceId, await sessionKey(state.keys.privateJwk, d.pub, d.pub, state.keys.publicRaw));
    return keyCache.get(deviceId);
  };
  // ---------- Private storage: only explicitly shared roots, one subfolder per project ----------
  const rootOf = (i) => { const r = cfg.share[i]; if (r === undefined) throw new Error("Carpeta no compartida"); return r; };
  const projDir = (rootIndex, projectId) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(projectId)) throw new Error("Proyecto inválido");
    return path.join(rootOf(rootIndex), "miai", projectId);
  };
  const resolveIn = async (rootIndex, projectId, rel = "") => {
    const base = projDir(rootIndex, projectId); await fsp.mkdir(base, { recursive: true });
    const realBase = await fsp.realpath(base);
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes("..")) throw new Error("Ruta fuera del espacio del proyecto");
    const target = path.resolve(realBase, rel);
    if (target !== realBase && !target.startsWith(realBase + path.sep)) throw new Error("Ruta fuera del espacio del proyecto");
    // Reject symlinks anywhere on the existing path (no escape through links).
    let cur = realBase;
    for (const part of path.relative(realBase, target).split(path.sep).filter(Boolean)) {
      cur = path.join(cur, part);
      const st = await fsp.lstat(cur).catch(() => null);
      if (!st) break; if (st.isSymbolicLink()) throw new Error("Enlaces simbólicos no permitidos");
    }
    return { base: realBase, target };
  };
  const sha = async (file) => createHash("sha256").update(await fsp.readFile(file)).digest("hex");
  const dirSize = async (d) => { let n = 0; for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) { const p = path.join(d, e.name); n += e.isDirectory() ? await dirSize(p) : (await fsp.stat(p)).size; } return n; };
  const versionDir = (rootIndex, projectId, rel) => path.join(rootOf(rootIndex), "miai", ".versions", projectId, rel);
  const keepVersion = async (rootIndex, projectId, rel, target) => {
    const st = await fsp.stat(target).catch(() => null); if (!st?.isFile()) return null;
    const h = await sha(target), d = versionDir(rootIndex, projectId, rel); await fsp.mkdir(d, { recursive: true });
    const name = `${Date.now()}-${h.slice(0, 12)}`; await fsp.copyFile(target, path.join(d, name)); return name;
  };
  const walk = async (d, base, out, limit = 5000) => {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (out.length >= limit) return; if (e.name === "node_modules" || e.name === ".git") continue;
      const p = path.join(d, e.name), rel = path.relative(base, p).split(path.sep).join("/");
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { out.push({ path: rel, dir: true }); await walk(p, base, out, limit); }
      else { const st = await fsp.stat(p); out.push({ path: rel, dir: false, size: st.size, mtime: st.mtimeMs }); }
    }
    return out;
  };

  // ---------- Process execution: argv only (no shell), detected toolchains, project cwd, limits ----------
  const ALLOWED_BINS = new Set(Object.keys(toolchains).filter((b) => !["docker", "podman"].includes(b)));
  const startJob = async (deviceId, p) => {
    const { argv, rootIndex = 0, projectId, cwd = "", timeoutMs = 120_000, maxOutput = 200_000, network = false, memoryMb = 1024, opKey } = p;
    if (!Array.isArray(argv) || !argv.length || argv.some((a) => typeof a !== "string")) throw new Error("argv inválido");
    if (!ALLOWED_BINS.has(argv[0])) throw new Error(`Herramienta no instalada o no permitida en este nodo: ${argv[0]}`);
    if (argv[0] === "git") {
      // -c/--config-env/-C/--exec-path could inject aliases or helpers that run arbitrary commands.
      if (argv.slice(1).some((a) => /^(-c|--config-env|-C|--exec-path|--upload-pack|--receive-pack|-u)(=|$)/.test(a) || a.startsWith("--config-env="))) throw new Error("Opción de Git no permitida");
      if (argv.slice(1).some((a) => ["push", "remote", "fetch", "pull", "clone", "submodule"].includes(a)) && !p.remoteApproved) throw new Error("Operación remota de Git sin aprobación");
    }
    if (opKey) { const prev = Object.values(state.jobs).find((j) => j.opKey === opKey && j.deviceId === deviceId); if (prev) return { jobId: prev.id, duplicate: true }; }
    const { base, target } = await resolveIn(rootIndex, projectId, cwd);
    await fsp.mkdir(target, { recursive: true });
    const id = randomUUID();
    const env = { PATH: process.env.PATH, HOME: base, USERPROFILE: base, TMPDIR: path.join(base, ".tmp"), LANG: "C.UTF-8", SystemRoot: process.env.SystemRoot, CI: "1" };
    await fsp.mkdir(env.TMPDIR, { recursive: true });
    let cmd = argv[0], args = argv.slice(1), level = "process";
    if (isolation === "docker") {
      // Real OS isolation: container, no network unless approved, memory/CPU caps, only the project folder mounted.
      level = "docker"; cmd = "docker";
      args = ["run", "--rm", "-i", `--memory=${memoryMb}m`, "--cpus=2", "--pids-limit=256", ...(network ? [] : ["--network=none"]), "-v", `${base}:/work`, "-w", `/work/${path.relative(base, target).split(path.sep).join("/")}`, p.image || "node:20-bookworm", ...argv];
    } else if (process.platform === "linux" && spawnSync("prlimit", ["--version"]).status === 0) {
      // Address-space caps break V8/JVM runtimes, so process mode caps CPU time and file size only; memory is NOT OS-capped here.
      level = "process+rlimit(cpu,fsize)"; cmd = "prlimit"; args = [`--cpu=${Math.ceil(timeoutMs / 1000)}`, `--fsize=${2 * 1024 ** 3}`, "--", ...argv];
    }
    const job = { id, deviceId, projectId, argv, cwd, status: "running", exitCode: null, startedAt: Date.now(), endedAt: null, output: "", truncated: false, isolation: level, network: isolation === "docker" ? network : "no-restringida-por-SO", opKey: opKey ?? null };
    state.jobs[id] = job; await save(); audit({ kind: "job.start", deviceId, projectId, argv, level });
    const child = spawn(cmd, args, { cwd: target, env, shell: false, windowsHide: true, detached: process.platform !== "win32" });
    procs.set(id, child);
    const add = (b) => { if (job.output.length < maxOutput) job.output += b.toString("utf8"); else job.truncated = true; if (job.output.length > maxOutput) job.output = job.output.slice(0, maxOutput); };
    child.stdout.on("data", add); child.stderr.on("data", add);
    const timer = setTimeout(() => kill(id, "timeout"), timeoutMs);
    child.on("error", (e) => { add(Buffer.from(String(e.message))); });
    child.on("close", async (code) => {
      clearTimeout(timer); procs.delete(id);
      if (job.status === "running") job.status = code === 0 ? "succeeded" : "failed";
      job.exitCode = code; job.endedAt = Date.now(); await save(); audit({ kind: "job.end", id, status: job.status, code });
    });
    return { jobId: id, isolation: level };
  };
  const kill = (id, why) => {
    const j = state.jobs[id], c = procs.get(id); if (!j || !c) return false;
    j.status = why === "timeout" ? "timeout" : "cancelled";
    try { if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"]); else process.kill(-c.pid, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch { /* gone */ } }
    return true;
  };

  // ---------- Tunnels: LAN listener, only the paired phone's IP, only allowlisted targets, TTL ----------
  const openTunnel = async (deviceId, peerIp, p) => {
    const target = `${p.targetHost}:${p.targetPort}`;
    if (!cfg.allowTargets.includes(target)) throw new Error("Destino no autorizado en este nodo");
    const ttl = Math.min(Math.max(Number(p.ttlMs) || 600_000, 10_000), 2 * 3600_000);
    const id = randomUUID(), log = [];
    const srv = net.createServer((sock) => {
      const from = (sock.remoteAddress || "").replace(/^::ffff:/, "");
      if (from !== peerIp) { log.push({ at: Date.now(), event: "rechazada", from }); audit({ kind: "tunnel.reject", id, from }); sock.destroy(); return; }
      const up = net.connect(Number(p.targetPort), p.targetHost); sock.pipe(up).pipe(sock);
      up.on("error", () => sock.destroy()); sock.on("error", () => up.destroy());
      log.push({ at: Date.now(), event: "conexión", from });
    });
    await new Promise((res, rej) => { srv.once("error", rej); srv.listen(0, cfg.host, res); });
    const t = { id, deviceId, target, port: srv.address().port, expiresAt: Date.now() + ttl, openedAt: Date.now(), allowedIp: peerIp, status: "open" };
    servers.set(id, { close: () => srv.close(), log, timer: setTimeout(() => closeTunnel(id, "expirado"), ttl) });
    state.tunnels.push(t); await save(); audit({ kind: "tunnel.open", ...t });
    return t;
  };
  const closeTunnel = async (id, why = "cerrado", deviceId) => {
    const s = servers.get(id); const t = state.tunnels.find((x) => x.id === id); if (!t || (deviceId && t.deviceId !== deviceId)) return false;
    if (s) { clearTimeout(s.timer); await s.close(); servers.delete(id); }
    t.status = why; t.closedAt = Date.now(); await save(); audit({ kind: "tunnel.close", id, why }); return true;
  };

  // ---------- SOCKS5 and split VPN: same rules (phone IP, allowlist, TTL, audit) ----------
  const cidrs = cfg.vpnSubnets.map(parseCidr).filter(Boolean);
  const allowDest = (h, port) => cfg.allowTargets.includes(`${h}:${port}`) || (ipToInt(h) !== null && inCidrs(h, cidrs));
  const ttlOf = (ms) => Math.min(Math.max(Number(ms) || 600_000, 10_000), 2 * 3600_000);
  const register = async (deviceId, peerIp, kind, target, handle, extra) => {
    const id = randomUUID(), ttl = ttlOf(extra.ttlMs), log = handle.log;
    const t = { id, deviceId, kind, target, port: handle.port, expiresAt: Date.now() + ttl, openedAt: Date.now(), allowedIp: peerIp, status: "open" };
    servers.set(id, { close: handle.close, log, timer: setTimeout(() => closeTunnel(id, "expirado"), ttl) });
    state.tunnels.push(t); await save(); audit({ kind: `${kind}.open`, ...t }); return t;
  };
  const openSocks = async (deviceId, peerIp, p) => {
    if (!cfg.allowTargets.length && !cidrs.length) throw new Error("Este nodo no tiene destinos permitidos (--allow-target o --vpn-subnet)");
    const log = [], user = randomBytes(9).toString("base64url"), pass = randomBytes(18).toString("base64url");
    const h = await startSocks({ host: cfg.host, peerIp, user, pass, allow: allowDest, onLog: (e) => { log.push({ at: Date.now(), ...e }); if (log.length > 200) log.shift(); audit({ kind: "socks.event", ...e }); } });
    const t = await register(deviceId, peerIp, "socks5", "lista permitida", { ...h, log }, p);
    return { ...t, user, pass, allowed: [...cfg.allowTargets, ...cidrs.map((c) => c.text)] };
  };
  const openVpn = async (deviceId, peerIp, p) => {
    if (!cidrs.length) throw new Error("Este nodo no comparte subredes para VPN (--vpn-subnet)");
    const wanted = (Array.isArray(p.subnets) ? p.subnets : []).map(parseCidr);
    if (!wanted.length || wanted.some((w) => !w || !cidrs.some((c) => c.text === w.text))) throw new Error("Subred no compartida por este nodo");
    const log = [], key = randomBytes(32);
    const h = await startVpn({ host: cfg.host, peerIp, key, cidrs: wanted, onLog: (e) => { log.push({ at: Date.now(), ...e }); if (log.length > 200) log.shift(); audit({ kind: "vpn.event", ...e }); } });
    const t = await register(deviceId, peerIp, "vpn", wanted.map((w) => w.text).join(","), { ...h, log }, p);
    return { ...t, key: key.toString("base64"), subnets: wanted.map((w) => w.text) };
  };

  const methods = {
    ping: async () => ({ ok: true, at: Date.now() }),
    info: async () => {
      const disks = [];
      for (const [i, r] of cfg.share.entries()) { const s = await fsp.statfs(r).catch(() => null); disks.push({ index: i, name: path.basename(r), freeBytes: s ? s.bavail * s.bsize : null, totalBytes: s ? s.blocks * s.bsize : null }); }
      return { name: cfg.name, version: VERSION, os: `${os.type()} ${os.release()}`, platform: process.platform, arch: os.arch(), cpus: os.cpus().length, cpuModel: os.cpus()[0]?.model ?? "", memTotal: os.totalmem(), memFree: os.freemem(), load: os.loadavg(), gpu: null, gpuNote: "Detección de GPU no implementada; se informa como desconocida.", disks, isolation, toolchains };
    },
    "folders.list": async () => cfg.share.map((r, i) => ({ index: i, name: path.basename(r) })),
    "fs.list": async (_d, p) => { const { target, base } = await resolveIn(p.rootIndex ?? 0, p.projectId, p.path ?? ""); return walk(target, base, []); },
    "fs.stat": async (_d, p) => { const { target } = await resolveIn(p.rootIndex ?? 0, p.projectId, p.path); const st = await fsp.stat(target).catch(() => null); return st ? { exists: true, size: st.size, hash: st.isFile() ? await sha(target) : null } : { exists: false }; },
    "fs.read": async (_d, p) => { const { target } = await resolveIn(p.rootIndex ?? 0, p.projectId, p.path); const buf = await fsp.readFile(target); if (buf.length > 8_000_000) throw new Error("Archivo demasiado grande para una lectura"); return { data: buf.toString("base64"), hash: createHash("sha256").update(buf).digest("hex") }; },
    "fs.write": async (_d, p) => {
      const ri = p.rootIndex ?? 0, { target, base } = await resolveIn(ri, p.projectId, p.path);
      const data = Buffer.from(p.data, "base64");
      const cur = await fsp.stat(target).catch(() => null), curHash = cur?.isFile() ? await sha(target) : null;
      // Never silently overwrite: the writer must name the version it edited.
      if ((p.baseHash ?? null) !== curHash) return { conflict: true, currentHash: curHash };
      if (p.quotaBytes && (await dirSize(base)) - (cur?.size ?? 0) + data.length > p.quotaBytes) throw new Error("Cuota del proyecto superada");
      const kept = await keepVersion(ri, p.projectId, p.path, target);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.miai-tmp-${randomUUID()}`; await fsp.writeFile(tmp, data); await fsp.rename(tmp, target);
      return { conflict: false, hash: createHash("sha256").update(data).digest("hex"), previousVersion: kept };
    },
    "fs.delete": async (_d, p) => { const ri = p.rootIndex ?? 0, { target } = await resolveIn(ri, p.projectId, p.path); const kept = await keepVersion(ri, p.projectId, p.path, target); await fsp.rm(target, { force: true }); return { previousVersion: kept }; },
    "fs.versions": async (_d, p) => { await resolveIn(p.rootIndex ?? 0, p.projectId, p.path); return (await fsp.readdir(versionDir(p.rootIndex ?? 0, p.projectId, p.path)).catch(() => [])).sort(); },
    "fs.restore": async (_d, p) => {
      const ri = p.rootIndex ?? 0, { target } = await resolveIn(ri, p.projectId, p.path);
      if (!/^\d+-[0-9a-f]{12}$/.test(p.version)) throw new Error("Versión inválida");
      const src = path.join(versionDir(ri, p.projectId, p.path), p.version);
      await keepVersion(ri, p.projectId, p.path, target); await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.copyFile(src, target);
      return { hash: await sha(target) };
    },
    "fs.search": async (_d, p) => {
      const { target, base } = await resolveIn(p.rootIndex ?? 0, p.projectId, ""); const files = await walk(target, base, []); const out = [];
      const q = String(p.query ?? ""); if (!q || q.length > 200) throw new Error("Consulta inválida");
      for (const f of files) { if (f.dir || f.size > 1_000_000) continue; const lines = (await fsp.readFile(path.join(base, f.path), "utf8")).split("\n"); lines.forEach((l, i) => { if (l.includes(q) && out.length < 500) out.push({ path: f.path, line: i + 1, text: l.slice(0, 300) }); }); }
      return out;
    },
    "job.start": async (d, p) => startJob(d, p),
    "job.status": async (d, p) => { const j = state.jobs[p.jobId]; if (!j || j.deviceId !== d) throw new Error("Trabajo inexistente"); return { ...j, output: j.output.slice(-(p.tail ?? 20_000)) }; },
    "job.list": async (d, p) => Object.values(state.jobs).filter((j) => j.deviceId === d && (!p.projectId || j.projectId === p.projectId)).map(({ output, ...j }) => j),
    "job.cancel": async (d, p) => { const j = state.jobs[p.jobId]; if (!j || j.deviceId !== d) throw new Error("Trabajo inexistente"); const ok = kill(p.jobId, "cancel"); await save(); return { cancelled: ok }; },
    "tunnel.open": async (d, p, ip) => openTunnel(d, ip, p),
    "socks.open": async (d, p, ip) => openSocks(d, ip, p),
    "vpn.open": async (d, p, ip) => openVpn(d, ip, p),
    "vpn.subnets": async () => cidrs.map((c) => c.text),
    "tunnel.close": async (d, p) => ({ closed: await closeTunnel(p.tunnelId, "cerrado", d) }),
    "tunnel.list": async (d) => state.tunnels.filter((t) => t.deviceId === d).map((t) => ({ ...t, log: servers.get(t.id)?.log ?? [] })),
    "device.revokeSelf": async (d) => { state.devices[d].revoked = true; keyCache.delete(d); for (const t of state.tunnels) if (t.deviceId === d && t.status === "open") await closeTunnel(t.id, "revocado"); await save(); return { revoked: true }; },
  };

  Object.assign(methods, mediaMethods({ resolveIn, startJob, state, save, toolchains, cfg: { ...cfg, isolation }, kill }));

  const readBody = (req) => new Promise((res, rej) => { let s = ""; req.on("data", (c) => { s += c; if (s.length > 12_000_000) { rej(new Error("Solicitud demasiado grande")); req.destroy(); } }); req.on("end", () => res(s)); req.on("error", rej); });
  const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" }); res.end(JSON.stringify(obj)); };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "OPTIONS") return send(res, 204, {});
      if (req.method === "GET" && req.url === "/hello") return send(res, 200, { miai: "pc-node", version: VERSION, name: cfg.name, nodePub: state.keys.publicRaw, fingerprint: fp, pairingOpen: !!pairing && pairing.expires > Date.now() });
      if (req.method !== "POST") return send(res, 404, { error: "no encontrado" });
      const body = JSON.parse(await readBody(req));
      const ip = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
      if (req.url === "/pair") {
        if (!pairing || pairing.expires < Date.now()) return send(res, 403, { error: "Emparejamiento cerrado. Genera un código nuevo en la PC." });
        if (++pairing.attempts > 5) { pairing = null; return send(res, 429, { error: "Demasiados intentos" }); }
        const expected = await pairProof(pairing.code, body.devicePub, state.keys.publicRaw);
        if (typeof body.proof !== "string" || !safeEqual(body.proof, expected)) { audit({ kind: "pair.reject", ip }); return send(res, 401, { error: "Código incorrecto" }); }
        const deviceId = randomUUID();
        state.devices[deviceId] = { pub: body.devicePub, name: String(body.deviceName || "Android").slice(0, 60), pairedAt: Date.now(), lastCtr: 0, revoked: false };
        const proof = await nodeProof(pairing.code, body.devicePub, state.keys.publicRaw);
        pairing = null; await save(); audit({ kind: "pair.ok", deviceId, ip });
        return send(res, 200, { deviceId, nodeProof: proof, nodePub: state.keys.publicRaw });
      }
      if (req.url === "/rpc") {
        const dev = state.devices[body.deviceId];
        if (!dev || dev.revoked) return send(res, 401, { error: "Dispositivo no autorizado" });
        const ctr = Number(body.ctr);
        if (!Number.isSafeInteger(ctr) || ctr <= dev.lastCtr) return send(res, 409, { error: "Contador repetido (posible repetición)" });
        const key = await keyFor(body.deviceId);
        let msg; try { msg = await open(key, `req|${body.deviceId}|${ctr}`, body); } catch { return send(res, 401, { error: "Autenticación fallida" }); }
        dev.lastCtr = ctr; dev.lastSeen = Date.now(); await save();
        const fn = methods[msg.method];
        let out;
        try { if (!fn) throw new Error("Método desconocido"); out = { ok: true, result: await fn(body.deviceId, msg.params ?? {}, ip) }; }
        catch (e) { out = { ok: false, error: String(e?.message ?? e).slice(0, 500) }; }
        return send(res, 200, await seal(key, `res|${body.deviceId}|${ctr}`, out));
      }
      return send(res, 404, { error: "no encontrado" });
    } catch (e) { return send(res, 400, { error: String(e?.message ?? e).slice(0, 300) }); }
  });
  await new Promise((r) => server.listen(cfg.port, cfg.host, r));
  const port = server.address().port;
  let beacon = null;
  if (cfg.discovery) {
    beacon = dgram.createSocket({ type: "udp4", reuseAddr: true });
    beacon.bind(() => { try { beacon.setBroadcast(true); } catch { /* no broadcast */ } });
    const msg = () => Buffer.from(JSON.stringify({ miai: "pc-node", name: cfg.name, port, fingerprint: fp }));
    beacon.timer = setInterval(() => beacon.send(msg(), 47821, "255.255.255.255", () => {}), 5000);
  }
  return {
    port, fingerprint: fp, isolation, toolchains, newPairingCode: newCode,
    devices: () => Object.entries(state.devices).map(([id, d]) => ({ id, name: d.name, revoked: d.revoked, lastSeen: d.lastSeen ?? null })),
    revoke: async (id) => { if (state.devices[id]) { state.devices[id].revoked = true; keyCache.delete(id); for (const t of state.tunnels) if (t.deviceId === id && t.status === "open") await closeTunnel(t.id, "revocado"); await save(); } },
    close: async () => { for (const id of [...servers.keys()]) await closeTunnel(id, "nodo detenido"); for (const id of [...procs.keys()]) kill(id, "cancel"); if (beacon) { clearInterval(beacon.timer); beacon.close(); } await new Promise((r) => server.close(r)); server.closeAllConnections?.(); },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const cfg = parseArgs(process.argv.slice(2));
  if (!cfg.share.length) { console.error("Indica al menos una carpeta compartida con --share <carpeta>. El disco completo nunca se comparte."); process.exit(1); }
  const n = await startNode(cfg);
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
  const code = n.newPairingCode();
  console.log(`MI AI PC Node ${VERSION} — puerto ${n.port} — aislamiento: ${n.isolation}`);
  console.log(`Huella: ${n.fingerprint}   Direcciones: ${lan.join(", ")}`);
  console.log(`Código de emparejamiento (10 min): ${code}`);
  console.log(`Contenido QR: ${JSON.stringify({ miai: "pc-node", hosts: lan, port: n.port, fingerprint: n.fingerprint, code })}`);
  console.log(`Subredes VPN: ${cfg.vpnSubnets.join(", ") || "ninguna"}`);
  console.log(`Toolchains: ${Object.keys(n.toolchains).join(", ") || "ninguno detectado"}`);
  process.stdin.on("data", (d) => { if (String(d).trim() === "codigo") console.log(`Nuevo código: ${n.newPairingCode()}`); });
  for (const s of ["SIGINT", "SIGTERM"]) process.on(s, async () => { await n.close(); process.exit(0); });
}
