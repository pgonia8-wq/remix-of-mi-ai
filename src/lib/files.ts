// Binary files go to the app's private Android storage (Directory.Data), linked by project id.
import { isNative } from "./app-db";

function toBase64(buf: ArrayBuffer) {
  let s = "";
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function savePrivateFile(projectId: string, file: File): Promise<string | null> {
  if (!isNative()) return null; // preview keeps only extracted text
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const path = `docs/${projectId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
  await Filesystem.writeFile({ path, data: toBase64(await file.arrayBuffer()), directory: Directory.Data, recursive: true });
  return path;
}

export async function deletePrivateFile(path: string | null) {
  if (!path || !isNative()) return;
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
}

export const isTextFile = (f: File) => f.type.startsWith("text/") || /\.(md|txt|csv|json|xml|html|log|ya?ml)$/i.test(f.name);
