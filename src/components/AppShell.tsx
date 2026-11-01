import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { FolderKanban, MessagesSquare, LayoutGrid, Settings, Images, Boxes, Menu, SquarePen, Search, ChevronDown, PanelLeftClose, Music, Film, Box, Briefcase, ShieldCheck, ArrowUpRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { setActiveProject, useActiveProjectId, useMutate, useRepoQuery } from "@/lib/use-app";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./ui/sheet";
import { toast } from "sonner";

const tabs = [
  { to: "/chats", label: "Conversaciones", icon: MessagesSquare },
  { to: "/", label: "Proyectos", icon: FolderKanban },
  { to: "/library", label: "Biblioteca", icon: Images },
  { to: "/tools", label: "Herramientas", icon: LayoutGrid },
  { to: "/workspace", label: "Espacio profesional", icon: Briefcase },
] as const;
const studios = [{ to: "/music", label: "Música y sonido", icon: Music }, { to: "/video", label: "Video", icon: Film }, { to: "/models3d", label: "Modelos 3D", icon: Box }] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const pid = useActiveProjectId();
  const { data: project } = useRepoQuery(["project", pid], (r) => pid ? r.getProject(pid) : Promise.resolve(null), !!pid);
  const { data: projects = [] } = useRepoQuery(["projects"], (r) => r.listProjects());
  const { data: chats = [] } = useRepoQuery(["chats", pid], (r) => pid ? r.listChats(pid) : Promise.resolve([]), !!pid);
  const [open, setOpen] = useState(false), [collapsed, setCollapsed] = useState(false), [search, setSearch] = useState("");
  const mutate = useMutate(), navigate = useNavigate();
  const inChat = path.startsWith("/chat/");
  async function newChat() {
    if (!pid) { await navigate({ to: "/" }); setOpen(false); return; }
    try { const c = await mutate((r) => r.createChat(pid)); await navigate({ to: "/chat/$chatId", params: { chatId: c.id } }); setOpen(false); }
    catch { toast.error("No se pudo crear la conversación."); }
  }
  const sidebar = <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
    <div className="flex h-16 shrink-0 items-center justify-between px-5"><Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-2.5 font-display text-lg font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm text-primary-foreground">mi</span>MI AI</Link><Button size="icon" variant="ghost" className="hidden lg:inline-flex" aria-label="Ocultar barra lateral" title="Ocultar barra lateral" onClick={() => setCollapsed(true)}><PanelLeftClose className="h-4 w-4" /></Button></div>
    <div className="space-y-3 px-3"><Button variant="outline" className="w-full justify-start gap-3 border-sidebar-border bg-sidebar-accent/40" onClick={newChat}><SquarePen className="h-4 w-4" />Nueva conversación</Button>
      <label className="flex items-center gap-2 rounded-lg bg-sidebar-accent/40 px-3 py-2"><Search className="h-4 w-4 shrink-0 text-muted-foreground" /><input aria-label="Buscar conversaciones" className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Buscar" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-4">
      <nav aria-label="Navegación principal" className="space-y-1">{tabs.map(({ to, label, icon: Icon }) => <Link key={to} to={to} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-sidebar-accent ${path === to ? "bg-sidebar-accent font-medium" : "text-muted-foreground"}`}><Icon className="h-4 w-4" />{label}</Link>)}</nav>
      <p className="px-3 pb-2 pt-6 text-[11px] font-medium uppercase text-muted-foreground">Estudios</p>
      {studios.map(({ to, label, icon: Icon }) => <Link key={to} to={to} onClick={() => setOpen(false)} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent ${path === to ? "bg-sidebar-accent" : "text-muted-foreground"}`}><Icon className="h-4 w-4" />{label}</Link>)}
      <div className="flex items-center justify-between px-3 pb-2 pt-6"><p className="text-[11px] font-medium uppercase text-muted-foreground">Recientes</p><span className="text-xs text-muted-foreground">{chats.length}</span></div>
      {chats.filter((c) => c.title.toLowerCase().includes(search.toLowerCase())).slice(0, 30).map((c) => <Link key={c.id} to="/chat/$chatId" params={{ chatId: c.id }} onClick={() => setOpen(false)} className={`block truncate rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent ${path === `/chat/${c.id}` ? "bg-sidebar-accent" : "text-muted-foreground"}`}>{c.title}</Link>)}
    </div>
    <div className="space-y-1 border-t border-sidebar-border p-3"><Link to="/models" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent"><Boxes className="h-4 w-4" />Modelos</Link><Link to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-sidebar-accent"><Settings className="h-4 w-4" />Configuración</Link><div className="flex items-center gap-2 px-3 pt-3 text-[11px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 text-primary" />Privado · En tu dispositivo</div></div>
  </div>;
  return <div className="flex h-dvh w-full overflow-hidden bg-background">
    {!collapsed && <aside className="hidden w-64 shrink-0 border-r border-sidebar-border lg:block">{sidebar}</aside>}
    <Sheet open={open} onOpenChange={setOpen}><SheetContent side="left" className="w-[min(300px,86vw)] p-0 sm:max-w-[300px]"><SheetTitle className="sr-only">Menú MI AI</SheetTitle><SheetDescription className="sr-only">Proyectos, conversaciones, archivos y configuración</SheetDescription>{sidebar}</SheetContent></Sheet>
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 px-3 sm:px-5">
        <Button variant="ghost" size="icon" aria-label="Abrir menú" title="Abrir menú" className={collapsed ? "" : "lg:hidden"} onClick={() => { if (window.matchMedia("(min-width:1024px)").matches) setCollapsed(false); else setOpen(true); }}><Menu className="h-5 w-5" /></Button>
        <span className="font-display text-lg font-semibold">MI AI</span>
        <div className="relative ml-auto flex max-w-[50%] items-center gap-1"><FolderKanban className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><select aria-label="Proyecto activo" className="min-w-0 appearance-none bg-transparent py-2 pl-1 pr-5 text-xs text-muted-foreground outline-none" value={pid ?? ""} onChange={(e) => { setActiveProject(e.target.value || null); if (inChat) navigate({ to: "/chats" }); }}><option value="">Proyecto</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-muted-foreground" /></div>
        <Button variant="ghost" size="icon" aria-label="Nueva conversación" title="Nueva conversación" onClick={newChat}><SquarePen className="h-4 w-4" /></Button>
      </header>
      <main className={inChat ? "min-h-0 min-w-0 flex-1 overflow-hidden" : "min-h-0 min-w-0 flex-1 overflow-y-auto"}>{inChat ? children : <div className="mx-auto w-full max-w-6xl pb-10 pt-3 sm:px-4">{children}</div>}</main>
    </div>
  </div>;
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
