import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Inbox, Images, MessageSquarePlus, FolderInput } from "lucide-react";
import { importProject, isProjectFileName, projectFileText, fileBytes, unpackReceived } from "@/lib/core/project-transfer";
import { importModels, isModelsFileName, MODELS_EXT } from "@/lib/core/models-transfer";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { clearInbox, onInbox, readCacheFile, readInbox, type InboxItem } from "@/lib/device";
import { getCore } from "@/lib/core";
import { setChatHandoff } from "@/lib/share-handoff";
import { setActiveProject, useActiveProjectId, useMutate, useRepoQuery } from "@/lib/use-app";
import { attachmentKind } from "@/lib/chat-attachments";

const fmt = (n?: number) => (n === undefined ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files or text that another app shared to MI AI ("Compartir en… MI AI"). The person decides where they go. */
export function ShareInbox() {
  const [items, setItems] = useState<InboxItem[]>([]), [busy, setBusy] = useState(false);
  const active = useActiveProjectId();
  const { data: projects = [] } = useRepoQuery(["projects"], (r) => r.listProjects());
  const [pid, setPid] = useState<string>("");
  const [pw, setPw] = useState("");
  const navigate = useNavigate(), mutate = useMutate();
  useEffect(() => { const load = () => void readInbox().then(setItems); load(); return onInbox(load); }, []);
  useEffect(() => { if (!pid && (active || projects[0])) setPid(active ?? projects[0]!.id); }, [active, projects, pid]);
  if (!items.length) return null;
  const files = items.filter((i) => i.kind === "file"), texts = items.filter((i) => i.kind === "text");
  const chatable = files.every((f) => { try { attachmentKind(f.name ?? "", f.mime ?? ""); return (f.size ?? 0) <= 50 * 1024 * 1024; } catch { return false; } }) && files.length <= 8;
  const done = async () => { await clearInbox(); setItems([]); };

  async function toLibrary() {
    if (!pid) { toast.error("Crea un proyecto primero."); return; }
    setBusy(true);
    try {
      const c = await getCore();
      for (const f of files) await c.assets.put(pid, readCacheFile(f.path!), { kind: (f.mime ?? "").startsWith("application/") ? "document" : (f.mime ?? "document").split("/")[0]!, mime: f.mime ?? "application/octet-stream", name: f.name ?? "archivo", capability: "share.received" });
      if (texts.length) {
        const body = texts.map((t) => t.text).join("\n\n");
        await c.assets.put(pid, (async function* () { yield new TextEncoder().encode(body); })(), { kind: "document", mime: "text/plain", name: (texts[0]!.name || "Texto compartido").slice(0, 60) + ".txt", capability: "share.received" });
      }
      setActiveProject(pid); await done();
      toast.success("Guardado cifrado en Biblioteca.");
      await navigate({ to: "/library" });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  const projectFile = files.find((f) => isProjectFileName(f.name ?? ""));
  const modelsFile = files.find((f) => isModelsFileName(f.name ?? ""));
  const special = projectFile ?? modelsFile;
  async function importReceived() {
    if (!special) return;
    setBusy(true);
    try {
      const all = await fileBytes(readCacheFile(special.path!));
      const c = await getCore();
      if (projectFile) {
        const r = await importProject({ repo: c.repo, assets: c.assets, text: await projectFileText(all), password: pw });
        await mutate(async () => undefined); setActiveProject(r.project.id); await done();
        toast.success(`Proyecto "${r.project.name}" importado como proyecto nuevo`);
        await navigate({ to: "/" });
      } else {
        const r = await importModels({ repo: c.repo, text: await unpackReceived(all, MODELS_EXT, "una configuración de modelos"), password: pw });
        await mutate(async () => undefined); await done();
        toast.success(`${r.added} proveedores y ${r.models} modelos añadidos${r.skipped ? ` (${r.skipped} ya estaban)` : ""}. Escribe sus API keys en Modelos.`);
        await navigate({ to: "/models" });
      }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setPw(""); }
  }
  async function toChat() {
    if (!pid) { toast.error("Crea un proyecto primero."); return; }
    setBusy(true);
    try {
      const list: File[] = [];
      for (const f of files) { const parts: BlobPart[] = []; for await (const c of readCacheFile(f.path!)) parts.push(c.slice() as BlobPart); list.push(new File(parts, f.name ?? "archivo", { type: f.mime ?? "" })); }
      const chat = await mutate((r) => r.createChat(pid));
      setChatHandoff(chat.id, { text: texts.map((t) => t.text).join("\n\n"), files: list });
      setActiveProject(pid); await done();
      await navigate({ to: "/chat/$chatId", params: { chatId: chat.id } });
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={(o) => { if (!o && !busy) void done(); }}>
    <DialogContent>
      <DialogHeader><DialogTitle className="flex items-center gap-2"><Inbox className="h-5 w-5 text-primary" />Recibido de otra app</DialogTitle>
        <DialogDescription>Elige a qué proyecto va y qué hacer con {items.length === 1 ? "esto" : "estos elementos"}.</DialogDescription></DialogHeader>
      <ul className="max-h-48 space-y-1 overflow-auto text-sm">
        {files.map((f) => <li key={f.path} className="truncate">{f.name} <span className="text-muted-foreground">{fmt(f.size)}</span></li>)}
        {texts.map((t, i) => <li key={i} className="line-clamp-3 text-muted-foreground">“{t.text}”</li>)}
      </ul>
      {special && <div className="space-y-2 rounded-lg border p-3">
        <p className="text-sm font-medium">{projectFile ? "Es un proyecto de MI AI" : "Es una configuración de modelos de MI AI"}</p>
        <input aria-label="Contraseña del proyecto" type="password" className="w-full rounded-md border bg-background p-2 text-sm" placeholder="Contraseña del archivo" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Button className="w-full" disabled={busy || !pw} onClick={importReceived}><FolderInput />{projectFile ? "Importar como proyecto nuevo" : "Añadir estos modelos"}</Button>
      </div>}
      <label className="block text-sm">Proyecto
        <select aria-label="Proyecto de destino" className="mt-1 w-full rounded-md border bg-background p-2" value={pid} onChange={(e) => setPid(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
      <DialogFooter className="gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => void done()}>Descartar</Button>
        {files.length > 0 || texts.length > 0 ? <Button variant="outline" disabled={busy || !pid} onClick={toLibrary}><Images />Guardar en Biblioteca</Button> : null}
        <Button disabled={busy || !pid || !chatable} onClick={toChat} title={chatable ? "" : "Algún archivo no se puede adjuntar al chat; guárdalo en Biblioteca."}><MessageSquarePlus />Abrir en chat nuevo</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
