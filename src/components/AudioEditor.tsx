import { useEffect, useRef, useState } from "react";
import { Save, Scissors, Upload, X, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { inputCls, NeedProject } from "./AppShell";
import { useActiveProjectId, useCoreMutate } from "@/lib/use-app";
import { decodeAudio, editPcm, mixPcm, encodeWav, type PcmAudio, type AudioEdit } from "@/lib/audio-edit";
import { getCore } from "@/lib/core";
import { DEFAULT_MASTER, masterPcm, audioMeter, type MasterSettings } from "@/lib/media/mastering";
import { PcMediaPanel } from "./PcMediaPanel";
type Track = { id: string; name: string; audio: PcmAudio; offset: number; gain: number };
export function AudioEditor() { const pid = useActiveProjectId(); return pid ? <Editor pid={pid} key={pid} /> : <NeedProject />; }
function Editor({ pid }: { pid: string }) {
  const [tracks, setTracks] = useState<Track[]>([]), [selected, setSelected] = useState(0), [busy, setBusy] = useState(false), [url, setUrl] = useState("");
  const [edit, setEdit] = useState<AudioEdit>({ start: 0, end: 0, gain: 1, fadeIn: 0, fadeOut: 0, normalize: false });
  const upload = useRef<HTMLInputElement | null>(null), mutate = useCoreMutate(), objectUrl = useRef("");
  const [master,setMaster]=useState<MasterSettings>(structuredClone(DEFAULT_MASTER)), [meter,setMeter]=useState("");
  const track = tracks[selected], duration = track ? (track.audio.channels[0]?.length ?? 0) / track.audio.sampleRate : 0;
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);
  function preview(audio: PcmAudio) { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = URL.createObjectURL(new Blob([encodeWav(audio) as BlobPart], { type: "audio/wav" })); setUrl(objectUrl.current); }
  async function importFiles(files: File[]) {
    setBusy(true);
    try {
      const core = await getCore(), additions: Track[] = [];
      for (const file of files.slice(0, 4 - tracks.length)) {
        if (file.size > 25 * 1024 * 1024) throw new Error("Máximo 25 MB por pista.");
        const bytes = new Uint8Array(await file.arrayBuffer()), audio = await decodeAudio(bytes);
        const asset = await core.assets.put(pid, (async function* () { yield bytes; })(), { kind: "audio", mime: file.type || "audio/wav", name: file.name, capability: "audio.local.source" });
        additions.push({ id: asset.id, name: file.name, audio, offset: 0, gain: 1 });
      }
      const next = [...tracks, ...additions]; setTracks(next);
      if (!tracks.length && next[0]) { setEdit({ ...edit, end: (next[0].audio.channels[0]?.length ?? 0) / next[0].audio.sampleRate }); preview(next[0].audio); }
      await mutate(async () => undefined);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Audio no válido."); } finally { setBusy(false); }
  }
  async function output(mix: boolean, save: boolean) {
    setBusy(true);
    try {
      if (!track) return;
      const audio = mix ? mixPcm(tracks.map((t) => ({ audio: t.audio, offset: t.offset, gain: t.gain }))) : editPcm(track.audio, edit); preview(audio);
      if (save) await mutate(async (c) => {
        const bytes = encodeWav(audio);
        await c.assets.put(pid, (async function* () { yield bytes; })(), { kind: "audio", mime: "audio/wav", name: mix ? "Mezcla.wav" : track.name.replace(/\.[^.]+$/, "") + "-editado.wav", parentId: track.id, capability: mix ? "audio.local.mix" : "audio.local.edit", params: mix ? { tracks: tracks.map(({ id, offset, gain }) => ({ id, offset, gain })) } : edit });
        toast.success("Nueva versión cifrada en Biblioteca.");
      });
    } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo procesar."); } finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6"><div className="flex items-center justify-between"><div><p className="mb-1 text-xs text-primary">ESTUDIO LOCAL</p><h1 className="text-2xl font-semibold">Editor de audio</h1></div><Button variant="outline" disabled={busy || tracks.length >= 4} onClick={() => upload.current?.click()}><Upload />Pistas</Button></div>
    <input ref={upload} type="file" accept="audio/*" multiple aria-label="Importar pistas de audio" className="hidden" onChange={(e) => { importFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    {tracks.map((t, index) => <div key={t.id} className={`space-y-3 rounded-lg border p-4 ${selected === index ? "border-primary/50 bg-primary/5" : "bg-card"}`}><div className="flex items-center gap-3"><Button variant="ghost" className="min-w-0 flex-1 justify-start truncate" onClick={() => { setSelected(index); setEdit({ ...edit, start: 0, end: (t.audio.channels[0]?.length ?? 0) / t.audio.sampleRate }); preview(t.audio); }}>{t.name}</Button><Button size="icon" variant="ghost" aria-label={`Quitar pista ${index + 1}`} onClick={() => { setTracks(tracks.filter((_, i) => i !== index)); setSelected(0); }}><X /></Button></div>
      <div role="img" aria-label={`Forma de onda de ${t.name}`} className="flex h-14 items-center gap-px overflow-hidden">{Array.from({ length: 80 }, (_, i) => { const ch = t.audio.channels[0]; const step = Math.max(1, Math.floor((ch?.length ?? 1) / 80)); let peak = 0; for (let n = i * step; n < (i + 1) * step; n += Math.max(1, Math.floor(step / 100))) peak = Math.max(peak, Math.abs(ch?.[n] ?? 0)); return <meter key={i} min={0} max={1} value={peak} className="h-10 min-w-0 flex-1" />; })}</div>
      <div className="grid grid-cols-2 gap-3"><label className="text-xs">Entrada en mezcla (s)<input className={inputCls} type="number" min={0} step={0.1} value={t.offset} onChange={(e) => setTracks(tracks.map((x, i) => i === index ? { ...x, offset: Number(e.target.value) } : x))} /></label><label className="text-xs">Volumen de pista<input type="range" min={0} max={2} step={0.05} value={t.gain} className="mt-3 w-full accent-primary" onChange={(e) => setTracks(tracks.map((x, i) => i === index ? { ...x, gain: Number(e.target.value) } : x))} /></label></div>
    </div>)}
    {track && <><section className="space-y-4 border-t pt-5"><h2 className="flex items-center gap-2 font-semibold"><Scissors className="h-4 w-4 text-primary" />Recorte · {duration.toFixed(2)} s</h2><div className="grid grid-cols-2 gap-3">{[{ key: "start", label: "Inicio (s)" }, { key: "end", label: "Fin (s)" }, { key: "fadeIn", label: "Fundido de entrada (s)" }, { key: "fadeOut", label: "Fundido de salida (s)" }].map((p) => <label className="text-xs" key={p.key}>{p.label}<input aria-label={p.label} className={inputCls} type="number" min={0} max={duration} step={0.1} value={edit[p.key as keyof AudioEdit] as number} onChange={(e) => setEdit({ ...edit, [p.key]: Number(e.target.value) })} /></label>)}</div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.normalize} onChange={(e) => setEdit({ ...edit, normalize: e.target.checked })} />Normalizar nivel</label><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={() => output(false, false)}>Escuchar recorte</Button><Button disabled={busy} onClick={() => output(false, true)}><Save />Guardar WAV</Button>{tracks.length > 1 && <Button variant="outline" disabled={busy} onClick={() => output(true, true)}><SlidersHorizontal />Mezclar pistas</Button>}</div></section>{url && <audio controls src={url} className="w-full" />}</>}
    {track && <section className="space-y-4 border-t pt-5"><h2 className="font-semibold">Masterización</h2><h3 className="text-sm">EQ paramétrico</h3>{master.eq.map((band,i)=><div className="grid grid-cols-3 gap-2" key={i}>{(["frequency","gain","q"] as const).map((key,j)=><label className="text-xs" key={key}>{["Hz","Ganancia dB","Q"][j]}<input aria-label={`EQ ${i+1} ${key}`} className={inputCls} type="number" step={0.1} value={band[key]} onChange={e=>setMaster({...master,eq:master.eq.map((b,n)=>n===i?{...b,[key]:Number(e.target.value)}:b)})}/></label>)}</div>)}<h3 className="text-sm">Compresión multibanda</h3>{master.bands.map((band,i)=><div className="grid grid-cols-2 gap-2" key={i}><p className="col-span-2 text-xs text-primary">{["Graves","Medios","Agudos"][i]}</p>{(["threshold","ratio","attack","release"] as const).map((key,j)=><label className="text-xs" key={key}>{["Umbral dB","Ratio","Ataque s","Liberación s"][j]}<input aria-label={`Compresor ${i+1} ${key}`} className={inputCls} type="number" step={0.01} value={band[key]} onChange={e=>setMaster({...master,bands:master.bands.map((b,n)=>n===i?{...b,[key]:Number(e.target.value)}:b)})}/></label>)}</div>)}<div className="grid grid-cols-2 gap-2"><label className="text-xs">Ganancia final dB<input aria-label="Ganancia master" className={inputCls} type="number" min={-24} max={24} value={master.gainDb} onChange={e=>setMaster({...master,gainDb:Number(e.target.value)})}/></label><label className="text-xs">Techo de pico dBFS<input aria-label="Techo limitador" className={inputCls} type="number" min={-12} max={0} step={0.1} value={master.ceilingDb} onChange={e=>setMaster({...master,ceilingDb:Number(e.target.value)})}/></label></div><Button disabled={busy} onClick={async()=>{setBusy(true);try{const audio=await masterPcm(track.audio,master);preview(audio);const m=audioMeter(audio);setMeter(`Pico ${m.samplePeakDb.toFixed(1)} dBFS · RMS ${m.rmsDb.toFixed(1)} dBFS`);await mutate(async c=>{const bytes=encodeWav(audio);await c.assets.put(pid,(async function*(){yield bytes;})(),{kind:"audio",mime:"audio/wav",name:track.name+"-master.wav",parentId:track.id,capability:"audio.local.master",params:master});});toast.success("Master cifrado guardado.");}catch(e){toast.error(e instanceof Error?e.message:"No se pudo masterizar");}finally{setBusy(false);}}}><Save/>Procesar y guardar master</Button>{meter&&<p className="text-xs text-muted-foreground">{meter}</p>}<PcMediaPanel pid={pid} kind="stems" assetIds={[track.id]}/></section>}
    {!tracks.length && <div className="border-y py-12 text-center text-sm text-muted-foreground">Sin pistas en este estudio.</div>}
  </div>;
}