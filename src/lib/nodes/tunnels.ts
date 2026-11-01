// Tunnel Manager: authorized, logged, time-limited tunnels. Never opens public ports or acts as an open proxy.
import type { Repo } from "../db/repo";
import { rpc, nodes } from "./client";

export type Tunnel = { id: string; project_id: string; node_id: string; remote_id: string | null; kind: string; target: string; port: number | null; agent: string; status: string; reconnect: number; expires_at: number | null; opened_at: number | null; closed_at: number | null; log: string; created_at: number };
/** What this build can really do. SSH forwarding and VPN need native components not present yet. */
export const TUNNEL_KINDS = {
  "pc.dev": { label: "Túnel de desarrollo hacia la PC", available: true, note: "Puerto LAN temporal, solo acepta la IP del teléfono emparejado y destinos permitidos en el nodo." },
  "ssh.local": { label: "SSH reenvío local", available: false, note: "Requiere ampliar el plugin nativo SSH (bloque 5)." },
  "ssh.reverse": { label: "SSH reenvío inverso", available: false, note: "Requiere ampliar el plugin nativo SSH (bloque 5)." },
  socks5: { label: "SOCKS5", available: false, note: "No disponible: evitaría un proxy abierto sin control nativo." },
  vpn: { label: "VPN", available: false, note: "Requiere un servicio VPN de Android; no incluido." },
} as const;
const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
export function validTarget(t: string) {
  const m = /^([A-Za-z0-9.-]{1,253}):(\d{1,5})$/.exec(t); if (!m) return false;
  const port = Number(m[2]); return port > 0 && port < 65536 && m[1] !== "0.0.0.0";
}
async function log(repo: Repo, p: string, id: string, event: string) {
  const [t] = await repo.sql.all<Tunnel>("SELECT * FROM tunnels WHERE project_id=? AND id=?", [p, id]); if (!t) return;
  const l = JSON.parse(t.log) as unknown[]; l.push({ at: Date.now(), event });
  await repo.sql.run("UPDATE tunnels SET log=? WHERE id=?", [JSON.stringify(l.slice(-200)), id]);
}
export const tunnels = {
  list(repo: Repo, p: string) { need(p); return repo.sql.all<Tunnel>("SELECT * FROM tunnels WHERE project_id=? ORDER BY created_at DESC", [p]); },
  /** Caller must have an approval bound to (node, target, ttl); see the tool registry. */
  async open(repo: Repo, p: string, o: { nodeId: string; target: string; ttlMs: number; agent: string; kind?: keyof typeof TUNNEL_KINDS; reconnect?: boolean }) {
    need(p); if (!await repo.getProject(p)) throw new Error("Proyecto inexistente");
    const kind = o.kind ?? "pc.dev"; if (!TUNNEL_KINDS[kind].available) throw new Error(TUNNEL_KINDS[kind].note);
    if (!validTarget(o.target)) throw new Error("Destino inválido");
    const n = await nodes.get(repo, o.nodeId); if (!n || n.revoked) throw new Error("Nodo no autorizado");
    const id = crypto.randomUUID(); const [host, port] = o.target.split(":");
    await repo.sql.run("INSERT INTO tunnels (id,project_id,node_id,remote_id,kind,target,port,agent,status,reconnect,expires_at,opened_at,closed_at,log,created_at) VALUES (?,?,?,NULL,?,?,NULL,?,'opening',?,NULL,NULL,NULL,'[]',?)", [id, p, o.nodeId, kind, o.target, o.agent.slice(0, 80), o.reconnect ? 1 : 0, Date.now()]);
    try {
      const r = await rpc<{ id: string; port: number; expiresAt: number }>(repo, o.nodeId, "tunnel.open", { targetHost: host, targetPort: Number(port), ttlMs: o.ttlMs });
      await repo.sql.run("UPDATE tunnels SET remote_id=?, port=?, status='open', expires_at=?, opened_at=? WHERE id=?", [r.id, r.port, r.expiresAt, Date.now(), id]);
      await log(repo, p, id, `abierto por ${o.agent} hacia ${o.target}`);
    } catch (e) { await repo.sql.run("UPDATE tunnels SET status='error' WHERE id=?", [id]); await log(repo, p, id, "rechazado por el nodo"); throw e; }
    return id;
  },
  async close(repo: Repo, p: string, id: string, why = "cerrado") {
    need(p); const [t] = await repo.sql.all<Tunnel>("SELECT * FROM tunnels WHERE project_id=? AND id=?", [p, id]); if (!t) throw new Error("Túnel ajeno al proyecto");
    if (t.remote_id) await rpc(repo, t.node_id, "tunnel.close", { tunnelId: t.remote_id }).catch(() => undefined);
    await repo.sql.run("UPDATE tunnels SET status=?, closed_at=? WHERE id=?", [why, Date.now(), id]); await log(repo, p, id, why);
  },
  /** Reconnect only under the original authorization: same node/target, not revoked, policy flag set, not expired. */
  async reconnect(repo: Repo, p: string, id: string) {
    need(p); const [t] = await repo.sql.all<Tunnel>("SELECT * FROM tunnels WHERE project_id=? AND id=?", [p, id]); if (!t) throw new Error("Túnel ajeno al proyecto");
    if (!t.reconnect) throw new Error("Este túnel no autoriza reconexión automática");
    if (t.expires_at && t.expires_at < Date.now()) throw new Error("Autorización vencida");
    const n = await nodes.get(repo, t.node_id); if (!n || n.revoked) throw new Error("Nodo revocado");
    return tunnels.open(repo, p, { nodeId: t.node_id, target: t.target, ttlMs: (t.expires_at ?? Date.now()) - Date.now(), agent: t.agent, reconnect: true });
  },
};
