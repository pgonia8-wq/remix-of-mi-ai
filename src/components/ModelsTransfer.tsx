import { useState } from "react";
import { Bluetooth, Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { inputCls } from "./AppShell";
import { getCore } from "@/lib/core";
import { passwordStrength } from "@/lib/core/backup";
import { exportModels, importModels, MODELS_EXT } from "@/lib/core/models-transfer";
import { packForBluetooth, bluetoothName, BLUETOOTH_MIME, unpackReceived, fileBytes } from "@/lib/core/project-transfer";
import { blobChunks, sendByBluetooth } from "@/lib/device";
import { saveExport } from "@/lib/save-export";
import { useCoreMutate } from "@/lib/use-app";

/** Send the whole model setup to another phone (Bluetooth or file) and receive it there. API keys never travel. */
export function ModelsTransfer() {
  const [open, setOpen] = useState(false), [pw, setPw] = useState(""), [busy, setBusy] = useState(false);
  const mutate = useCoreMutate();
  async function send(via: "bluetooth" | "file") {
    const st = passwordStrength(pw); if (!st.ok) { toast.error(st.hint); return; }
    setBusy(true);
    try {
      const c = await getCore();
      const text = await exportModels({ repo: c.repo, password: pw, deviceMemGB: c.device.totalMemMB ? c.device.totalMemMB / 1024 : null });
      if (via === "bluetooth") {
        const r = await sendByBluetooth({ data: await packForBluetooth(text, "MI-AI-modelos", MODELS_EXT), name: bluetoothName("MI-AI-modelos", MODELS_EXT), mime: BLUETOOTH_MIME });
        toast.success(r === "downloaded" ? "Archivo listo: envíalo por Bluetooth desde tu teléfono" : "Elige el teléfono de destino. Allí ábrelo en Modelos → Recibir, con la misma contraseña.");
      } else {
        await saveExport(new TextEncoder().encode(text), `MI-AI-modelos${MODELS_EXT}`, "application/octet-stream");
        toast.success("Configuración de modelos guardada y cifrada");
      }
      setOpen(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setPw(""); }
  }
  async function receive(f: File | undefined) {
    if (!f) return;
    setBusy(true);
    try {
      const text = await unpackReceived(await fileBytes(blobChunks(f)), MODELS_EXT, "una configuración de modelos");
      const r = await mutate(async (c) => importModels({ repo: c.repo, text, password: pw }));
      toast.success(`${r.added} proveedores y ${r.models} modelos añadidos${r.skipped ? ` (${r.skipped} ya estaban)` : ""}. Escribe sus API keys y pruébalos.`);
      setOpen(false);
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); setPw(""); }
  }
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}><Bluetooth /> Enviar o recibir modelos</Button>;
  return <section className="space-y-2 rounded-xl border bg-card p-3 text-sm">
    <h2 className="font-semibold">Pasar modelos a otro teléfono</h2>
    <p className="text-xs text-muted-foreground">Envía proveedores, direcciones, deployments, modelos, capacidades y favoritos, cifrados con esta contraseña. Las API keys no viajan: en el otro teléfono se escriben y se prueban de nuevo.</p>
    <input className={inputCls} type="password" aria-label="Contraseña del archivo de modelos" placeholder="Contraseña del archivo" value={pw} onChange={(e) => setPw(e.target.value)} />
    {busy && <p className="text-xs text-primary">Procesando…</p>}
    <div className="flex flex-wrap gap-2">
      <Button className="flex-1" disabled={busy || !pw} onClick={() => send("bluetooth")}><Bluetooth /> Bluetooth</Button>
      <Button className="flex-1" variant="outline" disabled={busy || !pw} onClick={() => send("file")}><Download /> Guardar</Button>
      <label className={"inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2" + (busy || !pw ? " pointer-events-none opacity-50" : "")}><Upload className="h-4 w-4" /> Recibir<input type="file" className="hidden" accept=".miaimodels,.zip,application/zip,application/octet-stream" onChange={(e) => receive(e.target.files?.[0])} /></label>
    </div>
    <button className="w-full text-center text-xs underline" onClick={() => setOpen(false)}>Cerrar</button>
  </section>;
}
