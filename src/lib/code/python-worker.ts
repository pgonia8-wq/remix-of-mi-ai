// Python sandbox worker: Pyodide (CPython on WebAssembly) shipped in /pyodide, plus the scientific wheels
// (numpy, pandas, matplotlib, scipy and dependencies) shipped in the same folder. Packages the code imports are
// loaded from the app's own files BEFORE network, storage and script-loading globals are removed, so Python code
// (including `import js`) cannot reach the network, the app database or credentials. Input files are copied into
// /in and files written to /out are returned (bounded). The parent terminates this worker on timeout.
type Req = { source: string; input: string; files?: { name: string; data: Uint8Array }[] };
type Py = {
  runPythonAsync(s: string): Promise<unknown>; setStdin(o: object): void; loadPackagesFromImports(s: string, o?: object): Promise<unknown>;
  FS: { mkdirTree(p: string): void; writeFile(p: string, d: Uint8Array): void; readdir(p: string): string[]; stat(p: string): { mode: number; size: number }; isFile(m: number): boolean; readFile(p: string): Uint8Array };
};
const MAX_OUT = 60_000;
const MAX_FILES = 10;
const MAX_FILE_BYTES = 15 * 1024 * 1024;

self.onmessage = async (e: MessageEvent<Req>) => {
  let out = "";
  const write = (s: string) => { if (out.length < MAX_OUT) out += `${s}\n`; };
  try {
    const url = new URL("/pyodide/pyodide.mjs", self.location.origin).href;
    const { loadPyodide } = await import(/* @vite-ignore */ url) as { loadPyodide: (o: object) => Promise<Py> };
    const py = await loadPyodide({ indexURL: new URL("/pyodide/", self.location.origin).href, stdout: write, stderr: write, fullStdLib: false, env: { MPLBACKEND: "Agg", HOME: "/home/pyodide" } });
    await py.loadPackagesFromImports(e.data.source, { messageCallback: () => {} });
    const g = self as unknown as Record<string, unknown>;
    for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "indexedDB", "caches", "importScripts", "BroadcastChannel", "Worker", "SharedWorker", "navigator"]) {
      try { delete g[k]; } catch { /* non-configurable */ }
      try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch { /* ignore */ }
    }
    py.FS.mkdirTree("/in"); py.FS.mkdirTree("/out");
    for (const f of e.data.files ?? []) py.FS.writeFile(`/in/${f.name}`, f.data);
    const lines = e.data.input.split("\n"); let i = 0;
    py.setStdin({ stdin: () => (i < lines.length ? lines[i++] : null) });
    const result = await py.runPythonAsync(e.data.source);
    if (result !== undefined && result !== null && String(result) !== "None") write(String(result));
    const files: { name: string; data: Uint8Array }[] = [];
    let total = 0;
    for (const name of py.FS.readdir("/out")) {
      if (name === "." || name === ".." || files.length >= MAX_FILES) continue;
      const st = py.FS.stat(`/out/${name}`);
      if (!py.FS.isFile(st.mode) || total + st.size > MAX_FILE_BYTES) { write(`(archivo omitido: ${name})`); continue; }
      total += st.size; files.push({ name, data: py.FS.readFile(`/out/${name}`) });
    }
    postMessage({ ok: true, output: out.slice(0, MAX_OUT), files });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    postMessage({ ok: false, output: out.slice(0, MAX_OUT), error: msg.split("\n").slice(-12).join("\n").slice(0, 4000) });
  }
};
