// Python sandbox worker: Pyodide (CPython on WebAssembly) shipped in /pyodide. After loading, network, storage
// and script-loading globals are removed, so Python code (including `import js`) cannot reach the network,
// the app database or credentials. The parent terminates this worker on timeout.
type Req = { source: string; input: string };
const MAX_OUT = 60_000;

self.onmessage = async (e: MessageEvent<Req>) => {
  let out = "";
  const write = (s: string) => { if (out.length < MAX_OUT) out += `${s}\n`; };
  try {
    const url = new URL("/pyodide/pyodide.mjs", self.location.origin).href;
    const { loadPyodide } = await import(/* @vite-ignore */ url) as { loadPyodide: (o: object) => Promise<{ runPythonAsync(s: string): Promise<unknown>; setStdin(o: object): void }> };
    const py = await loadPyodide({ indexURL: new URL("/pyodide/", self.location.origin).href, stdout: write, stderr: write, fullStdLib: false });
    const g = self as unknown as Record<string, unknown>;
    for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "indexedDB", "caches", "importScripts", "BroadcastChannel", "Worker", "SharedWorker", "navigator"]) {
      try { delete g[k]; } catch { /* non-configurable */ }
      try { Object.defineProperty(self, k, { value: undefined, configurable: false, writable: false }); } catch { /* ignore */ }
    }
    const lines = e.data.input.split("\n"); let i = 0;
    py.setStdin({ stdin: () => (i < lines.length ? lines[i++] : null) });
    const result = await py.runPythonAsync(e.data.source);
    if (result !== undefined && result !== null && String(result) !== "None") write(String(result));
    postMessage({ ok: true, output: out.slice(0, MAX_OUT) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    postMessage({ ok: false, output: out.slice(0, MAX_OUT), error: msg.split("\n").slice(-12).join("\n").slice(0, 4000) });
  }
};
