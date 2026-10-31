import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Github, Save, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NeedProject, inputCls } from "@/components/AppShell";
import { useActiveProjectId, useCoreQuery, useCoreMutate } from "@/lib/use-app";
import { github, type GitFile } from "@/lib/github";
import { connections } from "@/lib/connections";
import { toast } from "sonner";
export const Route = createFileRoute("/github")({ head: () => ({ meta: [
  { title: "GitHub — MI AI" }, { name: "description", content: "Lee y publica archivos de tus repositorios con autorización explícita." },
  { property: "og:title", content: "GitHub — MI AI" }, { property: "og:description", content: "Archivos remotos y cambios revisados desde tu teléfono." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: Page });
function Page() { const p = useActiveProjectId(); return p ? <GitHub pid={p} key={p} /> : <NeedProject />; }
function GitHub({ pid }: { pid: string }) {
  const mutate = useCoreMutate();
  const { data: all = [] } = useCoreQuery(["github", pid], (c) => connections.list(c.repo, pid));
  const repos = all.filter((r) => (r.kind as string) === "github");
  const [owner, setOwner] = useState(""), [name, setName] = useState(""), [token, setToken] = useState(""), [id, setId] = useState(""), [path, setPath] = useState(""), [content, setContent] = useState(""), [sha, setSha] = useState<string | undefined>(), [files, setFiles] = useState<GitFile[]>([]), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function read(next = path) { setBusy(true); try { await mutate(async (c) => { const r = await github.request(c.repo, pid, id, next); setPath(next); if (Array.isArray(r)) { setFiles(r); setContent(""); setSha(undefined); } else { setFiles([]); setSha(r.sha); setContent(r.content ? decodeURIComponent(escape(atob(r.content.replace(/\s/g, "")))) : ""); } }); } catch (e) { toast.error(e instanceof Error ? e.message : "Error GitHub"); } finally { setBusy(false); } }
  return <div className="space-y-3 p-4"><div className="flex gap-2"><Github /><h1 className="text-2xl font-bold">GitHub</h1></div>
    <input aria-label="Propietario GitHub" className={inputCls} placeholder="Propietario" value={owner} onChange={(e) => setOwner(e.target.value)} /><input aria-label="Repositorio GitHub" className={inputCls} placeholder="Repositorio" value={name} onChange={(e) => setName(e.target.value)} /><input aria-label="Token GitHub" type="password" autoComplete="off" className={inputCls} placeholder="Token personal" value={token} onChange={(e) => setToken(e.target.value)} />
    <Button disabled={busy || !owner || !name || !token} onClick={async () => { setBusy(true); try { await mutate(async (c) => { setId(await github.save(c.repo, pid, owner, name, token)); }); toast.success("GitHub verificado y guardado"); } catch(e) { toast.error(e instanceof Error ? e.message : "Error"); } finally { setToken(""); setBusy(false); } }}>Probar y guardar</Button>
    <select className={inputCls} aria-label="Repositorio conectado" value={id} onChange={(e) => { setId(e.target.value); setFiles([]); setContent(""); setSha(undefined); }}><option value="">Selecciona repositorio</option>{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
    <input aria-label="Ruta GitHub" className={inputCls} placeholder="Ruta del archivo o carpeta" value={path} onChange={(e) => { setPath(e.target.value); setSha(undefined); }} /><Button disabled={!id || busy} variant="outline" onClick={() => read()}><FolderOpen />Abrir</Button>
    {files.map((f) => <Button key={f.path} variant="ghost" className="w-full justify-start" onClick={() => read(f.path)}>{f.type === "dir" ? "Carpeta: " : "Archivo: "}{f.name}</Button>)}
    <textarea aria-label="Contenido GitHub" rows={12} className={inputCls + " font-mono text-xs"} value={content} onChange={(e) => setContent(e.target.value)} /><input aria-label="Mensaje del cambio" className={inputCls} placeholder="Mensaje del cambio" value={message} onChange={(e) => setMessage(e.target.value)} />
    <Button disabled={!id || !path || !message.trim() || busy} onClick={async () => { if (!confirm(`¿Publicar este cambio en ${path}? Se creará un commit real en GitHub.`)) return; setBusy(true); try { await mutate((c) => github.request(c.repo, pid, id, path, { content, message, ...(sha ? { sha } : {}) })); toast.success("Cambio publicado"); await read(); } catch(e) { toast.error(e instanceof Error ? e.message : "Error"); } finally { setBusy(false); } }}><Save />Publicar cambio</Button>
  </div>;
}