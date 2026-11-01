// Cost estimation and budget gating for every billed provider call. Providers rarely report prices, so costs come
// from the user's local price table ("estimated") or are recorded as "unpriced" (amount 0, flagged) when no tariff exists.
import type { Repo, ModelPrice } from "../db/repo";

export type Usage = { inputChars?: number; outputChars?: number; images?: number; seconds?: number };
export class BudgetError extends Error { constructor(msg: string) { super(msg); this.name = "BudgetError"; } }

/** ~4 characters per token is a conservative approximation; always labeled as an estimate. */
export function estimateCost(price: ModelPrice | null, u: Usage): { amountUsd: number; pricing: "estimated" | "unpriced" } {
  if (!price) return { amountUsd: 0, pricing: "unpriced" };
  const tok = (c?: number) => (c ?? 0) / 4 / 1_000_000;
  const parts = [
    price.input_per_mtok !== null ? tok(u.inputChars) * price.input_per_mtok : null,
    price.output_per_mtok !== null ? tok(u.outputChars) * price.output_per_mtok : null,
    price.per_image !== null && u.images ? u.images * price.per_image : null,
    price.per_second !== null && u.seconds ? u.seconds * price.per_second : null,
    price.per_call,
  ].filter((v): v is number => v !== null);
  if (!parts.length) return { amountUsd: 0, pricing: "unpriced" };
  return { amountUsd: Math.round(parts.reduce((a, b) => a + b, 0) * 1e6) / 1e6, pricing: "estimated" };
}

type Hooks = { confirmOverBudget?: (info: { spentUsd: number; limitUsd: number }) => Promise<boolean> | boolean; warn?: (info: { spentUsd: number; limitUsd: number }) => void };
let hooks: Hooks = {};
/** The UI registers how to ask the user; without a hook, a blocked call is refused. */
export function setBudgetHooks(h: Hooks) { hooks = h; }

/** Runs BEFORE any credential access or network request. Confirmation applies to this single call only. */
export async function budgetGate(repo: Repo, projectId: string, model: string, expected: Usage) {
  const est = estimateCost(await repo.getModelPrice(model), expected);
  const s = await repo.budgetStatus(projectId, est.amountUsd);
  if (s.level === "warn") hooks.warn?.({ spentUsd: s.spentUsd, limitUsd: s.limitUsd! });
  if (s.level === "blocked") {
    const ok = hooks.confirmOverBudget ? await hooks.confirmOverBudget({ spentUsd: s.spentUsd, limitUsd: s.limitUsd! }) : false;
    if (!ok) throw new BudgetError(`Presupuesto mensual del proyecto alcanzado (US$ ${s.spentUsd.toFixed(2)} de ${s.limitUsd!.toFixed(2)}). No se envió ninguna solicitud.`);
  }
}

export async function recordUsage(repo: Repo, projectId: string, c: { providerId?: string | null; model: string; operation: string; usage: Usage }) {
  const est = estimateCost(await repo.getModelPrice(c.model), c.usage);
  await repo.recordCost(projectId, { providerId: c.providerId ?? null, model: c.model, operation: c.operation, amountUsd: est.amountUsd, estimated: est.pricing === "unpriced" ? "unpriced" : true });
}

export function usageFor(capability: string, prompt: string | undefined, params: Record<string, unknown> | undefined, out?: { text?: string | undefined; files?: number | undefined }): Usage {
  const n = Number(params?.["n"] ?? 1) || 1;
  if (capability.startsWith("image")) return { inputChars: prompt?.length ?? 0, images: out?.files ?? n };
  if (capability.startsWith("video") || capability.startsWith("music") || capability === "audio.music") return { inputChars: prompt?.length ?? 0, seconds: Number(params?.["seconds"] ?? 0) || 0 };
  return { inputChars: (prompt?.length ?? 0) + JSON.stringify(params?.["inputs"] ?? "").length, outputChars: out?.text?.length ?? 0 };
}
