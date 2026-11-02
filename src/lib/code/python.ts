import type { CodeResult } from "./engine";

/** Generous timeout: the first import of scipy/matplotlib on a 4 GB phone can take tens of seconds. */
export const PYTHON_LIMITS = { source: 120_000, timeoutMs: 180_000, inputFiles: 10, inputBytes: 25 * 1024 * 1024 };
/** Scientific packages shipped offline with the app (loaded on demand when the code imports them). */
export const PYTHON_PACKAGES = ["numpy", "pandas", "matplotlib", "scipy"] as const;

export type PyFile = { name: string; data: Uint8Array };
export type PythonResult = CodeResult & { files?: PyFile[] };

/** Safe single-segment file name for /in and /out (no paths, no hidden names). */
export const pyFileName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/^\.+/, "").trim().slice(0, 120) || "archivo";

/** Runs Python in a dedicated worker with no network/storage; killed on timeout or cancel. Files go to /in, results come from /out. */
export function runPython(source: string, input = "", signal?: AbortSignal, files: PyFile[] = []): Promise<PythonResult> {
  if (source.length > PYTHON_LIMITS.source) return Promise.reject(new Error("Código Python demasiado grande."));
  if (files.length > PYTHON_LIMITS.inputFiles || files.reduce((n, f) => n + f.data.length, 0) > PYTHON_LIMITS.inputBytes) return Promise.reject(new Error("Demasiados archivos de entrada para Python (máx. 10 y 25 MB)."));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./python-worker.ts", import.meta.url), { type: "module" });
    const stop = () => { clearTimeout(timer); worker.terminate(); signal?.removeEventListener("abort", cancel); };
    const cancel = () => { stop(); reject(new Error("Ejecución cancelada.")); };
    const timer = setTimeout(() => { stop(); resolve({ ok: false, output: "", error: "Tiempo agotado (180 s) al cargar o ejecutar Python." }); }, PYTHON_LIMITS.timeoutMs);
    worker.onmessage = (e: MessageEvent<PythonResult>) => { stop(); resolve(e.data); };
    worker.onerror = () => { stop(); reject(new Error("El motor de Python no pudo cargarse.")); };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    worker.postMessage({ source, input, files: files.map((f) => ({ name: pyFileName(f.name), data: f.data })) });
  });
}

/** TypeScript → JavaScript (types stripped, no module loading), then executed in the QuickJS sandbox. */
export async function transpileTs(source: string) {
  const { transform } = await import("sucrase");
  return transform(source, { transforms: ["typescript"], disableESTransforms: true }).code;
}
