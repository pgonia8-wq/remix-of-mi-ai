import { z } from "zod";
import type { Repo } from "./db/repo";
import { registerPlugin, Capacitor } from "@capacitor/core";
const configSchema = z.object({ host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535), user: z.string().min(1).max(100), knownHosts: z.string().min(1).max(16000) });
export type ConnectionConfig = z.infer<typeof configSchema>;
export type Connection = { id: string; project_id: string; name: string; kind: "ssh" | "github"; config: string; updated_at: number };
type Remote = { exec(o: ConnectionConfig & { password: string; command: string }): Promise<{ output: string; exitCode: number }>; sftp(o: ConnectionConfig & { password: string; path: string; action: "list" | "read" | "write"; data?: string }): Promise<{ output: string; data?: string }>; openTermux(): Promise<void> };
const native = registerPlugin<Remote>("MiaiRemote");
const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
export const connections = {
  list(repo: Repo, p: string) { need(p); return repo.sql.all<Connection>("SELECT * FROM connections WHERE project_id=?", [p]); },
  async save(repo: Repo, p: string, name: string, config: ConnectionConfig) {
    need(p); if (!await repo.getProject(p) || !name.trim()) throw new Error("Nombre o proyecto no válido");
    const cfg = configSchema.parse(config); if (!/^[a-zA-Z0-9.:-]+$/.test(cfg.host)) throw new Error("Host incorrecto");
    const id = crypto.randomUUID(); await repo.sql.run("INSERT INTO connections VALUES (?,?,?,'ssh',?,?)", [id, p, name.trim(), JSON.stringify(cfg), Date.now()]); return id;
  },
  async remove(repo: Repo, p: string, id: string) { need(p); await repo.sql.run("DELETE FROM connection_secrets WHERE project_id=? AND connection_id=?", [p, id]); await repo.sql.run("DELETE FROM connections WHERE project_id=? AND id=?", [p, id]); },
  async call(repo: Repo, p: string, id: string, request: { command?: string; path?: string; action?: "list" | "read" | "write"; data?: string }, password?: string) {
    need(p); const c = (await connections.list(repo, p)).find((x) => x.id === id && x.kind === "ssh"); if (!c) throw new Error("Conexión ajena al proyecto");
    if (!Capacitor.isNativePlatform()) throw new Error("SSH/SFTP solo disponibles dentro de la APK Android.");
    const cfg = configSchema.parse(JSON.parse(c.config)), secret = password || await repo.getConnectionSecret(p, id);
    if (!secret) throw new Error("Falta contraseña de conexión.");
    if (request.command) return native.exec({ ...cfg, password: secret, command: request.command });
    return native.sftp({ ...cfg, password: secret, path: request.path ?? ".", action: request.action ?? "list", ...(request.data ? { data: request.data } : {}) });
  },
  async termux() { if (!Capacitor.isNativePlatform()) throw new Error("Termux solo está disponible en Android."); await native.openTermux(); },
};