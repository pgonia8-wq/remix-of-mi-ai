import { getAdapter } from "./adapters";
import type { AdapterCredentials } from "./adapters/types";

export type DraftConnection = { adapterId: string; credentials: AdapterCredentials; capability: string };
export type DraftVerification = { fingerprint: string; ok: boolean; message: string };

export function connectionFingerprint(draft: DraftConnection) {
  // In-memory only: this value includes a credential and must never be logged or persisted.
  return JSON.stringify(draft);
}

export function canSaveConnection(draft: DraftConnection, verified: DraftVerification | null) {
  return verified?.ok === true && verified.fingerprint === connectionFingerprint(draft);
}

export async function verifyConnection(draft: DraftConnection): Promise<DraftVerification> {
  const fingerprint = connectionFingerprint(draft);
  try {
    const adapter = getAdapter(draft.adapterId);
    if (!adapter.supports(draft.capability)) throw new Error("El adaptador no admite esta capacidad.");
    const result = await adapter.run(draft.credentials, { capability: draft.capability, model: draft.credentials.model,
      prompt: draft.capability === "audio.tts" ? "Prueba de MI AI." : "Responde solo: OK" });
    const ok = result.kind === "text" ? result.text.trim().length > 0
      : result.kind === "files" ? result.files.some(file => file.bytes.length > 100)
      : result.kind === "search" ? result.results.length > 0
      : result.kind === "vectors" ? result.vectors.length > 0 && result.vectors.every(row => row.length > 0 && row.every(Number.isFinite)) : false;
    return { fingerprint, ok, message: ok ? "Conexión exitosa: resultado real recibido." : "No se recibió un resultado válido. No se guardó la conexión." };
  } catch {
    // Do not echo arbitrary provider errors: they could include credentials.
    return { fingerprint, ok: false, message: "No se pudo verificar. Revisa la clave, el modelo, sus permisos y la conexión de red." };
  }
}