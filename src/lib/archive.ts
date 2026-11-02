// Archives on the phone: 7-Zip compiled to WebAssembly (shipped locally in /7z) creates ZIP/7z/TAR/TAR.GZ and
// extracts ZIP, 7z, RAR, TAR, GZ, BZ2 and XZ. Each operation uses a fresh in-memory instance: nothing touches the
// device file system and archive contents never leave the encrypted project storage.
export const ARCHIVE_LIMITS = { inputBytes: 100 * 1024 * 1024, extractedBytes: 300 * 1024 * 1024, entries: 2000 };
export type ArchiveFormat = "zip" | "7z" | "tar" | "tar.gz";
export type ArchiveEntry = { path: string; data: Uint8Array };

type Mod = {
  FS: { mkdir(p: string): void; writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array; readdir(p: string): string[]; stat(p: string): { mode: number; size: number }; isDir(m: number): boolean; chdir(p: string): void };
  callMain(args: string[]): void;
};

async function instance() {
  const factory = (await import("7z-wasm")).default as unknown as (o: object) => Promise<Mod>;
  let log = "";
  const node = typeof window === "undefined" && typeof process !== "undefined" && !!process.versions?.node;
  const mod = await factory({
    print: (s: string) => { log += `${s}\n`; }, printErr: (s: string) => { log += `${s}\n`; },
    stdin: () => null, // never wait for a password prompt
    locateFile: (f: string) => node ? `${process.cwd()}/node_modules/7z-wasm/${f}` : `/7z/${f}`,
  });
  const run = (args: string[]) => {
    log = "";
    try { mod.callMain(args); } catch (e) { if (!/exit|ExitStatus/i.test(String((e as { name?: string })?.name ?? e))) throw e; }
    return log;
  };
  return { mod, run };
}

function mkdirp(FS: Mod["FS"], dir: string) {
  let cur = "";
  for (const part of dir.split("/").filter(Boolean)) { cur += `/${part}`; try { FS.mkdir(cur); } catch { /* exists */ } }
}
function walk(FS: Mod["FS"], root: string, rel = "", out: ArchiveEntry[] = []) {
  for (const name of FS.readdir(`${root}/${rel}`)) {
    if (name === "." || name === "..") continue;
    const path = rel ? `${rel}/${name}` : name, st = FS.stat(`${root}/${path}`);
    if (FS.isDir(st.mode)) walk(FS, root, path, out); else out.push({ path, data: FS.readFile(`${root}/${path}`) });
  }
  return out;
}
const safeEntry = (p: string) => !!p && !p.startsWith("/") && !/^[a-zA-Z]:/.test(p) && !p.replace(/\\/g, "/").split("/").includes("..");

/** Lists entries and their declared uncompressed size before anything is extracted (zip-bomb and traversal guard). */
export async function listArchive(bytes: Uint8Array, name: string) {
  if (bytes.length > ARCHIVE_LIMITS.inputBytes) throw new Error("Archivo comprimido demasiado grande para el teléfono (máx. 100 MB).");
  const { mod, run } = await instance();
  mkdirp(mod.FS, "/in"); const file = `/in/${name.replace(/[^\w.-]+/g, "_") || "archivo"}`; mod.FS.writeFile(file, bytes);
  const log = run(["l", "-slt", "-p-", file]);
  if (/Wrong password|Can not open encrypted/i.test(log)) throw new Error("El archivo está protegido con contraseña; no se puede abrir sin ella.");
  if (/Can not open the file as archive|Is not archive/i.test(log)) throw new Error("No es un archivo comprimido compatible (ZIP, 7z, RAR, TAR, GZ, BZ2, XZ).");
  const blocks = log.split(/\n\n+/).filter((b) => /^Path = /m.test(b) && /^(Size|Folder) = /m.test(b));
  const items = blocks.map((b) => ({ path: /^Path = (.*)$/m.exec(b)?.[1] ?? "", size: Number(/^Size = (\d+)/m.exec(b)?.[1] ?? 0), dir: /^Folder = \+/m.test(b) }));
  return items.filter((i) => i.path && i.path !== file);
}

export async function extractArchive(bytes: Uint8Array, name: string): Promise<ArchiveEntry[]> {
  const items = await listArchive(bytes, name);
  const files = items.filter((i) => !i.dir);
  if (files.length > ARCHIVE_LIMITS.entries) throw new Error(`Demasiados archivos dentro (${files.length}; máx. ${ARCHIVE_LIMITS.entries}).`);
  const total = files.reduce((a, i) => a + i.size, 0);
  if (total > ARCHIVE_LIMITS.extractedBytes) throw new Error("El contenido descomprimido supera 300 MB; no se extrae en el teléfono.");
  const bad = files.find((i) => !safeEntry(i.path));
  if (bad) throw new Error(`Ruta peligrosa dentro del archivo: ${bad.path}`);
  const { mod, run } = await instance();
  mkdirp(mod.FS, "/in"); mkdirp(mod.FS, "/out");
  const file = `/in/${name.replace(/[^\w.-]+/g, "_") || "archivo"}`; mod.FS.writeFile(file, bytes);
  const log = run(["x", file, "-o/out", "-y", "-p-"]);
  if (/ERROR|Wrong password|Data Error/i.test(log) && !/Everything is Ok/.test(log)) throw new Error(`No se pudo extraer: ${log.split("\n").filter((l) => /ERROR|Error/.test(l)).slice(0, 3).join(" ")}`);
  const out = walk(mod.FS, "/out");
  if (out.reduce((a, e) => a + e.data.length, 0) > ARCHIVE_LIMITS.extractedBytes) throw new Error("El contenido real supera 300 MB.");
  return out;
}

export async function createArchive(entries: ArchiveEntry[], format: ArchiveFormat): Promise<Uint8Array> {
  if (!entries.length) throw new Error("No hay archivos para comprimir.");
  if (entries.length > ARCHIVE_LIMITS.entries) throw new Error("Demasiados archivos.");
  const { mod, run } = await instance();
  mkdirp(mod.FS, "/src"); mkdirp(mod.FS, "/out");
  for (const e of entries) {
    if (!safeEntry(e.path)) throw new Error(`Ruta inválida: ${e.path}`);
    const dir = e.path.split("/").slice(0, -1).join("/"); if (dir) mkdirp(mod.FS, `/src/${dir}`);
    mod.FS.writeFile(`/src/${e.path}`, e.data);
  }
  mod.FS.chdir("/src");
  const type = format === "tar.gz" ? "tar" : format;
  const target = `/out/a.${type}`;
  let log = run(["a", `-t${type}`, target, "*", "-r", ...(type === "zip" ? ["-mx=6"] : [])]);
  if (!/Everything is Ok/.test(log)) throw new Error(`No se pudo crear el archivo: ${log.slice(-300)}`);
  if (format !== "tar.gz") return mod.FS.readFile(target);
  mod.FS.chdir("/out");
  log = run(["a", "-tgzip", "/out/a.tar.gz", "a.tar"]);
  if (!/Everything is Ok/.test(log)) throw new Error("No se pudo comprimir el TAR.");
  return mod.FS.readFile("/out/a.tar.gz");
}

/** Heuristic: valid UTF-8 without NUL bytes is treated as text and goes to the phone workspace. */
export function asText(data: Uint8Array): string | null {
  if (data.length > 400_000 || data.includes(0)) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { return null; }
}
