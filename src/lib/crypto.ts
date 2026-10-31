// AES-256-GCM helpers built on WebCrypto (available in Android WebView and browsers).
const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function importRawKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 310_000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Returns "v1:<iv>:<ciphertext>" (base64). */
export async function encryptString(key: CryptoKey, plain: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, enc.encode(plain)),
  );
  return `v1:${b64(iv)}:${b64(ct)}`;
}

export async function decryptString(key: CryptoKey, payload: string): Promise<string> {
  const [v, iv, ct] = payload.split(":");
  if (v !== "v1" || !iv || !ct) throw new Error("Formato cifrado no válido");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unb64(iv) as BufferSource },
    key,
    unb64(ct) as BufferSource,
  );
  return dec.decode(pt);
}

/** Password-protected container used for export/import. */
export async function sealWithPassword(password: string, plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return JSON.stringify({ format: "miai-export", v: 1, salt: b64(salt), data: await encryptString(key, plain) });
}

export async function openWithPassword(password: string, sealed: string): Promise<string> {
  const obj = JSON.parse(sealed);
  if (obj.format !== "miai-export") throw new Error("Archivo de exportación no reconocido");
  const key = await deriveKey(password, unb64(obj.salt));
  try {
    return await decryptString(key, obj.data);
  } catch {
    throw new Error("Contraseña incorrecta o archivo dañado");
  }
}
