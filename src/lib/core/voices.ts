// Project-scoped voices created by the user. Stores only the provider's voice ID and the consent timestamp.
import type { SqlDb } from "../db/sql";

export type Voice = { id: string; project_id: string; provider_id: string; voice_id: string; name: string; consent_at: number; created_at: number };

const need = (p: string) => { if (!p) throw new Error("projectId requerido"); };
export const VERIFY_TTL_MS = 15 * 60_000;
export type VoiceVerification = { id: string; project_id: string; phrase: string; phrase_score: number; speaker_score: number; samples: number; used: number; created_at: number };

/** Proof that the live speaker read a random phrase and matches every sample. Recorded before anything is sent. */
export const verifications = {
  async record(db: SqlDb, projectId: string, v: { phrase: string; phraseScore: number; speakerScore: number; samples: number }) {
    need(projectId);
    if (v.phraseScore < 0.7 || v.speakerScore < 0.6 || v.samples < 1) throw new Error("La verificación de voz no se superó.");
    const id = crypto.randomUUID();
    await db.run(`INSERT INTO voice_verifications VALUES (?,?,?,?,?,?,0,?)`, [id, projectId, v.phrase, v.phraseScore, v.speakerScore, v.samples, Date.now()]);
    return id;
  },
  /** A verification is valid once, inside the project, for 15 minutes. */
  async assertUsable(db: SqlDb, projectId: string, id: string | undefined, now = Date.now()) {
    need(projectId);
    const [v] = id ? await db.all<VoiceVerification>(`SELECT * FROM voice_verifications WHERE project_id=? AND id=?`, [projectId, id]) : [];
    if (!v) throw new Error("Primero verifica que la voz es tuya (frase en vivo).");
    if (v.used) throw new Error("Esa verificación ya se usó. Repite la frase en vivo.");
    if (now - v.created_at > VERIFY_TTL_MS) throw new Error("La verificación expiró. Repite la frase en vivo.");
    return v;
  },
  markUsed: (db: SqlDb, projectId: string, id: string) => { need(projectId); return db.run(`UPDATE voice_verifications SET used=1 WHERE project_id=? AND id=?`, [projectId, id]); },
};

export const voices = {
  list: (db: SqlDb, projectId: string) => { need(projectId); return db.all<Voice>(`SELECT * FROM voices WHERE project_id=? ORDER BY created_at DESC`, [projectId]); },
  async add(db: SqlDb, projectId: string, v: { providerId: string; voiceId: string; name: string; consentAt: number; verificationId: string }) {
    need(projectId);
    if (!v.consentAt) throw new Error("Sin consentimiento registrado no se guarda la voz.");
    const [ver] = await db.all<VoiceVerification>(`SELECT * FROM voice_verifications WHERE project_id=? AND id=?`, [projectId, v.verificationId]);
    if (!ver) throw new Error("Sin verificación de voz no se guarda la voz.");
    const id = crypto.randomUUID(), now = Date.now();
    await db.run(`INSERT INTO voices (id, project_id, provider_id, voice_id, name, consent_at, created_at) VALUES (?,?,?,?,?,?,?)`, [id, projectId, v.providerId, v.voiceId, v.name, v.consentAt, now]);
    return id;
  },
  remove: (db: SqlDb, projectId: string, id: string) => { need(projectId); return db.run(`DELETE FROM voices WHERE project_id=? AND id=?`, [projectId, id]); },
};
