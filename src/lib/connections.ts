import { z } from "zod";
import type { Repo } from "./db/repo";
import { registerPlugin, Capacitor } from "@capacitor/core";
const configSchema = z.object({ host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535), user: z.string().min(1).max(100), knownHosts: z.string().min(1).max(16000) });
export type ConnectionConfig = z.infer<typeof configSchema>;
export type Connection = { id: string; project_id: string; name: string; kind: "ssh" | "github"; config: string; updated_at: number };
type Remote = { exec(o: ConnectionConfig & { password: string; privateKey?: string; passphrase?: string; command: string }): Promise<{ output: string; exitCode: number }>; sftp(o: ConnectionConfig & { password: string; privateKey?: string; passphrase?: string; path: string; action: "list" | "read" | "write"; data?: string }): Promise<{ output: string; data?: string }>; openTermux(): Promise<void> };
const native = registerPlugin<Remote>("MiaiRemote");

/** Credential stored per connection: legacy plain password, or JSON with a private key (never shown again). */
export type SshCredential = { password?: string | undefined; privateKey?: string | undefined; passphrase?: string | undefined };
export function encodeCredential(c: SshCredential): string {
  const password = c.password ?? "", passphrase = c.passphrase ?? "";
  if (!c.privateKey?.trim()) return password;
  return JSON.stringify({ miai: "ssh-credential", privateKey: normalizePrivateKey(c.privateKey), ...(passphrase ? { passphrase } : {}), ...(password ? { password } : {}) });
}
export function decodeCredential(raw: string): SshCredential {
  if (raw.startsWith('{"miai":"ssh-credential"')) { try { const j = JSON.parse(raw) as SshCredential; return { privateKey: j.privateKey, passphrase: j.passphrase, password: j.password }; } catch { /* legacy */ } }
  return { password: raw };
}
export function normalizePrivateKey(raw: string): string {
  const k = raw.replace(/\r\n?/g, "\n").trim();
  if (/PuTTY-User-Key-File/i.test(k)) throw new Error("Las claves .ppk de PuTTY no sirven aquí. Exporta la clave como OpenSSH (PuTTYgen → Conversions → Export OpenSSH key) o usa el archivo .pem.");
  if (!/^-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----\n[\s\S]+\n-----END [A-Z0-9 ]*PRIVATE KEY-----$/.test(k)) throw new Error("La clave privada debe empezar con «-----BEGIN … PRIVATE KEY-----» y terminar con «-----END … PRIVATE KEY-----». Pega el contenido completo del archivo .pem.");
  if (k.length > 16000) throw new Error("La clave privada es demasiado grande.");
  return k + "\n";
}

const KEY_TYPE = "ssh-ed25519|ssh-rsa|ssh-dss|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\\.com|sk-ecdsa-sha2-nistp256@openssh\\.com";
const KEY_LINE = new RegExp(`^(?:(\\S+)\\s+)?(${KEY_TYPE})\\s+([A-Za-z0-9+/]+=*)(?:\\s.*)?$`);
/**
 * Accepts raw `ssh-keyscan` output (comments, prompts, several keys) and returns clean known_hosts lines.
 * A bare "ssh-ed25519 AAAA…" line is bound to this host:port. Lines for another server are rejected.
 */
export function cleanKnownHosts(raw: string, host: string, port: number): string {
  const label = port === 22 ? host : `[${host}]:${port}`, out: string[] = []; let foreign = 0;
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const t = line.trim(); if (!t || t.startsWith("#") || t.startsWith("@")) continue;
    const m = KEY_LINE.exec(t); if (!m) continue;
    const [, hostField, type, b64] = m; try { atob(b64!); } catch { continue; }
    if (hostField && !hostField.startsWith("|1|")) {
      const names = hostField.split(",").map((x) => x.toLowerCase());
      if (!names.includes(host.toLowerCase()) && !names.includes(label.toLowerCase())) { foreign++; continue; }
    }
    out.push(`${hostField ?? label} ${type} ${b64}`);
  }
  if (!out.length) throw new Error(foreign ? "La clave de host pegada es de otro servidor, no de " + host + "." : "No encontré ninguna clave de host válida. Pega la línea que empieza con la IP y «ssh-ed25519» (salida de ssh-keyscan).");
  return [...new Set(out)].join("\n");
}
const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
export const connections = {
  list(repo: Repo, p: string) { need(p); return repo.sql.all<Connection>("SELECT * FROM connections WHERE project_id=?", [p]); },
  async save(repo: Repo, p: string, name: string, config: ConnectionConfig) {
    need(p); if (!await repo.getProject(p) || !name.trim()) throw new Error("Nombre o proyecto no válido");
    const cfg = configSchema.parse(config); if (!/^[a-zA-Z0-9.:-]+$/.test(cfg.host)) throw new Error("Host incorrecto");
    cfg.knownHosts = cleanKnownHosts(cfg.knownHosts, cfg.host, cfg.port);
    const id = crypto.randomUUID(); await repo.sql.run("INSERT INTO connections VALUES (?,?,?,'ssh',?,?)", [id, p, name.trim(), JSON.stringify(cfg), Date.now()]); return id;
  },
  async remove(repo: Repo, p: string, id: string) { need(p); await repo.sql.run("DELETE FROM connection_secrets WHERE project_id=? AND connection_id=?", [p, id]); await repo.sql.run("DELETE FROM connections WHERE project_id=? AND id=?", [p, id]); },
  async call(repo: Repo, p: string, id: string, request: { command?: string; path?: string; action?: "list" | "read" | "write"; data?: string }, password?: string) {
    need(p); const c = (await connections.list(repo, p)).find((x) => x.id === id && x.kind === "ssh"); if (!c) throw new Error("Conexión ajena al proyecto");
    if (!Capacitor.isNativePlatform()) throw new Error("SSH/SFTP solo disponibles dentro de la APK Android.");
    const cfg = configSchema.parse(JSON.parse(c.config)), secret = password || await repo.getConnectionSecret(p, id);
    // Connections saved before the cleanup existed may hold raw ssh-keyscan output: clean it on use too.
    try { cfg.knownHosts = cleanKnownHosts(cfg.knownHosts, cfg.host, cfg.port); } catch { /* the native side reports the exact host-key error */ }
    if (!secret) throw new Error("Falta la contraseña o la clave privada de la conexión.");
    const cred = decodeCredential(secret), auth = { password: cred.password ?? "", ...(cred.privateKey ? { privateKey: cred.privateKey } : {}), ...(cred.passphrase ? { passphrase: cred.passphrase } : {}) };
    if (request.command) return native.exec({ ...cfg, ...auth, command: request.command });
    return native.sftp({ ...cfg, ...auth, path: request.path ?? ".", action: request.action ?? "list", ...(request.data ? { data: request.data } : {}) });
  },
  async termux() { if (!Capacitor.isNativePlatform()) throw new Error("Termux solo está disponible en Android."); await native.openTermux(); },
};