import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download, Pencil, Plug, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Provider } from "@/lib/db/repo";
import { testProvider, type ConnectionResult } from "@/lib/providers";
import { getRepo, isNative } from "@/lib/app-db";
import { openWithPassword } from "@/lib/crypto";
import { Link } from "@tanstack/react-router";
import { getCore } from "@/lib/core";
import { openBackup, restoreBackup, passwordStrength } from "@/lib/core/backup";
import { useMutate, useRepoQuery } from "@/lib/use-app";
import { btnCls, btnGhost, inputCls } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ProviderForm, ConnectionDiagnostic } from "@/components/ProviderForm";
import { AzureAutoSetup } from "@/components/AzureAutoSetup";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Ajustes — MI AI" },
      { name: "description", content: "Conexiones con proveedores de IA y copias de seguridad cifradas." },
      { property: "og:title", content: "Ajustes — MI AI" },
      { property: "og:description", content: "Proveedores de IA verificados y copias cifradas." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

function Settings() {
  const { data: providers = [] } = useRepoQuery(["providers"], (r) => r.listProviders());
  const mutate = useMutate();
  const [editing, setEditing] = useState<Provider | "new" | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, ConnectionResult>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function test(p: Provider) {
    setBusy(p.id);
    try {
      const repo = await getRepo();
      const r = await testProvider({ kind: p.kind, endpoint: p.endpoint, apiKey: await repo.getProviderSecret(p.id), model: p.model, deployment: p.deployment, apiVersion: p.api_version, extraParams: p.extra_params });
      await mutate(repo => repo.setProviderVerification(p.id, r.ok ? "verified" : "error"));
      setDiagnostics(previous => ({ ...previous, [p.id]: r }));
    } catch (e) {
      toast.error("No se pudo completar la operación local.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-4">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Proveedores</h1>
          {!editing && <Button variant="outline" onClick={() => setEditing("new")}><Plus /> Añadir manual</Button>}
        </div>
        {!editing && <AzureAutoSetup />}
        {editing && <ProviderForm key={editing === "new" ? "new" : editing.id} provider={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
        {providers.map((p) => (
          <div key={p.id} className="space-y-2 rounded-md border bg-card p-3 text-sm">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1 break-words">
                <div className={`font-medium ${p.enabled ? "" : "text-muted-foreground line-through"}`}>{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.model} · {p.has_key ? "key cifrada" : "sin key"}</div>
              </div>
              <input type="checkbox" aria-label="Activo" checked={!!p.enabled} onChange={(e) => mutate((r) => r.setProviderEnabled(p.id, e.target.checked))} />
              <Button variant="ghost" size="icon" aria-label="Editar" title="Editar" onClick={() => setEditing(p)}><Pencil /></Button>
              <Button variant="ghost" size="icon" aria-label="Eliminar" title="Eliminar" onClick={() => confirm("¿Eliminar conexión?") && mutate((r) => r.deleteProvider(p.id))}><Trash2 /></Button>
            </div>
            <p className={p.verification_status === "error" ? "text-destructive" : "text-muted-foreground"}>{p.verification_status === "verified" ? "Conectado y verificado" : p.verification_status === "error" ? "Error de conexión" : "No verificado"}</p>
            {p.checked_at && <p className="text-xs text-muted-foreground">Última prueba: {new Date(p.checked_at).toLocaleString()}</p>}
            <Button variant="outline" className="w-full" disabled={busy !== null} onClick={() => test(p)}><Plug />{busy === p.id ? "Conectando..." : "Probar conexión"}</Button>
            <ConnectionDiagnostic result={diagnostics[p.id] ?? null} />
          </div>
        ))}
      </section>
      <Prices />
      <Backup />
      <p className="text-xs text-muted-foreground">
        {isNative()
          ? "Datos en SQLite cifrado (SQLCipher). Claves protegidas por Android Keystore. Ningún cifrado garantiza protección total en un teléfono comprometido (root o malware)."
          : "Vista de desarrollo: aquí se usa una base temporal del navegador. La app Android usa SQLite cifrado y Android Keystore."}
      </p>
    </div>
  );
}

function Backup() {
  const mutate = useMutate();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const strength = passwordStrength(pw);
  async function doExport() {
    if (!strength.ok) { toast.error(strength.hint); return; }
    setBusy("Derivando la llave y cifrando la copia…");
    try {
      const core = await getCore();
      const nav = navigator as Navigator & { deviceMemory?: number };
      const mem = core.device.totalMemMB ? core.device.totalMemMB / 1024 : nav.deviceMemory ?? null;
      const { createBackupStream } = await import("@/lib/core/backup-stream");
      const name = `miai-${new Date().toISOString().slice(0, 10)}.miai`;
      const stream = createBackupStream({ repo: core.repo, keys: core.keys, fs: core.files, password: pw, deviceMemGB: mem });
      if (isNative()) {
        const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
        await Filesystem.writeFile({ path: name, data: "", directory: Directory.Documents, encoding: Encoding.UTF8 });
        for await (const line of stream) await Filesystem.appendFile({ path: name, data: line, directory: Directory.Documents, encoding: Encoding.UTF8 });
        toast.success(`Guardado en Documentos/${name}`);
      } else {
        const parts: string[] = [];
        for await (const line of stream) parts.push(line);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob(parts, { type: "application/octet-stream" }));
        a.download = name;
        a.click();
      }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  async function doImport(f: File | undefined) {
    if (!f) return;
    setBusy("Verificando la copia…");
    try {
      const { isBackupV3, restoreBackupStream, linesOfBlob } = await import("@/lib/core/backup-stream");
      const first = await f.slice(0, 4096).text();
      if (isBackupV3(first.slice(0, first.indexOf("\n")))) {
        setBusy("Verificando cada parte de la copia…");
        const core = await getCore();
        await restoreBackupStream({ lines: () => linesOfBlob(f), password: pw, repo: core.repo, keys: core.keys, fs: core.files });
        await mutate(async () => undefined);
      } else {
        const text = await f.text(); // legacy v1/v2 single-document formats
        if (JSON.parse(text)?.format === "miai-export") {
          const dump = JSON.parse(await openWithPassword(pw, text)); // v1 compatibility
          await mutate((r) => r.restoreAll(dump));
          toast.success("Copia restaurada. Vuelve a introducir y probar las API keys de las conexiones.");
          return;
        }
        const payload = await openBackup(text, pw); // authenticity checked before anything is touched
        setBusy("Restaurando y verificando archivos…");
        const core = await getCore();
        await restoreBackup({ payload, repo: core.repo, db: core.repo.sql, keys: core.keys, fs: core.files });
        await mutate(async () => undefined);
      }
      toast.success("Copia restaurada. Vuelve a introducir y probar las API keys de las conexiones.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(null); }
  }
  return (
    <section className="space-y-2 rounded-xl border bg-card p-3">
      <h2 className="font-semibold">Copia de seguridad cifrada</h2>
      <p className="text-xs text-muted-foreground">Incluye proyectos, chats, memoria, documentos, modelos, trabajos y la biblioteca. Se protege con Argon2id y AES-256-GCM, y se puede restaurar en otro teléfono. Las API keys nunca se exportan. La contraseña no se guarda.</p>
      <input className={inputCls} type="password" placeholder="Contraseña de la copia" value={pw} onChange={(e) => setPw(e.target.value)} />
      {pw && <p className={`text-xs ${strength.ok ? "text-muted-foreground" : "text-destructive"}`}>{strength.hint}</p>}
      {busy && <p className="text-xs text-primary">{busy}</p>}
      <div className="flex gap-2">
        <button className={btnCls + " flex-1"} disabled={!!busy} onClick={doExport}>
          <Download className="h-4 w-4" /> Exportar
        </button>
        <label className={btnGhost + " flex-1 cursor-pointer"}>
          <Upload className="h-4 w-4" /> Importar
          <input type="file" className="hidden" disabled={!!busy} onChange={(e) => doImport(e.target.files?.[0])} />
        </label>
      </div>
      <div className="flex gap-3 pt-1 text-xs">
        <Link to="/jobs" className="text-primary underline">Trabajos</Link>
        <Link to="/diagnostics" className="text-primary underline">Diagnóstico de seguridad y rendimiento</Link>
      </div>
    </section>
  );
}

function Prices() {
  const { data: prices = [] } = useRepoQuery(["prices"], (r) => r.listModelPrices());
  const mutate = useMutate();
  const [f, setF] = useState({ model: "", input: "", output: "", image: "", second: "", call: "" });
  const num = (v: string) => (v.trim() ? Number(v) : null);
  async function save() {
    try {
      await mutate((r) => r.setModelPrice({ model: f.model.trim(), input_per_mtok: num(f.input), output_per_mtok: num(f.output), per_image: num(f.image), per_second: num(f.second), per_call: num(f.call) }));
      setF({ model: "", input: "", output: "", image: "", second: "", call: "" }); toast.success("Tarifa guardada");
    } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <section className="space-y-2 rounded-xl border bg-card p-3">
      <h2 className="font-semibold">Tarifas para calcular el gasto</h2>
      <p className="text-xs text-muted-foreground">Los proveedores casi nunca informan el precio de cada llamada. Escribe la tarifa de tu contrato (en US$) por modelo o deployment y el gasto se calculará como estimado. Sin tarifa, la llamada se registra como «sin precio».</p>
      <ul className="space-y-1 text-xs">
        {prices.map((p) => (
          <li key={p.model} className="flex items-center gap-2"><span className="flex-1 truncate font-medium">{p.model}</span>
            <span className="text-muted-foreground">{[p.input_per_mtok !== null && `entrada ${p.input_per_mtok}/M`, p.output_per_mtok !== null && `salida ${p.output_per_mtok}/M`, p.per_image !== null && `${p.per_image}/imagen`, p.per_second !== null && `${p.per_second}/s`, p.per_call !== null && `${p.per_call}/llamada`].filter(Boolean).join(" · ")}</span>
            <button aria-label={`Quitar tarifa ${p.model}`} onClick={() => mutate((r) => r.deleteModelPrice(p.model))}><Trash2 className="h-3 w-3" /></button></li>
        ))}
      </ul>
      <input className={inputCls} placeholder="Modelo o deployment (exacto)" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <input className={inputCls} inputMode="decimal" placeholder="Entrada por millón de tokens" value={f.input} onChange={(e) => setF({ ...f, input: e.target.value })} />
        <input className={inputCls} inputMode="decimal" placeholder="Salida por millón de tokens" value={f.output} onChange={(e) => setF({ ...f, output: e.target.value })} />
        <input className={inputCls} inputMode="decimal" placeholder="Por imagen" value={f.image} onChange={(e) => setF({ ...f, image: e.target.value })} />
        <input className={inputCls} inputMode="decimal" placeholder="Por segundo (video/música)" value={f.second} onChange={(e) => setF({ ...f, second: e.target.value })} />
        <input className={inputCls} inputMode="decimal" placeholder="Por llamada" value={f.call} onChange={(e) => setF({ ...f, call: e.target.value })} />
      </div>
      <button className={btnCls + " w-full"} disabled={!f.model.trim()} onClick={save}><Plus className="h-4 w-4" /> Guardar tarifa</button>
    </section>
  );
}
