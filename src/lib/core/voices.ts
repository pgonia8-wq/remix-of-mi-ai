// Project-scoped voices created by the user. Stores only the provider's voice ID and the consent timestamp.
import type { SqlDb } from "../db/sql";

export type Voice = { id: string; project_id: string; provider_id: string; voice_id: string; name: string; consent_at: number; created_at: number };

const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };

export const voices = {
  list: (db: SqlDb, projectId: string) => { need(projectId); return db.all<Voice>(`SELECT * FROM voices WHERE project_id=? ORDER BY created_at DESC`, [projectId]); },
  async add(db: SqlDb, projectId: string, v: { providerId: string; voiceId: string; name: string; consentAt: number }) {
    need(projectId);
    if (!v.consentAt) throw new Error("Sin consentimiento registrado no se guarda la voz.");
    const id = crypto.randomUUID(), now = Date.now();
    await db.run(`INSERT INTO voices (id, project_id, provider_id, voice_id, name, consent_at, created_at) VALUES (?,?,?,?,?,?,?)`, [id, projectId, v.providerId, v.voiceId, v.name, v.consentAt, now]);
    return id;
  },
  remove: (db: SqlDb, projectId: string, id: string) => { need(projectId); return db.run(`DELETE FROM voices WHERE project_id=? AND id=?`, [projectId, id]); },
};
