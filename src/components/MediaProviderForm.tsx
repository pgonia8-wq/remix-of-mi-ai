import { useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { inputCls } from "./AppShell";
import { useCoreMutate } from "@/lib/use-app";
import { getAdapter } from "@/lib/core/adapters";
import type { ProviderKind } from "@/lib/db/repo";
import { call } from "@/lib/core/adapters/http";

export function MediaProviderForm({ onDone }: { onDone: () => void }) {
  const mutate = useCoreMutate();
  const [kind, setKind] = useState<"meshy" | "runway" | "elevenlabs">("runway"), [key, setKey] = useState(""), [model, setModel] = useState("gen4.5");
  const [busy, setBusy] = useState(false), [verified, setVerified] = useState(false), [message, setMessage] = useState("");
  const capability = kind === "runway" ? "video.generate" : kind === "meshy" ? "model3d.generate" : "music.generate";
  function invalidate() { setVerified(false); setMessage(""); }
  async function test() {
    if (!confirm("La prueba generará un resultado REAL con tu clave y puede tener costo. ¿Continuar?")) return;
    setBusy(true); setVerified(false); setMessage("Conectando…");
    try {
      const adapter = getAdapter(kind);
      const result = await adapter.run({ kind, endpoint: null, apiKey: key.trim(), deployment: null, apiVersion: null, model, extraParams: null }, { capability, model, prompt: kind === "meshy" ? "A simple cube" : kind === "elevenlabs" ? "A short calm instrumental piano melody" : "A blue ball on a table, static camera", params: { seconds: kind === "elevenlabs" ? 3 : 4, instrumental: true, ratio: "1280:720" } });
      if (result.kind === "remote") {
        if (!adapter.poll) throw new Error("El proveedor no permite verificar el resultado.");
        setMessage(`Trabajo de prueba ${result.remoteId}. Esperando resultado real…`);
        // Bounded polling; no hidden resubmission after timeout.
        let ready = false;
        for (let n = 0; n < 60; n++) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          const output = await adapter.poll({ kind, endpoint: null, apiKey: key.trim(), deployment: null, apiVersion: null, model, extraParams: null }, result.remoteId);
          if (output.kind === "files" && output.files.some((f) => f.bytes.length > 100)) { ready = true; break; }
          if (output.kind !== "pending") throw new Error("El proveedor no devolvió un archivo válido.");
        }
        if (!ready) throw new Error(`La prueba sigue pendiente en el proveedor (${result.remoteId}). No vuelvas a generar sin revisar el posible costo.`);
      } else if (result.kind !== "files" || !result.files.some((f) => f.bytes.length > 100)) throw new Error("El proveedor no devolvió un resultado válido.");
      setVerified(true); setMessage("Conexión y resultado real verificados.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "No se confirmó el resultado."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!verified) return;
    await mutate(async (c) => {
      const id = await c.repo.saveProvider({ name: getAdapter(kind).label, kind: kind as ProviderKind, model: model.trim(), apiKey: key.trim() });
      await c.repo.setProviderVerification(id, "verified");
      const mid = await c.repo.registry.upsertModel({ providerId: id, remoteId: model.trim(), source: "manual" });
      await c.repo.registry.setModelCapabilities(mid, [capability]);
      await c.repo.registry.recordTest(mid, capability, true, 200, "Archivo real recibido durante la prueba de conexión.");
    });
    setKey(""); onDone(); toast.success("Proveedor guardado con clave cifrada.");
  }
  return <div className="space-y-2 border-t pt-3">
    <select aria-label="Proveedor de medios" className={inputCls} disabled={busy} value={kind} onChange={(e) => { const value = e.target.value as typeof kind; setKind(value); setModel(value === "runway" ? "gen4.5" : value === "meshy" ? "meshy-6" : "music_v1"); invalidate(); }}><option value="runway">Runway · Video</option><option value="meshy">Meshy · 3D</option><option value="elevenlabs">ElevenLabs · Música</option></select>
    <input aria-label="Modelo del proveedor de medios" disabled={busy} className={inputCls} value={model} onChange={(e) => { setModel(e.target.value); invalidate(); }} />
    <input aria-label="Clave del proveedor de medios" disabled={busy} type="password" autoComplete="off" className={inputCls} value={key} onChange={(e) => { setKey(e.target.value); invalidate(); }} />
    {message && <p className={`break-words text-xs ${verified ? "text-primary" : "text-muted-foreground"}`}>{message}</p>}
    <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !key.trim() || !model.trim()} onClick={test}>Probar conexión</Button><Button disabled={busy || !verified} onClick={() => save().catch(() => toast.error("No se pudo guardar."))}>Guardar modelo</Button><Button variant="ghost" disabled={busy} onClick={onDone}>Cerrar</Button></div>
  </div>;
}