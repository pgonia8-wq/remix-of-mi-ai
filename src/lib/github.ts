import type { Repo } from "./db/repo";
export type GitFile = { name: string; path: string; type: string; sha: string; content?: string; encoding?: string };
const segment = (s: string) => { if (!/^[\w.-]+$/.test(s)) throw new Error("Nombre de repositorio incorrecto"); return encodeURIComponent(s); };
export const github = {
  async verify(token: string) {
    const r = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error(`GitHub rechazó la conexión (HTTP ${r.status}).`);
    const data: unknown = await r.json();
    if (!data || typeof data !== "object" || !("login" in data) || typeof data.login !== "string") throw new Error("GitHub no devolvió una identidad válida.");
    return data.login;
  },
  async save(repo: Repo, p: string, owner: string, name: string, token: string) {
    if (!p || !await repo.getProject(p)) throw new Error("Proyecto inexistente");
    segment(owner); segment(name); await github.verify(token);
    const id = crypto.randomUUID(); await repo.sql.run("INSERT INTO connections VALUES (?,?,?,'github',?,?)", [id, p, `${owner}/${name}`, JSON.stringify({ owner, name }), Date.now()]);
    await repo.saveConnectionSecret(p, id, token); return id;
  },
  async request(repo: Repo, p: string, id: string, path: string, update?: { content: string; sha?: string; message: string }) {
    if (!p) throw new Error("projectId requerido");
    const [c] = await repo.sql.all<{ config: string }>("SELECT config FROM connections WHERE project_id=? AND id=? AND kind='github'", [p, id]);
    if (!c) throw new Error("Repositorio ajeno al proyecto");
    const token = await repo.getConnectionSecret(p, id); if (!token) throw new Error("Vuelve a configurar el token de GitHub; no se incluye en respaldos.");
    const cfg = JSON.parse(c.config) as { owner: string; name: string };
    if (path.split("/").some((x) => x === "..")) throw new Error("Ruta incorrecta");
    const r = await fetch(`https://api.github.com/repos/${segment(cfg.owner)}/${segment(cfg.name)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
      method: update ? "PUT" : "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(update ? { "Content-Type": "application/json" } : {}) },
      ...(update ? { body: JSON.stringify({ message: update.message, content: btoa(unescape(encodeURIComponent(update.content))), ...(update.sha ? { sha: update.sha } : {}) }) } : {}),
    });
    if (!r.ok) throw new Error(`GitHub HTTP ${r.status}. Revisa permisos, rama y versión del archivo; no se publicó un éxito.`);
    return await r.json() as GitFile | GitFile[];
  },
};