import { evaluateCode } from "./engine";
self.onmessage = async (e: MessageEvent<{ source: string; input: string }>) => {
  try { self.postMessage(await evaluateCode(e.data.source, e.data.input)); }
  catch { self.postMessage({ ok: false, output: "", error: "No se pudo iniciar la ejecución aislada." }); }
};