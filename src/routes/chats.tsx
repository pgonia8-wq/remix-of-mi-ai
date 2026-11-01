import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, Trash2, MessagesSquare, Search, ArrowUpRight } from "lucide-react";
import { useActiveProjectId, useMutate, useRepoQuery } from "@/lib/use-app";
import { NeedProject, btnCls } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export const Route = createFileRoute("/chats")({
  head: () => ({
    meta: [
      { title: "Chats — MI AI" },
      { name: "description", content: "Conversaciones del proyecto activo con cualquier proveedor de IA." },
      { property: "og:title", content: "Chats — MI AI" },
      { property: "og:description", content: "Conversaciones del proyecto activo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Chats,
});

function Chats() {
  const pid = useActiveProjectId();
  const { data: chats = [] } = useRepoQuery(["chats", pid], (r) => r.listChats(pid!), !!pid);
  const mutate = useMutate();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  if (!pid) return <NeedProject />;
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Conversaciones</h1>
        <Button
          onClick={async () => {
            const c = await mutate((r) => r.createChat(pid));
            nav({ to: "/chat/$chatId", params: { chatId: c.id } });
          }}
        >
          <Plus className="h-4 w-4" /> Nuevo
        </Button>
      </div>
      <label className="flex items-center gap-3 border-b pb-3"><Search className="h-4 w-4 text-muted-foreground" /><input className="w-full bg-transparent text-sm outline-none" aria-label="Buscar chats" placeholder="Buscar conversaciones" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <ul>
        {chats.filter((c) => c.title.toLowerCase().includes(q.toLowerCase())).map((c) => (
          <li key={c.id} className="group flex items-center gap-4 border-b border-border/70 px-2 py-5">
            <MessagesSquare className="h-5 w-5 shrink-0 text-muted-foreground" /><Link to="/chat/$chatId" params={{ chatId: c.id }} className="min-w-0 flex-1 space-y-1">
              <div className="font-medium">{c.title}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(c.updated_at).toLocaleString()} {c.model ? `· ${c.model}` : ""}
              </div>
            </Link>
            <Button variant="ghost" size="icon" aria-label="Eliminar chat" title="Eliminar conversación" className="text-muted-foreground" onClick={() => confirm("¿Eliminar chat?") && mutate((r) => r.deleteChat(pid, c.id))}><Trash2 className="h-4 w-4" /></Button>
          </li>
        ))}
        {!chats.length && <p className="text-center text-sm text-muted-foreground">Sin chats en este proyecto.</p>}
      </ul>
    </div>
  );
}
