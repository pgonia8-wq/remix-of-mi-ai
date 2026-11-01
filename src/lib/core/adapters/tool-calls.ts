// Native tool calling (OpenAI/Azure chat-completions contract). Used only for models whose verified
// registration declares "chat.tools". The prompt carries {messages, tools}; the result is normalized JSON
// {content?, tool_calls?:[{name, arguments}]} and still passes through the universal Tool Manager.
import { ProviderError } from "../../providers";
import type { RunRequest } from "./types";

export function toolCallBody(r: RunRequest, withModel: boolean) {
  let env: { messages?: unknown; tools?: unknown };
  try { env = JSON.parse(r.prompt ?? "{}"); } catch { throw new ProviderError("parameters", "Solicitud de herramientas inválida."); }
  if (!Array.isArray(env.messages) || !Array.isArray(env.tools)) throw new ProviderError("parameters", "Solicitud de herramientas inválida.");
  return { ...(withModel ? { model: r.model } : {}), messages: env.messages, tools: env.tools, tool_choice: "auto", parallel_tool_calls: false };
}
export function parseToolCalls(data: any) {
  const msg = data?.choices?.[0]?.message;
  if (!msg) throw new ProviderError("parameters", "Respuesta inválida: sin mensaje.", 200);
  const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter((c: any) => c?.type === "function" && typeof c.function?.name === "string").map((c: any) => ({ name: String(c.function.name), arguments: String(c.function.arguments ?? "{}") })) : [];
  if (!calls.length && typeof msg.content !== "string") throw new ProviderError("parameters", "Respuesta inválida: ni texto ni herramientas.", 200);
  return JSON.stringify({ content: typeof msg.content === "string" ? msg.content : "", tool_calls: calls });
}
