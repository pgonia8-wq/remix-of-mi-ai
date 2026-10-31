import { Link, useRouterState } from "@tanstack/react-router";
import { FolderKanban, MessagesSquare, Brain, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useActiveProjectId, useRepoQuery } from "@/lib/use-app";

const tabs = [
  { to: "/", label: "Proyectos", icon: FolderKanban },
  { to: "/chats", label: "Chats", icon: MessagesSquare },
  { to: "/memory", label: "Memoria", icon: Brain },
  { to: "/settings", label: "Ajustes", icon: Settings },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const pid = useActiveProjectId();
  const { data: project } = useRepoQuery(["project", pid], (r) => r.getProject(pid!), !!pid);
  const inChat = path.startsWith("/chat/");
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur">
        <span className="font-display text-lg font-bold tracking-tight">
          MI <span className="text-primary">AI</span>
        </span>
        {project && <span className="max-w-[55%] truncate rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">{project.name}</span>}
      </header>
      <main className={`flex-1 ${inChat ? "" : "pb-24"}`}>{children}</main>
      {!inChat && (
        <nav className="fixed inset-x-0 bottom-0 z-10 border-t bg-card/95 backdrop-blur">
          <div className="mx-auto grid max-w-2xl grid-cols-4">
            {tabs.map(({ to, label, icon: Icon }) => {
              const active = to === "/" ? path === "/" : path.startsWith(to);
              return (
                <Link key={to} to={to} className={`flex flex-col items-center gap-1 py-2.5 text-xs ${active ? "text-primary" : "text-muted-foreground"}`}>
                  <Icon className="h-5 w-5" />
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

export function NeedProject() {
  return (
    <div className="p-6 text-center text-sm text-muted-foreground">
      Elige o crea un proyecto primero en{" "}
      <Link to="/" className="text-primary underline">
        Proyectos
      </Link>
      .
    </div>
  );
}

export const inputCls = "w-full rounded-lg border bg-input/30 px-3 py-2 text-sm outline-none focus:border-primary";
export const btnCls = "inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50";
export const btnGhost = "inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm text-foreground disabled:opacity-50";
