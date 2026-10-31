import { CODE_LIMITS, type CodeResult } from "./engine";
export function runCode(source: string, input = "", signal?: AbortSignal): Promise<CodeResult> {
  if (source.length > CODE_LIMITS.source) return Promise.reject(new Error("Código demasiado grande."));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const stop = () => { clearTimeout(timer); worker.terminate(); signal?.removeEventListener("abort", cancel); };
    const cancel = () => { stop(); reject(new Error("Ejecución cancelada.")); };
    const timer = setTimeout(() => { stop(); resolve({ ok: false, output: "", error: "Tiempo agotado al iniciar o ejecutar el motor." }); }, 10_000);
    worker.onmessage = (e: MessageEvent<CodeResult>) => { stop(); resolve(e.data); };
    worker.onerror = () => { stop(); reject(new Error("El motor aislado no pudo cargarse.")); };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) { cancel(); return; }
    worker.postMessage({ source, input });
  });
}