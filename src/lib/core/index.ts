// Wires the universal core to the platform: native Android (Keystore plugin + private files) or preview.
import { registerPlugin } from "@capacitor/core";
import { getRepo, isNative } from "../app-db";
import { JobManager } from "./jobs";
import { AssetStore, sqlBlobBackend, type BlobBackend } from "./asset-store";
import { KeyRing, nativeBackend, webBackend, type MasterKeyBackend } from "./keys";
import { chooseProfile, detectDevice, type DeviceFacts, type PerfProfile } from "./device-profile";
import type { ByteSource } from "./asset-crypto";
import { runs } from "../automation/store";
import { syncNativeSchedules } from "../automation/native-schedules";
import { getAdapter } from "./adapters";

type KeystorePlugin = Parameters<typeof nativeBackend>[0] & { deviceInfo(): Promise<Partial<DeviceFacts>> };
export const MiaiKeystore = registerPlugin<KeystorePlugin>("MiaiKeystore");

/** Native private-file backend: Directory.Data, append-only writes, ranged reads (no full-file load). */
function nativeFiles(): BlobBackend {
  const fsP = import("@capacitor/filesystem");
  const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  return {
    async create(path) { const { Filesystem, Directory } = await fsP; await Filesystem.writeFile({ path, data: "", directory: Directory.Data, recursive: true }); },
    async append(path, bytes) { const { Filesystem, Directory } = await fsP; await Filesystem.appendFile({ path, data: b64(bytes), directory: Directory.Data }); },
    async rename(from, to) { const { Filesystem, Directory } = await fsP; await Filesystem.rename({ from, to, directory: Directory.Data, toDirectory: Directory.Data }); },
    async remove(path) { const { Filesystem, Directory } = await fsP; await Filesystem.deleteFile({ path, directory: Directory.Data }); },
    async list(prefix) {
      const { Filesystem, Directory } = await fsP;
      const out: string[] = [];
      const walk = async (dir: string) => {
        const r = await Filesystem.readdir({ path: dir, directory: Directory.Data }).catch(() => ({ files: [] as { name: string; type: string }[] }));
        for (const f of r.files) { const p = `${dir.replace(/\/$/, "")}/${f.name}`; if (f.type === "directory") await walk(p); else out.push(p); }
      };
      await walk(prefix.replace(/\/$/, ""));
      return out;
    },
    async source(path): Promise<ByteSource> {
      const { Filesystem, Directory } = await fsP;
      const { Capacitor } = await import("@capacitor/core");
      const st = await Filesystem.stat({ path, directory: Directory.Data });
      const url = Capacitor.convertFileSrc(st.uri);
      return {
        size: Number(st.size),
        async read(offset, length) {
          if (length === 0) return new Uint8Array(0);
          const r = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
          const buf = new Uint8Array(await r.arrayBuffer());
          // Some WebView servers ignore Range: slice the full response as a fallback.
          return r.status === 206 ? buf : buf.subarray(offset, offset + length);
        },
      };
    },
  };
}

export type Core = { repo: Awaited<ReturnType<typeof getRepo>>; jobs: JobManager; assets: AssetStore; keys: KeyRing; files: BlobBackend; device: DeviceFacts; profile: PerfProfile; startup: { temps: number; orphans: number; requeued: number; interrupted: number; needsUser: number } };

let coreP: Promise<Core> | null = null;
export function getCore(): Promise<Core> {
  if (!coreP) {
    coreP = (async () => {
      const repo = await getRepo();
      const db = repo.sql;
      const native = isNative();
      let backend: MasterKeyBackend;
      if (native) backend = nativeBackend(MiaiKeystore);
      else backend = webBackend({ get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v), del: (k) => localStorage.removeItem(k) });
      const keys = new KeyRing(db, backend);
      await keys.current();
      const device = await detectDevice(native ? () => MiaiKeystore.deviceInfo() : undefined);
      let profile = chooseProfile(device);
      const files = native ? nativeFiles() : sqlBlobBackend(db);
      const assets = new AssetStore(db, files, keys, () => profile);
      const jobs = new JobManager(db);
      const clean = await assets.cleanup().catch(() => ({ temps: 0, orphans: 0 }));
      const providerAdapters = await repo.registry.listProviders();
      const rec = await jobs.recoverOnStart((j) => {
        const p = providerAdapters.find((p) => p.id === j.provider_id);
        return !!p && !!getAdapter(p.adapter).poll;
      });
      await runs.recover(repo);
      await syncNativeSchedules(repo);
      const core: Core = { repo, jobs, assets, keys, files, device, profile, startup: { ...clean, ...rec } };
      Object.defineProperty(core, "profile", { get: () => profile, set: (p: PerfProfile) => { profile = p; } });
      return core;
    })();
    coreP.catch(() => (coreP = null));
  }
  return coreP;
}
