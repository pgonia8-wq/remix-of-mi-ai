import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Send, Square } from "lucide-react";
import { toast } from "sonner";
import { getRepo } from "@/lib/app-db";
import { streamChat, ProviderError, type ChatMsg } from "@/lib/providers";
import { useActiveProjectId, useMutate, useRepoQuery } from "@/lib/use-app";
import { NeedProject, inputCls } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/chat/$chatId")({
  head: () => ({
    meta: [
      { title: "Conversación — MI AI" },
      { name: "description", content: "Chat con streaming y cambio de modelo sin perder el historial." },
      { property: "og:title", content: "Conversación — MI AI" },
      { property: "og:description", content: "Chat con streaming y cambio de modelo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ChatPage,
});

function ChatPage() {
  const { chatId } = Route.useParams();
  const pid = useActiveProjectId();
  const mutate = useMutate();
  const { data: chat, error: chatError, isLoading } = useRepoQuery(["chat", pid, chatId], (r) => pid ? r.getChat(pid, chatId) : Promise.resolve(null), !!pid);
  const { data: messages = [], error: messagesError, refetch } = useRepoQuery(["messages", pid, chatId], (r) => pid ? r.listMessages(pid, chatId) : Promise.resolve([]), !!pid);
  const { data: providers = [] } = useRepoQuery(["providers"], (r) => r.listProviders());
  const enabled = providers.filter((p) => p.enabled);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView?.(), [messages.length, streaming]);

  if (!pid) return <NeedProject />;
  if (chatError || messagesError) return <div role="alert" className="space-y-3 p-4"><p>No se pudieron recuperar los datos del chat.</p><Button variant="outline" onClick={() => mutate(async () => undefined).catch(() => toast.error("No se pudo abrir el almacenamiento local."))}>Reintentar</Button></div>;
  if (isLoading) return <p role="status" className="p-4 text-sm text-muted-foreground">Abriendo chat…</p>;
  if (chat === null) return <div className="p-6 text-sm text-muted-foreground">Este chat no pertenece al proyecto activo.</div>;
  const providerId = chat?.provider_id ?? enabled[0]?.id ?? null;
  const provider = providers.find((p) => p.id === providerId);

  async function send() {
    const text = input.trim();
    if (!text || !provider || !pid) return;
    setInput("");
    const repo = await getRepo();
    await repo.addMessage(pid, chatId, "user", text);
    if (!messages.length) await repo.updateChat(pid, chatId, { title: text.slice(0, 48) });
    await refetch();
    const history = await repo.listMessages(pid, chatId);
    const ctx = await repo.buildContext(pid, text);
    const msgs: ChatMsg[] = [
      { role: "system", content: `Eres MI AI, un asistente privado. Usa este contexto del proyecto:\n\n${ctx}` },
      ...history.map((m) => ({ role: m.role, content: m.content })),
    ];
    abort.current = new AbortController();
    let out = "";
    setStreaming("");
    try {
      const apiKey = await repo.getProviderSecret(provider.id);
      await streamChat(
        { kind: provider.kind, endpoint: provider.endpoint, apiKey, model: provider.model, deployment: provider.deployment, apiVersion: provider.api_version, extraParams: provider.extra_params },
        msgs,
        (t) => setStreaming((out += t)),
        abort.current.signal,
      );
      if (!out.trim()) throw new ProviderError("parameters", "El modelo no devolvió una respuesta válida.");
      await repo.setProviderVerification(provider.id, "verified");
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        await repo.setProviderVerification(provider.id, "error");
        toast.error(e instanceof ProviderError ? e.message : "Error de red: no se pudo completar la respuesta del modelo.");
      }
    } finally {
      if (out) await repo.addMessage(pid, chatId, "assistant", out, provider.id, provider.model);
      setStreaming(null);
      await mutate(async () => undefined);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-57px)] flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Link to="/chats" aria-label="Volver" className="p-1 text-muted-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="flex-1 truncate text-sm font-medium">{chat?.title}</span>
        <select
          className="max-w-[45%] rounded-lg border bg-card px-2 py-1 text-xs"
          value={providerId ?? ""}
          onChange={(e) => {
            const p = providers.find((x) => x.id === e.target.value);
            mutate((r) => r.updateChat(pid, chatId, { provider_id: p?.id ?? null, model: p?.model ?? null }));
          }}
        >
          {!enabled.length && <option value="">Sin proveedores</option>}
          {enabled.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.model}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ml-auto max-w-[85%] rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground" : "max-w-[95%] text-sm"}>
            <div className="whitespace-pre-wrap">{m.content}</div>
            {m.role === "assistant" && m.model && <div className="mt-1 text-[10px] text-muted-foreground">{m.model}</div>}
          </div>
        ))}
        {streaming !== null && <div className="max-w-[95%] whitespace-pre-wrap text-sm">{streaming || "…"}</div>}
        {!enabled.length && (
          <p className="text-center text-sm text-muted-foreground">
            Añade un proveedor en{" "}
            <Link to="/settings" className="text-primary underline">
              Ajustes
            </Link>
            .
          </p>
        )}
        <div ref={end} />
      </div>
      <div className="flex gap-2 border-t p-3">
        <textarea rows={1} className={inputCls + " resize-none"} placeholder="Escribe un mensaje…" value={input} onChange={(e) => setInput(e.target.value)} />
        {streaming !== null ? (
          <button aria-label="Detener" className="rounded-lg border px-3" onClick={() => abort.current?.abort()}>
            <Square className="h-4 w-4" />
          </button>
        ) : (
          <button aria-label="Enviar" className="rounded-lg bg-primary px-3 text-primary-foreground disabled:opacity-50" disabled={!input.trim() || !provider} onClick={send}>
            <Send className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
