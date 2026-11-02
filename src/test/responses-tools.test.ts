// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildResponsesRequest, streamChat, type ChatMsg } from "@/lib/providers";

const sse = (events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
const tools = [{ type: "function", function: { name: "datetime__now", description: "Fecha", parameters: { type: "object", properties: { tz: { type: "string" } }, required: [], additionalProperties: false } } }];
const msgs: ChatMsg[] = [{ role: "system", content: "s" }, { role: "user", content: "hora" }];
const callEvents = [
  { type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc1", call_id: "call_A", name: "datetime__now", arguments: "" } },
  { type: "response.function_call_arguments.delta", item_id: "fc1", delta: "{}" },
  { type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc1", call_id: "call_A", name: "datetime__now", arguments: "{}" } },
  { type: "response.completed", response: {} },
];

afterEach(() => vi.restoreAllMocks());

describe("herramientas en modelos que solo las aceptan por Responses", () => {
  test("un rechazo de herramientas en chat/completions reintenta por /responses y devuelve la llamada", async () => {
    const p = { kind: "azure_openai" as const, endpoint: "https://r1.openai.azure.com/openai/v1", apiKey: "k", model: "gpt-6.1", deployment: "gpt-6-1-sol" };
    const urls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (u) => {
      urls.push(String(u));
      if (String(u).endsWith("/chat/completions")) return new Response(JSON.stringify({ error: { message: "gpt-6.1 does not support function tools on /v1/chat/completions; send tool requests to /v1/responses" } }), { status: 400 });
      return sse(callEvents);
    });
    const r = await streamChat(p, msgs, () => undefined, undefined, { tools });
    expect(r.toolCalls).toEqual([{ id: "call_A", name: "datetime__now", arguments: "{}" }]);
    expect(urls).toEqual(["https://r1.openai.azure.com/openai/v1/chat/completions", "https://r1.openai.azure.com/openai/v1/responses"]);
    // Next turn for the same deployment goes straight to /responses.
    urls.length = 0;
    await streamChat(p, msgs, () => undefined, undefined, { tools });
    expect(urls).toEqual(["https://r1.openai.azure.com/openai/v1/responses"]);
  });

  test("el historial de herramientas se envía como function_call / function_call_output y las herramientas no son estrictas", () => {
    const p = { kind: "openai" as const, endpoint: "https://api.openai.com/v1", apiKey: "k", model: "gpt-6" };
    const history: ChatMsg[] = [...msgs, { role: "assistant", content: "", tool_calls: [{ id: "call_A", name: "datetime__now", arguments: "{}" }] }, { role: "tool", tool_call_id: "call_A", content: "23:30" }];
    const { url, init } = buildResponsesRequest(p, history, tools);
    const body = JSON.parse(String(init.body));
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body.store).toBe(false);
    expect(body.input.slice(2)).toEqual([{ type: "function_call", call_id: "call_A", name: "datetime__now", arguments: "{}" }, { type: "function_call_output", call_id: "call_A", output: "23:30" }]);
    expect(body.tools[0]).toMatchObject({ type: "function", name: "datetime__now", strict: false });
  });

  test("Azure con URL clásica usa /openai/responses con versión preview compatible", () => {
    const p = { kind: "azure_openai" as const, endpoint: "https://r1.openai.azure.com", apiKey: "k", model: "x", deployment: "dep", apiVersion: "2024-10-21" };
    expect(buildResponsesRequest(p, msgs, tools).url).toBe("https://r1.openai.azure.com/openai/responses?api-version=2025-04-01-preview");
  });

  test("otros errores 400 no cambian de vía", async () => {
    const p = { kind: "openai" as const, endpoint: "https://api.openai.com/v1", apiKey: "k", model: "gpt-x-other" };
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: { message: "max_tokens too large" } }), { status: 400 }));
    await expect(streamChat(p, msgs, () => undefined, undefined, { tools })).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("DeepSeek/Kimi: el razonamiento se captura y se reenvía con las herramientas; a OpenAI nunca se le envía", async () => {
    const bodies: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)));
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "pienso" } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "datetime__now", arguments: "{}" } }] } }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
    });
    const ds = { kind: "deepseek" as const, endpoint: "https://api.deepseek.com/v1", apiKey: "k", model: "deepseek-flash" };
    const r = await streamChat(ds, msgs, () => undefined, undefined, { tools });
    expect(r.reasoning).toBe("pienso");
    const history: ChatMsg[] = [...msgs, { role: "assistant", content: "", tool_calls: r.toolCalls, reasoning_content: r.reasoning! }, { role: "tool", tool_call_id: "c1", content: "23:30" }];
    await streamChat(ds, history, () => undefined, undefined, { tools });
    expect(bodies[1].messages[2]).toMatchObject({ role: "assistant", reasoning_content: "pienso", tool_calls: [{ id: "c1" }] });
    await streamChat({ kind: "openai", endpoint: "https://api.openai.com/v1", apiKey: "k", model: "gpt-4o" }, history, () => undefined, undefined, { tools });
    expect(bodies[2].messages[2].reasoning_content).toBeUndefined();
  });
});
