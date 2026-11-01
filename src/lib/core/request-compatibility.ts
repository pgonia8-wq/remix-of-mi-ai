import type { CapabilitySpec } from "./capabilities";

export type RequestConstraints = {
  files?: { mime: string; size: number }[] | undefined;
  inputMime?: string | null;
  inputBytes?: number;
  prompt?: string | undefined;
  params?: Record<string, unknown> | undefined;
  contextTokens?: number;
};

/** Only enforce declared constraints; unknown model limits are not invented. */
export function requestIssues(spec: CapabilitySpec | null, req: RequestConstraints): string[] {
  const issues: string[] = [];
  if (!spec) return issues;
  const files = req.files ?? (req.inputMime ? [{ mime: req.inputMime, size: req.inputBytes ?? 0 }] : []);
  for (const file of files) {
    const mime = file.mime.split(";")[0]?.trim().toLowerCase() ?? "";
    if (spec.mimeIn.length && !spec.mimeIn.includes(mime)) issues.push(`Formato de entrada no admitido: ${mime || "desconocido"}.`);
    if (!Number.isFinite(file.size) || file.size < 0) issues.push("Tamaño de archivo inválido.");
    else if (spec.maxInputBytes !== null && file.size > spec.maxInputBytes) issues.push(`El archivo supera el límite de ${spec.maxInputBytes} bytes.`);
  }
  if (req.prompt !== undefined && spec.limits["maxChars"] !== undefined && req.prompt.length > spec.limits["maxChars"]) issues.push(`El texto supera el límite de ${spec.limits["maxChars"]} caracteres.`);
  for (const [name, value] of Object.entries(req.params ?? {})) {
    const param = spec.params[name];
    if (!param) continue;
    if (param.type === "enum") {
      if (typeof value !== "string" || !param.values?.includes(value)) issues.push(`Valor no admitido para ${name}.`);
    } else if (param.type === "number") {
      if (typeof value !== "number" || !Number.isFinite(value) || (param.min !== undefined && value < param.min) || (param.max !== undefined && value > param.max)) issues.push(`Valor fuera de límites para ${name}.`);
    } else if (typeof value !== param.type) issues.push(`Tipo de valor incorrecto para ${name}.`);
  }
  return issues;
}

/** Inpainting masks are only sent to adapters whose real API has a mask field (OpenAI/Azure images/edits), for image.edit only. */
export const MASK_ADAPTERS = ["openai", "azure_openai"] as const;
export function maskIssue(capability: string, adapterId: string, files: { name: string; mime: string }[] | undefined): string | null {
  const masks = (files ?? []).filter((f) => f.name === "mask.png");
  if (!masks.length) return null;
  if (masks.length > 1) return "Solo se admite una máscara por edición.";
  if (capability !== "image.edit") return "La máscara solo se admite al editar imágenes.";
  if (!(MASK_ADAPTERS as readonly string[]).includes(adapterId)) return "Este proveedor no acepta máscaras de zona; no se envió nada.";
  if (masks[0]!.mime !== "image/png") return "La máscara debe ser PNG.";
  if ((files ?? []).length < 2) return "Falta la imagen a editar junto a la máscara.";
  return null;
}
