import { useState } from "react";
import { Gauge, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { inputCls } from "./AppShell";
import { useCoreMutate } from "@/lib/use-app";
import { encodeWav, type PcmAudio } from "@/lib/audio-edit";
import { LOUDNESS_TARGETS, measureLoudness, normalizeLoudness, type Loudness } from "@/lib/media/loudness";

const fmt = (v: number, unit: string) => (Number.isFinite(v) ? `${v.toFixed(1)} ${unit}` : `−∞ ${unit}`);
function Readout({ m, label }: { m: Loudness; label: string }) {
  return <div className="space-y-1 rounded-lg border bg-card p-3 text-xs"><p className="text-primary">{label}</p><div className="grid grid-cols-2 gap-x-3 gap-y-1">
    <span>Integrado</span><span className="text-right font-medium">{fmt(m.integratedLufs, "LUFS")}</span>
    <span>Corto plazo máx.</span><span className="text-right">{fmt(m.shortTermMaxLufs, "LUFS")}</span>
    <span>Momentáneo máx.</span><span className="text-right">{fmt(m.momentaryMaxLufs, "LUFS")}</span>
    <span>Rango (LRA)</span><span className="text-right">{fmt(m.lraLu, "LU")}</span>
    <span>True-peak</span><span className="text-right">{fmt(m.truePeakDbtp, "dBTP")}</span>
    <span>Pico de muestra</span><span className="text-right">{fmt(m.samplePeakDbfs, "dBFS")}</span>
  </div></div>;
}
/** BS.1770 / EBU R128 metering and loudness normalization with a true-peak ceiling, all on-device. */
export function LoudnessPanel({ pid, audio, name, parentId, onPreview }: { pid: string; audio: PcmAudio; name: string; parentId: string; onPreview: (a: PcmAudio) => void }) {
  const [targetId, setTargetId] = useState(LOUDNESS_TARGETS[0]!.id), [custom, setCustom] = useState({ lufs: -14, truePeak: -1 });
  const [before, setBefore] = useState<Loudness | null>(null), [after, setAfter] = useState<Loudness | null>(null), [busy, setBusy] = useState(false), mutate = useCoreMutate();
  const preset = LOUDNESS_TARGETS.find((t) => t.id === targetId), target = preset ?? custom;
  const wait = () => new Promise((r) => setTimeout(r, 30));
  return <section className="space-y-3 border-t pt-5" aria-label="Sonoridad profesional">
    <h2 className="flex items-center gap-2 font-semibold"><Gauge className="h-4 w-4 text-primary" />Sonoridad LUFS y true-peak</h2>
    <select aria-label="Objetivo de sonoridad" className={inputCls} value={targetId} onChange={(e) => setTargetId(e.target.value)}>{LOUDNESS_TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}<option value="custom">Personalizado</option></select>
    {!preset && <div className="grid grid-cols-2 gap-2"><label className="text-xs">LUFS objetivo<input aria-label="LUFS objetivo" className={inputCls} type="number" min={-40} max={-5} step={0.5} value={custom.lufs} onChange={(e) => setCustom({ ...custom, lufs: Number(e.target.value) })} /></label><label className="text-xs">Techo dBTP<input aria-label="Techo true-peak" className={inputCls} type="number" min={-12} max={0} step={0.1} value={custom.truePeak} onChange={(e) => setCustom({ ...custom, truePeak: Number(e.target.value) })} /></label></div>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); await wait(); try { setBefore(measureLoudness(audio)); setAfter(null); } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo medir"); } finally { setBusy(false); } }}><Gauge />Medir</Button>
      <Button disabled={busy} onClick={async () => { setBusy(true); await wait(); try {
        const r = normalizeLoudness(audio, target); setBefore(r.before); setAfter(r.after); onPreview(r.audio);
        await mutate(async (c) => { const bytes = encodeWav(r.audio); await c.assets.put(pid, (async function* () { yield bytes; })(), { kind: "audio", mime: "audio/wav", name: `${name.replace(/\.[^.]+$/, "")}-${target.lufs}LUFS.wav`, parentId, capability: "audio.local.loudness", params: { target, before: r.before, after: r.after } }); });
        toast[r.reachedTarget ? "success" : "warning"](r.reachedTarget ? "Normalizado y guardado cifrado." : "Guardado, pero el limitador no permitió alcanzar el objetivo exacto.");
      } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo normalizar"); } finally { setBusy(false); } }}><Save />Normalizar y guardar</Button>
    </div>
    {busy && <p className="text-xs text-muted-foreground">Analizando en el teléfono…</p>}
    <div className="grid gap-2 sm:grid-cols-2">{before && <Readout m={before} label="Antes" />}{after && <Readout m={after} label={`Después · objetivo ${target.lufs} LUFS / ${target.truePeak} dBTP`} />}</div>
    <p className="text-xs text-muted-foreground">Medición según ITU-R BS.1770-4 y EBU R128 con true-peak por sobremuestreo 4x, calculada en tu teléfono. No es una certificación de laboratorio.</p>
  </section>;
}
