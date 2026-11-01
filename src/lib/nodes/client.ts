// PC Node registry + encrypted RPC client. Pairing requires the one-time code AND the fingerprint shown on the PC.
import type { Repo } from "../db/repo";
import { generateKeys, pairProof, nodeProof, safeEqual, sessionKey, seal, open, fingerprint } from "./protocol";

export type PcNode = { id: string; name: string; host: string; port: number; node_pub: string; fingerprint: string; device_id: string; device_pub: string; device_key_enc: string; ctr: number; status: "online" | "offline" | "revoked"; info: string; last_seen: number | null; revoked: number; created_at: number };
export type NodeInfo = { name: string; version: string; os: string; platform: string; arch: string; cpus: number; memTotal: number; memFree: number; gpu: string | null; disks: { index: number; name: string; freeBytes: number | null; totalBytes: number | null }[]; isolation: string; toolchains: Record<string, string> };
export class NodeOffline extends Error {}

/** Transport: native HTTP on Android (WebView blocks LAN http from https origin), fetch elsewhere. */
export type Transport = (url: string, init: { method: "GET" | "POST"; body?: string; timeoutMs: number }) => Promise<{ status: number; json: unknown }>;
export const fetchTransport: Transport = async (url, init) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), init.timeoutMs);
  try {
    const r = await fetch(url, { method: init.method, headers: init.body ? { "content-type": "application/json" } : {}, ...(init.body ? { body: init.body } : {}), signal: ctl.signal });
    return { status: r.status, json: await r.json().catch(() => null) };
  } catch (e) { throw new NodeOffline(e instanceof Error && e.name === "AbortError" ? "El nodo no respondió a tiempo." : "No se pudo conectar con el nodo."); }
  finally { clearTimeout(t); }
};
let transport: Transport = fetchTransport;
export function setTransport(t: Transport) { transport = t; }
export async function nativeTransportIfAvailable() {
  const { Capacitor, CapacitorHttp } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return;
  setTransport(async (url, init) => {
    try { const r = await CapacitorHttp.request({ url, method: init.method, headers: { "content-type": "application/json" }, ...(init.body ? { data: JSON.parse(init.body) } : {}), connectTimeout: init.timeoutMs, readTimeout: init.timeoutMs }); return { status: r.status, json: r.data }; }
    catch { throw new NodeOffline("No se pudo conectar con el nodo."); }
  });
}
const validHost = (h: string) => /^[A-Za-z0-9.-]{1,253}$/.test(h) || /^\[[0-9a-fA-F:]+\]$/.test(h);
const base = (host: string, port: number) => { if (!validHost(host) || !(port > 0 && port < 65536)) throw new Error("Dirección de nodo inválida"); return `http://${host}:${port}`; };

export async function hello(host: string, port: number) {
  const r = await transport(`${base(host, port)}/hello`, { method: "GET", timeoutMs: 4000 });
  const j = r.json as { miai?: string; name: string; nodePub: string; fingerprint: string; pairingOpen: boolean } | null;
  if (r.status !== 200 || j?.miai !== "pc-node") throw new Error("La dirección no corresponde a un MI AI PC Node.");
  if (await fingerprint(j.nodePub) !== j.fingerprint) throw new Error("La huella del nodo no coincide con su clave.");
  return j;
}

/** Mutual authentication: the node proves it knows the code too; the expected fingerprint pins its key. */
export async function pairNode(repo: Repo, o: { host: string; port: number; code: string; expectedFingerprint: string; deviceName?: string }) {
  if (!/^\d{6}$/.test(o.code)) throw new Error("El código tiene 6 dígitos.");
  const h = await hello(o.host, o.port);
  if (h.fingerprint !== o.expectedFingerprint.trim().toLowerCase()) throw new Error("La huella no coincide con la que muestra la PC. Emparejamiento cancelado.");
  const keys = await generateKeys();
  const proof = await pairProof(o.code, keys.publicRaw, h.nodePub);
  const r = await transport(`${base(o.host, o.port)}/pair`, { method: "POST", body: JSON.stringify({ devicePub: keys.publicRaw, deviceName: o.deviceName ?? "MI AI Android", proof }), timeoutMs: 8000 });
  const j = r.json as { deviceId?: string; nodeProof?: string; nodePub?: string; error?: string } | null;
  if (r.status !== 200 || !j?.deviceId || !j.nodeProof) throw new Error(j?.error ?? "Emparejamiento rechazado.");
  if (j.nodePub !== h.nodePub || !safeEqual(j.nodeProof, await nodeProof(o.code, keys.publicRaw, h.nodePub))) throw new Error("El nodo no pudo demostrar su identidad. Emparejamiento cancelado.");
  const id = crypto.randomUUID();
  await repo.sql.run("INSERT INTO pc_nodes (id,name,host,port,node_pub,fingerprint,device_id,device_pub,device_key_enc,ctr,status,info,last_seen,revoked,created_at) VALUES (?,?,?,?,?,?,?,?,?,0,'online','{}',?,0,?)",
    [id, h.name.slice(0, 80), o.host, o.port, h.nodePub, h.fingerprint, j.deviceId, keys.publicRaw, await repo.sealSecret(JSON.stringify(keys.privateJwk)), Date.now(), Date.now()]);
  return id;
}

export const nodes = {
  list: (repo: Repo) => repo.sql.all<PcNode>("SELECT * FROM pc_nodes ORDER BY created_at DESC"),
  async get(repo: Repo, id: string) { return (await repo.sql.all<PcNode>("SELECT * FROM pc_nodes WHERE id=?", [id]))[0] ?? null; },
  async setStatus(repo: Repo, id: string, status: PcNode["status"]) { await repo.sql.run("UPDATE pc_nodes SET status=?, last_seen=CASE WHEN ?='online' THEN ? ELSE last_seen END WHERE id=? AND revoked=0", [status, status, Date.now(), id]); },
  /** Revocation: tell the node (best effort), then forget the key locally and stop project use immediately. */
  async revoke(repo: Repo, id: string) {
    try { await rpc(repo, id, "device.revokeSelf", {}); } catch { /* offline: local revocation still applies */ }
    await repo.sql.run("UPDATE pc_nodes SET revoked=1, status='revoked', device_key_enc='' WHERE id=?", [id]);
    const vpnOpen = await repo.sql.all<{ id: string }>("SELECT id FROM tunnels WHERE node_id=? AND kind='vpn' AND status='open'", [id]);
    await repo.sql.run("UPDATE tunnels SET status='revocado', closed_at=? WHERE node_id=? AND status='open'", [Date.now(), id]);
    if (vpnOpen.length) await import("./tunnels").then((m) => m.stopNativeVpn()).catch(() => undefined);
  },
};

const keyCache = new Map<string, CryptoKey>();
const queue = new Map<string, Promise<unknown>>();
/** Encrypted call. Counter is persisted BEFORE sending so a crash can never reuse it. Calls per node are serialized. */
export async function rpc<T = unknown>(repo: Repo, nodeId: string, method: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
  const prev = queue.get(nodeId) ?? Promise.resolve();
  const p = prev.catch(() => undefined).then(async () => {
    const n = await nodes.get(repo, nodeId);
    if (!n || n.revoked) throw new Error("Nodo revocado o inexistente.");
    let key = keyCache.get(nodeId);
    if (!key) { key = await sessionKey(JSON.parse(await repo.openSecret(n.device_key_enc)), n.node_pub, n.device_pub, n.node_pub); keyCache.set(nodeId, key); }
    const ctr = n.ctr + 1;
    await repo.sql.run("UPDATE pc_nodes SET ctr=? WHERE id=?", [ctr, nodeId]);
    const box = await seal(key, `req|${n.device_id}|${ctr}`, { method, params });
    let r;
    try { r = await transport(`${base(n.host, n.port)}/rpc`, { method: "POST", body: JSON.stringify({ deviceId: n.device_id, ctr, ...box }), timeoutMs }); }
    catch (e) { await nodes.setStatus(repo, nodeId, "offline"); throw e; }
    if (r.status !== 200) throw new Error((r.json as { error?: string } | null)?.error ?? `Nodo respondió ${r.status}`);
    const out = await open<{ ok: boolean; result?: T; error?: string }>(key, `res|${n.device_id}|${ctr}`, r.json as { iv: string; ct: string });
    await nodes.setStatus(repo, nodeId, "online");
    if (!out.ok) throw new Error(out.error ?? "Error del nodo");
    return out.result as T;
  });
  queue.set(nodeId, p);
  return p;
}
export function forgetKeys() { keyCache.clear(); }

/** Heartbeat: marks nodes offline without claiming remote jobs still run. */
export async function heartbeat(repo: Repo) {
  for (const n of await nodes.list(repo)) {
    if (n.revoked) continue;
    try { const info = await rpc<NodeInfo>(repo, n.id, "info", {}, 5000); await repo.sql.run("UPDATE pc_nodes SET info=? WHERE id=?", [JSON.stringify(info), n.id]); }
    catch { await nodes.setStatus(repo, n.id, "offline"); }
  }
}
