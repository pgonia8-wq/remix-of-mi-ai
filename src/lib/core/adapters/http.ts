import { ProviderError, responseError } from "../../providers";

/** fetch wrapper: classifies HTTP failures with the shared diagnostics; never includes the key in messages. */
export async function call(url: string, init: RequestInit, apiKey: string | null, timeoutMs = 120_000): Promise<Response> {
  const ctl = new AbortController();
  const outer = init.signal;
  const abort = () => ctl.abort();
  if (outer?.aborted) ctl.abort();
  else outer?.addEventListener("abort", abort, { once: true });
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let res: Response;
  try { res = await fetch(url, { redirect: "error", credentials: "omit", ...init, signal: ctl.signal }); }
  catch {
    // No HTTP response: the request may or may not have reached the provider.
    throw new ProviderError(ctl.signal.aborted ? "timeout" : "network", ctl.signal.aborted ? "Error de red o timeout: el proveedor no respondió a tiempo." : "Error de red: no se pudo alcanzar el endpoint (Internet, DNS, TLS o CORS).");
  } finally { clearTimeout(t); outer?.removeEventListener("abort", abort); }
  if (!res.ok) throw responseError(res.status, await res.text().catch(() => ""), apiKey);
  return res;
}

export function requireKey(k: string | null): string {
  if (!k?.trim()) throw new ProviderError("key", "API Key inválida: falta la credencial.");
  return k;
}
