import { ProviderError } from "../../providers";
import { call, requireKey } from "./http";
import { downloadMedia } from "./media-output";
import { type ProviderAdapter } from "./types";

const base = "https://api.meshy.ai/openapi";
const paths: Record<string, string> = { text: "/v2/text-to-3d", image: "/v1/image-to-3d" };
function parseRemote(remote: string) {
  const [kind, id] = remote.split(":"); const path = kind ? paths[kind] : undefined;
  if (!path || !id || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new ProviderError("parameters", "Identificador remoto inválido.");
  return `${base}${path}/${encodeURIComponent(id)}`;
}
export const meshyAdapter: ProviderAdapter = {
  id: "meshy", label: "Meshy",
  operations: { "model3d.generate": { async: true, poll: true, recover: true, cancel: false, idempotencyHeader: null } },
  supports(cap) { return cap in this.operations; },
  async run(c, r) {
    if (r.capability !== "model3d.generate") throw new ProviderError("parameters", "Operación no implementada por Meshy.");
    const key = requireKey(c.apiKey), file = r.files?.[0];
    const kind = file ? "image" : "text";
    let body: Record<string, unknown>;
    if (file) {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.mime) || file.bytes.length > 20_000_000) throw new ProviderError("parameters", "Meshy requiere una imagen PNG, JPEG o WebP de hasta 20 MB.");
      let binary = ""; for (let i = 0; i < file.bytes.length; i += 0x8000) binary += String.fromCharCode(...file.bytes.subarray(i, i + 0x8000));
      body = { image_url: `data:${file.mime};base64,${btoa(binary)}`, ai_model: r.model, target_formats: ["glb"] };
    } else {
      const prompt = r.prompt?.trim();
      if (!prompt || prompt.length > 800) throw new ProviderError("parameters", "Describe el objeto en 1–800 caracteres.");
      body = { mode: "preview", prompt, ai_model: r.model, target_formats: ["glb"] };
    }
    const data = await (await call(`${base}${paths[kind]}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: r.signal ?? null }, key)).json();
    if (typeof data?.result !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(data.result)) throw new ProviderError("parameters", "Meshy no confirmó el identificador del trabajo.");
    return { kind: "remote", remoteId: `${kind}:${data.result}` };
  },
  async poll(c, remote) {
    const key = requireKey(c.apiKey);
    const data = await (await call(parseRemote(remote), { headers: { authorization: `Bearer ${key}` } }, key, 30_000)).json();
    if (["PENDING", "IN_PROGRESS"].includes(data?.status)) return { kind: "pending", progress: Math.max(0, Math.min(1, Number(data.progress ?? 0) / 100)) };
    if (data?.status !== "SUCCEEDED") throw new ProviderError("parameters", "Meshy no completó el trabajo; revisa su estado en el proveedor.");
    if (typeof data?.model_urls?.glb !== "string") throw new ProviderError("parameters", "Meshy no devolvió un modelo GLB.");
    return { kind: "files", files: [{ bytes: await downloadMedia(data.model_urls.glb, "model/gltf-binary", 50 * 1024 * 1024), mime: "model/gltf-binary", name: "modelo.glb" }] };
  },
};