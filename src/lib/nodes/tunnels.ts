// Tunnel Manager: authorized, logged, time-limited tunnels. Never opens public ports or acts as an open proxy.
// Kinds: PC Node (dev port, SOCKS5, split VPN) and SSH (local/reverse forwarding, SOCKS5 over SSH).
// SSH rows store the SSH connection id in `node_id`. Session credentials (SOCKS user/pass, VPN key) live only in memory.
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Repo } from "../db/repo";
import { rpc, nodes } from "./client";
import { connections } from "../connections";

export type Tunnel = { id: string; project_id: string; node_id: string; remote_id: string | null; kind: string; target: string; port: number | null; agent: string; status: string; reconnect: number; expires_at: number | null; opened_at: number | null; closed_at: number | null; log: string; created_at: number };
type Kind = "pc.dev" | "pc.socks5" | "ssh.local" | "ssh.reverse" | "ssh.socks5" | "vpn";
type KindInfo = { label: string; via: "pc" | "ssh"; nativeOnly: boolean; note: string };

export const TUNNEL_INFO: Record<Kind, KindInfo> = {
  "pc.dev": { label: "Túnel de desarrollo hacia la PC", via: "pc", nativeOnly: false, note: "Puerto LAN temporal; solo la IP del teléfono emparejado y destinos permitidos en el nodo." },
  "pc.socks5": { label: "SOCKS5 en la PC", via: "pc", nativeOnly: false, note: "Proxy con usuario/clave de un solo uso; solo destinos --allow-target o subredes --vpn-subnet del nodo." },
  "ssh.local": { label: "SSH reenvío local", via: "ssh", nativeOnly: true, note: "Puerto en 127.0.0.1 del teléfono hacia un servicio visto desde el servidor SSH." },
  "ssh.reverse": { label: "SSH reenvío inverso", via: "ssh", nativeOnly: true, note: "Puerto ≥1024 en el localhost del servidor hacia un servicio visto desde el teléfono." },
  "ssh.socks5": { label: "SOCKS5 sobre SSH", via: "ssh", nativeOnly: true, note: "Proxy en 127.0.0.1 del teléfono; solo los destinos host:puerto que autorices." },
  vpn: { label: "VPN dividida hacia la PC", via: "pc", nativeOnly: true, note: "Solo las subredes compartidas por el nodo pasan por la PC; el resto del tráfico no se desvía." },
};
const isNative = () => Capacitor.isNativePlatform();
/** What this device can really do right now. Native kinds are unavailable in the web preview. */
export function tunnelKind(k: Kind) {
  const i = TUNNEL_INFO[k], native = nativeCheck();
  return { ...i, available: !i.nativeOnly || native, note: i.nativeOnly && !native ? `Solo en la app Android. ${i.note}` : i.note };
}

// ---------- Native drivers (injectable for tests) ----------
type SshCfg = { host: string; port: number; user: string; knownHosts: string; password: string };
export type TunnelNative = {
  forwardLocal(o: SshCfg & { targetHost: string; targetPort: number; ttlMs: number }): Promise<{ id: string; port: number; expiresAt: number }>;
  forwardRemote(o: SshCfg & { remotePort: number; targetHost: string; targetPort: number; ttlMs: number }): Promise<{ id: string; port: number; expiresAt: number }>;
  socksDynamic(o: SshCfg & { allow: string[]; ttlMs: number }): Promise<{ id: string; port: number; expiresAt: number; user: string; pass: string }>;
  closeForward(o: { id: string }): Promise<void>;
  listForwards(): Promise<{ forwards: { id: string; connected: boolean }[] }>;
};
export type VpnNative = { start(o: { host: string; port: number; key: string; subnets: string[]; ttlMs: number }): Promise<void>; stop(): Promise<void>; status(): Promise<{ state: string; expiresAt: number }> };
let tunnelNative: TunnelNative = registerPlugin<TunnelNative>("MiaiTunnel");
let vpnNative: VpnNative = registerPlugin<VpnNative>("MiaiVpn");
let nativeCheck = isNative;
/** Tests only: replace the Android plugins with fakes. Results obtained this way are simulations. */
export function __setTunnelNatives(t: TunnelNative, v: VpnNative) { tunnelNative = t; vpnNative = v; nativeCheck = () => true; }
export async function stopNativeVpn() { if (nativeCheck()) await vpnNative.stop().catch(() => undefined); }

const sessionSecrets = new Map<string, { user?: string; pass?: string }>();
/** SOCKS credentials for an open tunnel; kept in memory only and never stored. */
export const tunnelCredentials = (id: string) => sessionSecrets.get(id) ?? null;

const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
export function validTarget(t: string) {
  const m = /^([A-Za-z0-9.-]{1,253}):(\d{1,5})$/.exec(t); if (!m) return false;
  const port = Number(m[2]); return port > 0 && port < 65536 && m[1] !== "0.0.0.0";
}
export function validSubnet(s: string) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(s); if (!m) return false;
  return m.slice(1, 5).every((x) => Number(x) <= 255) && Number(m[5]) >= 8 && Number(m[5]) <= 32;
}
async function log(repo: Repo, p: string, id: string, event: string) {
  const [t] = await repo.sql.all<Tunnel>("SELECT * FROM tunnels WHERE project_id=? AND id=?", [p, id]); if (!t) return;
  const l = JSON.parse(t.log) as unknown[]; l.push({ at: Date.now(), event });
  await repo.sql.run("UPDATE tunnels SET log=? WHERE id=?", [JSON.stringify(l.slice(-200)), id]);
}
const clampTtl = (ms: number) => Math.min(Math.max(Math.round(ms) || 600_000, 10_000), 2 * 3600_000);

export type OpenOpts = {
  kind?: Kind; target: string; ttlMs: number; agent: string; reconnect?: boolean;
  nodeId?: string | undefined;          // PC kinds
  connectionId?: string | undefined;    // SSH kinds
  password?: string | undefined;        // SSH: one-time password if none saved
  remotePort?: number | undefined;      // ssh.reverse
  allow?: string[] | undefined;         // ssh.socks5 destinations
  subnets?: string[] | undefined;       // vpn
};

export const tunnels = {
  list(repo: Repo, p: string) { need(p); return repo.sql.all<Tunnel>("SELECT * FROM tunnels WHERE project_id=? ORDER BY created_at DESC", [p]); },
  /** Caller must hold an approval bound to these exact options; native kinds also show an Android confirmation. */
  async open(repo: Repo, p: string, o: OpenOpts) {
    need(p); if (!await repo.getProject(p)) throw new Error("Proyecto inexistente");
    const kind: Kind = o.kind ?? "pc.dev"; const info = TUNNEL_INFO[kind]; if (!info) throw new Error("Tipo de túnel desconocido");
    if (info.nativeOnly && !nativeCheck()) throw new Error(`${info.label}: solo disponible en la app Android.`);
    const ttlMs = clampTtl(o.ttlMs);
    let target = o.target;
    if (kind === "ssh.socks5") { const allow = (o.allow ?? []).map((a) => a.trim()).filter(Boolean); if (!allow.length || allow.length > 50 || !allow.every(validTarget)) throw new Error("Destinos SOCKS no válidos"); target = allow.join(","); }
    else if (kind === "vpn") { const s = o.subnets ?? []; if (!s.length || s.length > 8 || !s.every(validSubnet)) throw new Error("Subredes no válidas"); target = s.join(","); }
    else if (kind === "pc.socks5") target = "lista permitida del nodo";
    else if (!validTarget(target)) throw new Error("Destino inválido");
    if (kind === "ssh.reverse" && !(Number.isInteger(o.remotePort) && o.remotePort! >= 1024 && o.remotePort! < 65536)) throw new Error("Puerto remoto no válido (≥1024)");

    let owner: string, ssh: SshCfg | null = null;
    if (info.via === "pc") { const n = await nodes.get(repo, o.nodeId ?? ""); if (!n || n.revoked) throw new Error("Nodo no autorizado"); owner = n.id; }
    else {
      const c = (await connections.list(repo, p)).find((x) => x.id === o.connectionId && x.kind === "ssh"); if (!c) throw new Error("Conexión SSH ajena al proyecto");
      const password = o.password || await repo.getConnectionSecret(p, c.id); if (!password) throw new Error("Falta la contraseña de la conexión SSH");
      ssh = { ...(JSON.parse(c.config) as Omit<SshCfg, "password">), password }; owner = c.id;
    }
    const id = crypto.randomUUID();
    await repo.sql.run("INSERT INTO tunnels (id,project_id,node_id,remote_id,kind,target,port,agent,status,reconnect,expires_at,opened_at,closed_at,log,created_at) VALUES (?,?,?,NULL,?,?,NULL,?,'opening',?,NULL,NULL,NULL,'[]',?)", [id, p, owner, kind, kind === "ssh.reverse" ? `srv:${o.remotePort}→${target}` : target, o.agent.slice(0, 80), o.reconnect ? 1 : 0, Date.now()]);
    try {
      let r: { id: string; port: number; expiresAt: number; user?: string; pass?: string };
      const [host, port] = target.split(":");
      if (kind === "pc.dev") r = await rpc(repo, owner, "tunnel.open", { targetHost: host, targetPort: Number(port), ttlMs });
      else if (kind === "pc.socks5") r = await rpc(repo, owner, "socks.open", { ttlMs });
      else if (kind === "vpn") {
        const n = (await nodes.get(repo, owner))!;
        const v = await rpc<{ id: string; port: number; expiresAt: number; key: string; subnets: string[] }>(repo, owner, "vpn.open", { subnets: o.subnets, ttlMs });
        try { await vpnNative.start({ host: n.host, port: v.port, key: v.key, subnets: v.subnets, ttlMs }); }
        catch (e) { await rpc(repo, owner, "tunnel.close", { tunnelId: v.id }).catch(() => undefined); throw e; }
        r = { id: v.id, port: v.port, expiresAt: v.expiresAt };
      } else if (kind === "ssh.local") r = await tunnelNative.forwardLocal({ ...ssh!, targetHost: host, targetPort: Number(port), ttlMs });
      else if (kind === "ssh.reverse") r = await tunnelNative.forwardRemote({ ...ssh!, remotePort: o.remotePort!, targetHost: host, targetPort: Number(port), ttlMs });
      else r = await tunnelNative.socksDynamic({ ...ssh!, allow: target.split(","), ttlMs });
      if (r.user && r.pass) sessionSecrets.set(id, { user: r.user, pass: r.pass });
      await repo.sql.run("UPDATE tunnels SET remote_id=?, port=?, status='open', expires_at=?, opened_at=? WHERE id=?", [r.id, r.port, r.expiresAt, Date.now(), id]);
      await log(repo, p, id, `abierto por ${o.agent} (${info.label}) hacia ${target}`);
    } catch (e) { await repo.sql.run("UPDATE tunnels SET status='error' WHERE id=?", [id]); await log(repo, p, id, `rechazado: ${String((e as Error)?.message ?? e).slice(0, 160)}`); throw e; }
    return id;
  },
  async close(repo: Repo, p: string, id: string, why = "cerrado") {
    need(p); const [t] = await repo.sql.all<Tunnel>("SELECT * FROM tunnels WHERE project_id=? AND id=?", [p, id]); if (!t) throw new Error("Túnel ajeno al proyecto");
    const info = TUNNEL_INFO[t.kind as Kind] ?? TUNNEL_INFO["pc.dev"];
    if (t.kind === "vpn") await stopNativeVpn();
    if (t.remote_id) {
      if (info.via === "pc") await rpc(repo, t.node_id, "tunnel.close", { tunnelId: t.remote_id }).catch(() => undefined);
      else if (nativeCheck()) await tunnelNative.closeForward({ id: t.remote_id }).catch(() => undefined);
    }
    sessionSecrets.delete(id);
    await repo.sql.run("UPDATE tunnels SET status=?, closed_at=? WHERE id=?", [why, Date.now(), id]); await log(repo, p, id, why);
  },
  /** Reconnect only under the original authorization: same owner/target, not revoked, policy flag set, not expired. Credentials are never reused from storage for SOCKS/VPN sessions. */
  async reconnect(repo: Repo, p: string, id: string) {
    need(p); const [t] = await repo.sql.all<Tunnel>("SELECT * FROM tunnels WHERE project_id=? AND id=?", [p, id]); if (!t) throw new Error("Túnel ajeno al proyecto");
    if (!t.reconnect) throw new Error("Este túnel no autoriza reconexión automática");
    if (t.expires_at && t.expires_at < Date.now()) throw new Error("Autorización vencida");
    if (t.kind !== "pc.dev") throw new Error("Este tipo de túnel requiere una nueva confirmación para reconectar");
    const n = await nodes.get(repo, t.node_id); if (!n || n.revoked) throw new Error("Nodo revocado");
    return tunnels.open(repo, p, { nodeId: t.node_id, target: t.target, ttlMs: (t.expires_at ?? Date.now()) - Date.now(), agent: t.agent, reconnect: true });
  },
  /** At app start: native tunnels never survive a process restart; mark them closed instead of reopening. Expired rows close too. */
  async recover(repo: Repo) {
    const open = await repo.sql.all<Tunnel>("SELECT * FROM tunnels WHERE status IN ('open','opening')");
    let alive = new Set<string>();
    if (nativeCheck()) alive = new Set((await tunnelNative.listForwards().catch(() => ({ forwards: [] }))).forwards.filter((f) => f.connected).map((f) => f.id));
    const vpnActive = nativeCheck() ? (await vpnNative.status().catch(() => ({ state: "" }))).state === "activa" : false;
    for (const t of open) {
      const info = TUNNEL_INFO[t.kind as Kind];
      const expired = t.expires_at !== null && t.expires_at < Date.now();
      const orphan = t.status === "opening" || (info?.via === "ssh" && !alive.has(t.remote_id ?? "")) || (t.kind === "vpn" && !vpnActive);
      if (expired || orphan) { await repo.sql.run("UPDATE tunnels SET status=?, closed_at=? WHERE id=?", [expired ? "expirado" : "interrumpido", Date.now(), t.id]); await log(repo, t.project_id, t.id, expired ? "expirado" : "interrumpido al reiniciar la app; no se reabre solo"); }
    }
  },
};
