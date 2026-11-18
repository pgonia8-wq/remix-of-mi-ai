import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Play, Plus, Terminal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NeedProject, inputCls } from "@/components/AppShell";
import { connections, encodeCredential, cleanKnownHosts, type ConnectionConfig } from "@/lib/connections";
import { VmTerminal } from "@/components/VmTerminal";
import { useActiveProjectId, useCoreQuery, useCoreMutate } from "@/lib/use-app";
export const Route = createFileRoute("/servers")({ head: () => ({ meta: [
  { title: "Servidores y terminal — MI AI" }, { name: "description", content: "SSH, SFTP y Git remoto con autorización y claves de host verificadas." },
  { property: "og:title", content: "Servidores y terminal — MI AI" }, { property: "og:description", content: "Conexiones Linux desde Android sin servidor central." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: Page });
function Page() { const pid = useActiveProjectId(); return pid ? <Servers key={pid} pid={pid} /> : <NeedProject />; }
function Servers({ pid }: { pid: string }) {
  const { data: list = [] } = useCoreQuery(["connections", pid], (c) => connections.list(c.repo, pid));
  const mutate = useCoreMutate();
  const [name, setName] = useState(""), [config, setConfig] = useState<ConnectionConfig>({ host: "", port: 22, user: "", knownHosts: "" }), [edit, setEdit] = useState(false);
  const [id, setId] = useState(""), [password, setPassword] = useState(""), [remember, setRemember] = useState(false), [command, setCommand] = useState("pwd"), [output, setOutput] = useState(""), [busy, setBusy] = useState(false);
  const [authMode, setAuthMode] = useState<"password" | "key" | "both">("password"), [privateKey, setPrivateKey] = useState(""), [passphrase, setPassphrase] = useState("");
  const credential = () => (authMode === "password" ? password : authMode === "key" && !privateKey.trim() ? "" : encodeCredential({ password: authMode === "key" ? "" : password, privateKey, passphrase }));
  const loadKeyFile = async (f?: File | null) => { if (!f) return; if (f.size > 16000) { toast.error("Ese archivo no parece una clave privada (es muy grande)."); return; } setPrivateKey(await f.text()); };
  const [path, setPath] = useState("."), [action, setAction] = useState<"list" | "read" | "write">("list"), [content, setContent] = useState("");
  async function call(sftp = false) {
    if (!confirm(`¿Autorizar ${sftp ? 'SFTP ' + action + ' ' + path : command} en el servidor seleccionado?`)) return;
    setBusy(true);
    try { await mutate(async (c) => {
      const secret = credential();
      if (remember && secret) await c.repo.saveConnectionSecret(pid, id, secret);
      const request = sftp ? { action, path, ...(action === "write" ? { data: btoa(unescape(encodeURIComponent(content))) } : {}) } : { command };
      const r = await connections.call(c.repo, pid, id, request, secret); setOutput(r.output);
      if ("data" in r && r.data) {
        const bytes = Uint8Array.from(atob(r.data), (s) => s.charCodeAt(0));
        await c.assets.put(pid, (async function* () { yield bytes; })(), { kind: "document", mime: "application/octet-stream", name: path.split("/").pop() ?? "archivo" });
        setOutput(r.output + "\nGuardado cifrado en Biblioteca.");
      }
    }); } catch (e) { setOutput(e instanceof Error ? e.message : "No se completó la conexión."); } finally { setPassword(""); setPassphrase(""); if (remember) setPrivateKey(""); setBusy(false); }
  }
  return <div className="space-y-4 p-4"><div className="flex items-center justify-between"><h1 className="text-2xl font-bold">Servidores</h1><Button aria-label="Nueva conexión" onClick={() => setEdit(!edit)}><Plus /></Button></div>
    {edit && <div className="space-y-2">
      <input aria-label="Nombre de conexión" className={inputCls} placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
      <input aria-label="Servidor" className={inputCls} placeholder="Host o IP" value={config.host} onChange={(e) => setConfig({ ...config, host: e.target.value })} />
      <input aria-label="Usuario SSH" className={inputCls} placeholder="Usuario" value={config.user} onChange={(e) => setConfig({ ...config, user: e.target.value })} />
      <input aria-label="Puerto SSH" type="number" className={inputCls} value={config.port} onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })} />
      <textarea aria-label="Clave de host confiable" className={inputCls + " font-mono text-xs"} rows={4} placeholder="Pega aquí lo que muestra «ssh-keyscan IP» en tu PC o en Termius. Puedes pegarlo completo: la app quita comentarios y texto sobrante." value={config.knownHosts} onChange={(e) => setConfig({ ...config, knownHosts: e.target.value })} />
      {config.host && config.knownHosts.trim() && (() => { try { const n = cleanKnownHosts(config.knownHosts, config.host, config.port).split("\n").length; return <p className="text-xs text-success">Se guardarán {n} clave(s) de host válidas para {config.host}.</p>; } catch (e) { return <p className="text-xs text-destructive">{(e as Error).message}</p>; } })()}
      <Button disabled={!name.trim() || !config.knownHosts.trim()} onClick={async () => { try { await mutate(async (c) => { setId(await connections.save(c.repo, pid, name, config)); }); setEdit(false); toast.success("Conexión guardada. Ahora elige cómo entrar: contraseña o clave privada."); } catch (e) { toast.error(e instanceof Error && !/^\[/.test(e.message) ? e.message : "Revisa los datos de conexión."); } }}>Guardar conexión</Button>
    </div>}
    <select aria-label="Conexión" className={inputCls} value={id} onChange={(e) => { setId(e.target.value); setPassword(""); }}><option value="">Selecciona servidor</option>{list.filter((c) => c.kind === "ssh").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
    <div role="radiogroup" aria-label="Cómo entrar" className="flex flex-wrap gap-2">{([["password", "Contraseña"], ["key", "Clave privada (.pem)"], ["both", "Clave + contraseña"]] as const).map(([k, l]) => <Button key={k} size="sm" role="radio" aria-checked={authMode === k} variant={authMode === k ? "default" : "outline"} onClick={() => setAuthMode(k)}>{l}</Button>)}</div>
    {authMode !== "key" && <input aria-label="Contraseña SSH" type="password" autoComplete="off" className={inputCls} placeholder="Contraseña" value={password} onChange={(e) => setPassword(e.target.value)} />}
    {authMode !== "password" && <div className="space-y-2">
      <textarea aria-label="Clave privada SSH" autoComplete="off" spellCheck={false} className={inputCls + " font-mono text-xs"} rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY----- … (el mismo archivo .pem que usas en Termius)" value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} />
      <label className="block text-xs">O elige el archivo de la clave: <input aria-label="Archivo de clave privada" type="file" className="mt-1 block text-xs" onChange={(e) => void loadKeyFile(e.target.files?.[0])} /></label>
      <input aria-label="Frase de paso de la clave" type="password" autoComplete="off" className={inputCls} placeholder="Frase de paso de la clave (solo si tiene)" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
    </div>}
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Guardar cifrado en este dispositivo (los agentes lo necesitan para trabajar en la VM; nunca va en respaldos)</label>
    <h2 className="font-semibold">Terminal remota</h2>
    <textarea aria-label="Comando remoto" className={inputCls + " font-mono text-xs"} value={command} onChange={(e) => setCommand(e.target.value)} rows={3} />
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !id || !command.trim()} onClick={() => call()}><Play />Ejecutar</Button><Button variant="outline" onClick={() => connections.termux().catch((e: Error) => toast.error(e.message))}><Terminal />Termux</Button></div>
    <div className="flex flex-wrap gap-1">{["git status", "git diff", "git log -5 --oneline", "git fetch", "git pull --ff-only", "git push"].map((cmd) => <Button key={cmd} size="sm" variant="outline" onClick={() => setCommand(cmd)}>{cmd}</Button>)}</div>
    <h2 className="font-semibold">Archivos SFTP</h2><input aria-label="Ruta remota" className={inputCls} value={path} onChange={(e) => setPath(e.target.value)} />
    <select className={inputCls} aria-label="Operación SFTP" value={action} onChange={(e) => setAction(e.target.value as typeof action)}><option value="list">Listar carpeta</option><option value="read">Descargar a Biblioteca</option><option value="write">Enviar texto</option></select>
    {action === "write" && <textarea aria-label="Texto remoto" className={inputCls} rows={4} value={content} onChange={(e) => setContent(e.target.value)} />}
    <Button variant="outline" disabled={busy || !id} onClick={() => call(true)}>Ejecutar SFTP</Button>
    <pre aria-label="Resultado remoto" className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted p-3 text-xs">{output || "Sin resultado."}</pre>
    <VmTerminal pid={pid} title="Lo que hacen los agentes en tus servidores" />
    {id && <Button variant="destructive" onClick={() => confirm("¿Eliminar conexión y contraseña guardada?") && mutate(async (c) => { await connections.remove(c.repo, pid, id); setId(""); })}><Trash2 />Eliminar conexión</Button>}
  </div>;
}