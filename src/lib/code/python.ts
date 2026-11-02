import type { CodeResult } from "./engine";

export const PYTHON_LIMITS = { source: 120_000, timeoutMs: 90_000 };

/** Runs Python in a dedicated worker with no network/storage; killed on timeout or cancel. Standard library only. */
export function runPython(source: string, input = "", signal?: AbortSignal): Promise<CodeResult> {
  if (source.length > PYTHON_LIMITS.source) return Promise.reject(new Error("Código Python demasiado grande."));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./python-worker.ts", import.meta.url), { type: "module" });
    const stop = () => { clearTimeout(timer); worker.terminate(); signal?.removeEventListener("abort", cancel); };
    const cancel = () => { stop(); reject(new Error("Ejecución cancelada.")); };
    const timer = setTimeout(() => { stop(); resolve({ ok: false, output: "", error: "Tiempo agotado (90 s) al cargar o ejecutar Python." }); }, PYTHON_LIMITS.timeoutMs);
    worker.onmessage = (e: MessageEvent<CodeResult>) => { stop(); resolve(e.data); };
    worker.onerror = () => { stop(); reject(new Error("El motor de Python no pudo cargarse.")); };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    worker.postMessage({ source, input });
  });
}

/** TypeScript → JavaScript (types stripped, no module loading), then executed in the QuickJS sandbox. */
export async function transpileTs(source: string) {
  const { transform } = await import("sucrase");
  return transform(source, { transforms: ["typescript"], disableESTransforms: true }).code;
}
