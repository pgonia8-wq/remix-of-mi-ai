import { getAdapter } from "./adapters";
import type { AdapterCredentials } from "./adapters/types";
import { ProviderError, redactSecret } from "../providers";

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
      prompt: draft.capability === "audio.tts" ? "Prueba de MI AI." : draft.capability === "research.web" ? "SearXNG documentación oficial" : "Responde solo: OK" });
    const ok = result.kind === "text" ? result.text.trim().length > 0
      : result.kind === "files" ? result.files.some(file => file.bytes.length > 100)
      : result.kind === "search" ? result.results.length > 0
      : result.kind === "vectors" ? result.vectors.length > 0 && result.vectors.every(row => row.length > 0 && row.every(Number.isFinite)) : false;
    return { fingerprint, ok, message: ok ? "Conexión exitosa: resultado real recibido." : "No se recibió un resultado válido. No se guardó la conexión." };
  } catch (error) {
    // Do not echo arbitrary provider errors: they could include credentials.
    if (error instanceof ProviderError) {
      const message = draft.adapterId === "searxng" && error.httpStatus === 403
        ? "La instancia rechazó JSON o el acceso (HTTP 403). Revisa formatos habilitados y permisos."
        : draft.adapterId === "searxng" && error.httpStatus === 429
          ? "La instancia limitó las búsquedas (HTTP 429). Espera o revisa sus límites; no se cambió de buscador."
          : `${error.message}${error.httpStatus ? ` HTTP ${error.httpStatus}` : ""}`;
      return { fingerprint, ok: false, message: redactSecret(message, draft.credentials.apiKey) };
    }
    if (draft.adapterId === "searxng") return { fingerprint, ok: false, message: "No se pudo verificar SearXNG. Revisa URL, HTTPS, formato JSON, permisos y acceso desde esta app." };
    return { fingerprint, ok: false, message: "No se pudo verificar. Revisa la clave, el modelo, sus permisos y la conexión de red." };
  }
}