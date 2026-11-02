// Device integration: "Guardar como", "Compartir en…", files shared from other apps, cache staging and
// chunked reads so large files never travel as one base64 string. Web preview uses browser fallbacks.
import { Capacitor, registerPlugin } from "@capacitor/core";

export type InboxItem = { kind: "file" | "text"; path?: string; name?: string; mime?: string; size?: number; text?: string };
interface DevicePlugin {
  startWork(o: { title: string; text: string }): Promise<void>;
  stopWork(): Promise<void>;
  saveAs(o: { path: string; name: string; mime: string }): Promise<{ saved: boolean }>;
  share(o: { path?: string; text?: string; mime?: string; title?: string; subject?: string }): Promise<void>;
  getInbox(): Promise<{ items: InboxItem[] }>;
  clearInbox(): Promise<void>;
  addListener(e: "inbox", cb: () => void): Promise<{ remove(): Promise<void> }>;
}
export const MiaiDevice = registerPlugin<DevicePlugin>("MiaiDevice");
export const onDevice = () => Capacitor.isNativePlatform();

export const CHUNK = 1 << 20; // 1 MB pieces

/** Reads a Blob/File in bounded pieces (never the whole file at once). */
export async function* blobChunks(b: Blob, size = CHUNK): AsyncGenerator<Uint8Array> {
  for (let o = 0; o < b.size; o += size) yield new Uint8Array(await b.slice(o, Math.min(b.size, o + size)).arrayBuffer());
}
export async function* bytesChunks(b: Uint8Array, size = CHUNK): AsyncGenerator<Uint8Array> {
  for (let o = 0; o < b.length; o += size) yield b.subarray(o, o + size);
}
export type Bytesish = Uint8Array | Blob | AsyncIterable<Uint8Array>;
export const toChunks = (d: Bytesish): AsyncIterable<Uint8Array> => d instanceof Uint8Array ? bytesChunks(d) : d instanceof Blob ? blobChunks(d) : d;

export const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const safeName = (n: string) => n.replace(/[^\w.\- ]/g, "_").slice(-120) || "archivo";

/** Writes chunks into the private app cache (cache/miai-stage/…) piece by piece; returns the cache-relative path. */
export async function stageToCache(data: Bytesish, name: string): Promise<string> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const path = `miai-stage/${crypto.randomUUID()}-${safeName(name)}`;
  await Filesystem.writeFile({ path, data: "", directory: Directory.Cache, recursive: true });
  try {
    for await (const c of toChunks(data)) for (let o = 0; o < c.length; o += CHUNK) await Filesystem.appendFile({ path, data: b64(c.subarray(o, o + CHUNK)), directory: Directory.Cache });
  } catch (e) { await removeCache(path); throw e; }
  return path;
}
/** Streams a cache file back without loading it whole (served by the app's local file server). */
export async function* readCacheFile(path: string): AsyncGenerator<Uint8Array> {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  const res = await fetch(Capacitor.convertFileSrc(uri));
  if (!res.ok || !res.body) throw new Error("No se pudo leer el archivo temporal");
  const reader = res.body.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) return; if (value?.length) yield value; }
}
export async function removeCache(path: string) {
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined);
}

async function collectBlob(data: Bytesish, mime: string): Promise<Blob> {
  if (data instanceof Blob) return data;
  if (data instanceof Uint8Array) return new Blob([data as BlobPart], { type: mime });
  const parts: BlobPart[] = []; for await (const c of data) parts.push(c.slice() as BlobPart);
  return new Blob(parts, { type: mime });
}
function download(blob: Blob, name: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

export type SaveResult = "saved" | "cancelled" | "downloaded" | "documents";
/** "Guardar como": the person picks folder and name (Android document picker). Falls back to Documents/MI AI. */
export async function saveAs(data: Bytesish, name: string, mime: string): Promise<SaveResult> {
  if (onDevice()) {
    const path = await stageToCache(data, name);
    try { const r = await MiaiDevice.saveAs({ path, name, mime }); if (r.saved) return "saved"; await removeCache(path); return "cancelled"; }
    catch {
      // Older picker/OEM failure: keep the previous behavior (Documents/MI AI) instead of losing the export.
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      await Filesystem.writeFile({ path: `MI AI/${safeName(name)}`, data: "", directory: Directory.Documents, recursive: true });
      for await (const c of readCacheFile(path)) await Filesystem.appendFile({ path: `MI AI/${safeName(name)}`, data: b64(c), directory: Directory.Documents });
      await removeCache(path); return "documents";
    }
  }
  const blob = await collectBlob(data, mime);
  const w = window as unknown as { showSaveFilePicker?: (o: { suggestedName: string }) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }> };
  if (w.showSaveFilePicker) {
    try { const h = await w.showSaveFilePicker({ suggestedName: name }); const s = await h.createWritable(); await s.write(blob); await s.close(); return "saved"; }
    catch (e) { if (e instanceof DOMException && e.name === "AbortError") return "cancelled"; }
  }
  download(blob, name); return "downloaded";
}

/** "Compartir en…": opens the Android share sheet (WhatsApp, Gmail, Drive, Telegram…) for a file and/or text. */
export async function shareContent(o: { text?: string; title?: string; file?: { data: Bytesish; name: string; mime: string } }): Promise<"shared" | "copied" | "downloaded"> {
  if (onDevice()) {
    const path = o.file ? await stageToCache(o.file.data, o.file.name) : undefined;
    await MiaiDevice.share({ ...(path ? { path, mime: o.file!.mime } : {}), ...(o.text ? { text: o.text } : {}), ...(o.title ? { subject: o.title } : {}), title: "Compartir en…" });
    return "shared"; // staged copy is cleaned with the app cache; the receiving app may still be reading it
  }
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (o.file) {
    const f = new File([await collectBlob(o.file.data, o.file.mime)], o.file.name, { type: o.file.mime });
    if (nav.share && nav.canShare?.({ files: [f] })) { await nav.share({ files: [f], ...(o.title ? { title: o.title } : {}), ...(o.text ? { text: o.text } : {}) }); return "shared"; }
    download(f, o.file.name); return "downloaded";
  }
  if (nav.share) { await nav.share({ ...(o.title ? { title: o.title } : {}), text: o.text ?? "" }); return "shared"; }
  await navigator.clipboard.writeText(o.text ?? ""); return "copied";
}

// ---------- received shares ----------
export async function readInbox(): Promise<InboxItem[]> { if (!onDevice()) return []; try { return (await MiaiDevice.getInbox()).items ?? []; } catch { return []; } }
export async function clearInbox() { if (onDevice()) await MiaiDevice.clearInbox().catch(() => undefined); }
export function onInbox(cb: () => void): () => void {
  if (!onDevice()) return () => {};
  let h: { remove(): Promise<void> } | null = null, gone = false;
  void MiaiDevice.addListener("inbox", cb).then((x) => { if (gone) void x.remove(); else h = x; });
  return () => { gone = true; void h?.remove(); };
}
