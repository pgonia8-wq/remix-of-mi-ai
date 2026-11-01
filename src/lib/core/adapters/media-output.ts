import { ProviderError } from "../../providers";

/** Provider result URLs are untrusted; never forward credentials to them. */
export async function downloadMedia(url: string, expectedMime: string, maxBytes = 100 * 1024 * 1024): Promise<Uint8Array> {
  let target: URL;
  try { target = new URL(url); } catch { throw new ProviderError("parameters", "El proveedor devolvió una URL de archivo inválida."); }
  if (target.protocol !== "https:" || target.username || target.password) throw new ProviderError("parameters", "El archivo requiere una URL HTTPS sin credenciales.");
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 120_000);
  try {
    const res = await fetch(target, { signal: ctl.signal, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    if (!res.ok || !res.body) throw new ProviderError("network", "No se pudo descargar el resultado del proveedor.", res.status);
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > maxBytes) throw new ProviderError("parameters", "El archivo excede el límite de memoria de esta operación.");
    const mime = res.headers.get("content-type")?.split(";")[0];
    if (mime && mime !== expectedMime && mime !== "application/octet-stream" && !(expectedMime === "model/gltf-binary" && mime === "binary/octet-stream")) throw new ProviderError("parameters", "El proveedor devolvió un tipo de archivo inesperado.");
    const reader = res.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.length;
        if (size > maxBytes) { await reader.cancel(); throw new ProviderError("parameters", "El archivo excede el límite de memoria de esta operación."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (size < 12) throw new ProviderError("parameters", "El resultado está vacío o incompleto.");
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (expectedMime === "model/gltf-binary" && new TextDecoder().decode(bytes.subarray(0, 4)) !== "glTF") throw new ProviderError("parameters", "El archivo no es un GLB válido.");
    if (expectedMime === "video/mp4" && new TextDecoder().decode(bytes.subarray(4, 8)) !== "ftyp") throw new ProviderError("parameters", "El archivo no es un MP4 válido.");
    return bytes;
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    throw new ProviderError("network", "La descarga no se confirmó. Consulta el trabajo sin volver a generar.");
  } finally { clearTimeout(timer); }
}