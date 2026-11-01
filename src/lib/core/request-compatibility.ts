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