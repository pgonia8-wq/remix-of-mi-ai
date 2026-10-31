import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useActiveProjectId, useMutate, useRepoQuery } from "@/lib/use-app";
import { NeedProject, btnCls } from "@/components/AppShell";

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
  if (!pid) return <NeedProject />;
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Chats</h1>
        <button
          className={btnCls}
          onClick={async () => {
            const c = await mutate((r) => r.createChat(pid));
            nav({ to: "/chat/$chatId", params: { chatId: c.id } });
          }}
        >
          <Plus className="h-4 w-4" /> Nuevo
        </button>
      </div>
      <ul className="space-y-2">
        {chats.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-xl border bg-card p-4">
            <Link to="/chat/$chatId" params={{ chatId: c.id }} className="flex-1">
              <div className="font-medium">{c.title}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(c.updated_at).toLocaleString()} {c.model ? `· ${c.model}` : ""}
              </div>
            </Link>
            <button aria-label="Eliminar chat" className="text-muted-foreground" onClick={() => confirm("¿Eliminar chat?") && mutate((r) => r.deleteChat(pid, c.id))}>
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
        {!chats.length && <p className="text-center text-sm text-muted-foreground">Sin chats en este proyecto.</p>}
      </ul>
    </div>
  );
}
