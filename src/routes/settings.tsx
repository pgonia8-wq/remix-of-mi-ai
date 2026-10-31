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
import { createBackup, openBackup, restoreBackup, passwordStrength } from "@/lib/core/backup";
import { useMutate, useRepoQuery } from "@/lib/use-app";
import { btnCls, btnGhost, inputCls } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { ProviderForm, ConnectionDiagnostic } from "@/components/ProviderForm";

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
          {!editing && <Button onClick={() => setEditing("new")}><Plus /> Añadir</Button>}
        </div>
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
      const sealed = await createBackup({ repo: core.repo, keys: core.keys, fs: core.files, password: pw, deviceMemGB: mem });
      const name = `miai-${new Date().toISOString().slice(0, 10)}.miai`;
      if (isNative()) {
        const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");
        await Filesystem.writeFile({ path: name, data: sealed, directory: Directory.Documents, encoding: Encoding.UTF8 });
        toast.success(`Guardado en Documentos/${name}`);
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([sealed], { type: "application/octet-stream" }));
        a.download = name;
        a.click();
      }
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); }
  }
  async function doImport(f: File | undefined) {
    if (!f) return;
    setBusy("Verificando la copia…");
    try {
      const text = await f.text();
      const format = JSON.parse(text)?.format;
      if (format === "miai-export") {
        const dump = JSON.parse(await openWithPassword(pw, text)); // v1 compatibility
        await mutate((r) => r.restoreAll(dump));
      } else {
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
