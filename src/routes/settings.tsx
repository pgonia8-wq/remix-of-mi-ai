import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download, Pencil, Plug, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Provider, ProviderKind } from "@/lib/db/repo";
import { PROVIDER_KINDS, testProvider } from "@/lib/providers";
import { getRepo, isNative } from "@/lib/app-db";
import { openWithPassword, sealWithPassword } from "@/lib/crypto";
import { useMutate, useRepoQuery } from "@/lib/use-app";
import { btnCls, btnGhost, inputCls } from "@/components/AppShell";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Ajustes — MI AI" },
      { name: "description", content: "Conexiones con proveedores de IA y copias de seguridad cifradas." },
      { property: "og:title", content: "Ajustes — MI AI" },
      { property: "og:description", content: "Proveedores de IA y copias cifradas." },
    ],
  }),
  component: Settings,
});

type Form = { name: string; kind: ProviderKind; endpoint: string; apiKey: string; deployment: string; model: string; apiVersion: string; extraParams: string };
const blank = (kind: ProviderKind = "openai"): Form => {
  const d = PROVIDER_KINDS.find((k) => k.kind === kind)!;
  return { name: d.label, kind, endpoint: d.endpoint, apiKey: "", deployment: "", model: d.model, apiVersion: "", extraParams: "" };
};

function Settings() {
  const { data: providers = [] } = useRepoQuery(["providers"], (r) => r.listProviders());
  const mutate = useMutate();
  const [form, setForm] = useState<Form | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function edit(p: Provider) {
    setEditId(p.id);
    setForm({ name: p.name, kind: p.kind, endpoint: p.endpoint ?? "", apiKey: "", deployment: p.deployment ?? "", model: p.model, apiVersion: p.api_version ?? "", extraParams: p.extra_params ?? "" });
  }
  async function save() {
    if (!form) return;
    if (form.extraParams.trim()) {
      try {
        JSON.parse(form.extraParams);
      } catch {
        return toast.error("Parámetros extra debe ser JSON válido");
      }
    }
    await mutate((r) => r.saveProvider({ ...form, apiKey: form.apiKey || undefined }, editId ?? undefined));
    setForm(null);
    setEditId(null);
    toast.success("Conexión guardada (la API key se guarda cifrada)");
  }
  async function test(p: Provider) {
    setBusy(p.id);
    try {
      const repo = await getRepo();
      const r = await testProvider({ kind: p.kind, endpoint: p.endpoint, apiKey: await repo.getProviderSecret(p.id), model: p.model, deployment: p.deployment, apiVersion: p.api_version, extraParams: p.extra_params });
      toast.success(`Funciona: ${r.slice(0, 60)}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const meta = form ? PROVIDER_KINDS.find((k) => k.kind === form.kind)! : null;

  return (
    <div className="space-y-6 p-4">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Proveedores</h1>
          {!form && (
            <button className={btnCls} onClick={() => (setEditId(null), setForm(blank()))}>
              <Plus className="h-4 w-4" /> Añadir
            </button>
          )}
        </div>
        {form && meta && (
          <div className="space-y-2 rounded-xl border bg-card p-3">
            <select className={inputCls} value={form.kind} disabled={!!editId} onChange={(e) => setForm(blank(e.target.value as ProviderKind))}>
              {PROVIDER_KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
            <input className={inputCls} placeholder="Nombre" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={inputCls} placeholder="Endpoint" value={form.endpoint} onChange={(e) => setForm({ ...form, endpoint: e.target.value })} />
            <input className={inputCls} type="password" autoComplete="off" placeholder={editId ? "API key (vacío = conservar la actual)" : "API key"} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
            <input className={inputCls} placeholder="Modelo" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input className={inputCls} placeholder={meta.needsDeployment ? "Deployment" : "Deployment (opcional)"} value={form.deployment} onChange={(e) => setForm({ ...form, deployment: e.target.value })} />
            <input className={inputCls} placeholder="Versión de API (opcional)" value={form.apiVersion} onChange={(e) => setForm({ ...form, apiVersion: e.target.value })} />
            <textarea className={inputCls} rows={2} placeholder='Parámetros extra JSON, ej. {"temperature":0.3}' value={form.extraParams} onChange={(e) => setForm({ ...form, extraParams: e.target.value })} />
            <div className="flex gap-2">
              <button className={btnCls + " flex-1"} onClick={save} disabled={!form.name || !form.model}>
                Guardar
              </button>
              <button className={btnGhost} onClick={() => setForm(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
        {providers.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-xl border bg-card p-3 text-sm">
            <div className="flex-1">
              <div className={`font-medium ${p.enabled ? "" : "text-muted-foreground line-through"}`}>{p.name}</div>
              <div className="text-xs text-muted-foreground">
                {p.model} · {p.has_key ? "key cifrada" : "sin key"}
              </div>
            </div>
            <button aria-label="Probar" className={btnGhost} disabled={busy === p.id} onClick={() => test(p)}>
              <Plug className="h-4 w-4" />
            </button>
            <input type="checkbox" aria-label="Activo" checked={!!p.enabled} onChange={(e) => mutate((r) => r.setProviderEnabled(p.id, e.target.checked))} />
            <button aria-label="Editar" onClick={() => edit(p)}>
              <Pencil className="h-4 w-4" />
            </button>
            <button aria-label="Eliminar" onClick={() => confirm("¿Eliminar conexión?") && mutate((r) => r.deleteProvider(p.id))}>
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </button>
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
  async function doExport() {
    if (pw.length < 8) return toast.error("Usa una contraseña de al menos 8 caracteres");
    const sealed = await sealWithPassword(pw, JSON.stringify(await (await getRepo()).dumpAll()));
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
  }
  async function doImport(f: File | undefined) {
    if (!f) return;
    try {
      const dump = JSON.parse(await openWithPassword(pw, await f.text()));
      await mutate((r) => r.restoreAll(dump));
      toast.success("Copia importada. Vuelve a introducir las API keys de las conexiones.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <section className="space-y-2 rounded-xl border bg-card p-3">
      <h2 className="font-semibold">Copia de seguridad cifrada</h2>
      <p className="text-xs text-muted-foreground">Incluye proyectos, chats, memoria y texto de documentos. Las API keys nunca se exportan.</p>
      <input className={inputCls} type="password" placeholder="Contraseña de la copia" value={pw} onChange={(e) => setPw(e.target.value)} />
      <div className="flex gap-2">
        <button className={btnCls + " flex-1"} onClick={doExport}>
          <Download className="h-4 w-4" /> Exportar
        </button>
        <label className={btnGhost + " flex-1 cursor-pointer"}>
          <Upload className="h-4 w-4" /> Importar
          <input type="file" className="hidden" onChange={(e) => doImport(e.target.files?.[0])} />
        </label>
      </div>
    </section>
  );
}
