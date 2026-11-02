import { useMemo, useState } from "react";
import { Languages, Mic2, Trash2, Upload, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { useCoreMutate, useCoreQuery } from "@/lib/use-app";
import { getCore } from "@/lib/core";
import { route, type RouteMode } from "@/lib/core/router";
import { credentialsFor, execute } from "@/lib/core/executor";
import { getAdapter } from "@/lib/core/adapters";
import { AUDIO_IN_MIME, AUDIO_MAX_BYTES, TTS_MAX_CHARS } from "@/lib/core/adapters/audio";
import { voices } from "@/lib/core/voices";
import { extForAudio } from "@/lib/recorder";
import { RecordButton } from "@/components/RecordButton";
import { inputCls } from "@/components/AppShell";
import { Button } from "@/components/ui/button";

type Cap = "audio.tts" | "audio.transcribe" | "audio.voice_clone";

async function storeAudio(projectId: string, blob: Blob, name: string) {
  const c = await getCore();
  const mime = blob.type.split(";")[0] || "audio/webm";
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const a = await c.assets.put(projectId, (async function* () { yield bytes; })(), { kind: "audio", mime, name });
  return { asset: a, bytes, mime };
}

export function AudioStudio({ projectId, cap }: { projectId: string; cap: Cap }) {
  const [mode, setMode] = useState<RouteMode>("auto");
  const [manual, setManual] = useState("");
  const { data: models = [] } = useCoreQuery(["models"], (c) => c.repo.registry.listModels());
  const effectiveCap = cap;
  const decision = useMemo(() => route(models, { capability: effectiveCap, mode, manualModelId: manual || null }), [models, effectiveCap, mode, manual]);
  const compatible = models.filter((m) => m.capabilities.includes(effectiveCap) && m.status === "active" && m.provider_enabled);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value as RouteMode)}>
          <option value="auto">Automático</option><option value="favorite">Favoritos</option><option value="manual">Manual</option>
        </select>
        {mode === "manual" && <select className={inputCls} value={manual} onChange={(e) => setManual(e.target.value)}><option value="">Elige modelo</option>{compatible.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
      </div>
      <p className={`text-xs ${decision.ok ? "text-muted-foreground" : "text-destructive"}`}>{decision.ok ? <>Modelo: <b>{decision.model.name}</b> — {decision.reasons.join(" · ")}</> : decision.reason}</p>
      {cap === "audio.tts" && <Tts projectId={projectId} decision={decision} />}
      {cap === "audio.transcribe" && <Transcribe projectId={projectId} models={models} mode={mode} manual={manual} />}
      {cap === "audio.voice_clone" && <Clone projectId={projectId} decision={decision} />}
    </div>
  );
}

type Decision = ReturnType<typeof route>;

function Tts({ projectId, decision }: { projectId: string; decision: Decision }) {
  const [text, setText] = useState("");
  const [voice, setVoice] = useState("");
  const [speed, setSpeed] = useState(1);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const mutate = useCoreMutate();
  const modelId = decision.ok ? decision.model.id : null;
  const { data: voiceList = [] } = useCoreQuery(["voices", projectId, modelId], async (c) => {
    if (!decision.ok) return [];
    const own = (await voices.list(c.repo.sql, projectId)).filter((v) => v.provider_id === decision.model.provider_id).map((v) => ({ id: v.voice_id, name: `${v.name} (tuya)` }));
    try {
      const { creds, adapter } = await credentialsFor(c.repo, decision.model.provider_id);
      const ad = getAdapter(adapter);
      return [...own, ...(ad.listVoices ? await ad.listVoices(creds) : [])];
    } catch { return own; }
  }, decision.ok);
  async function run() {
    if (!decision.ok) { toast.error(decision.reason); return; }
    setBusy(true);
    try {
      const c = await getCore();
      const r = await execute(c, projectId, decision.model, { capability: "audio.tts", prompt: text, params: { ...(voice ? { voice } : {}), ...(speed !== 1 ? { speed } : {}) } });
      const a = r.assets[0];
      if (a) { const b = await c.assets.read(projectId, a.id); setUrl(URL.createObjectURL(new Blob([b as BlobPart], { type: a.mime }))); }
      toast.success("Voz guardada cifrada en la Biblioteca");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); await mutate(async () => undefined); }
  }
  return (
    <div className="space-y-2">
      <textarea className={inputCls} rows={4} maxLength={TTS_MAX_CHARS} placeholder="Texto para convertir en voz" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="text-right text-[10px] text-muted-foreground">{text.length}/{TTS_MAX_CHARS}</p>
      <div className="flex gap-2">
        <select aria-label="Voz" className={inputCls} value={voice} onChange={(e) => setVoice(e.target.value)}><option value="">Voz predeterminada</option>{voiceList.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>
        <select aria-label="Velocidad" className={inputCls + " w-24"} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{[0.75, 1, 1.25, 1.5].map((s) => <option key={s} value={s}>×{s}</option>)}</select>
      </div>
      <Button className="w-full" disabled={busy || !decision.ok || !text.trim()} onClick={run}><Volume2 />{busy ? "Generando…" : "Generar voz"}</Button>
      {url && <audio controls src={url} className="w-full" />}
    </div>
  );
}

function Transcribe({ projectId, models, mode, manual }: { projectId: string; models: Parameters<typeof route>[0]; mode: RouteMode; manual: string }) {
  const [translate, setTranslate] = useState(false);
  const [language, setLanguage] = useState("es");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const mutate = useCoreMutate();
  const capability = translate ? "audio.translate" : "audio.transcribe";
  async function process(blob: Blob, name: string) {
    const d = route(models, { capability, mode, manualModelId: manual || null });
    if (!d.ok) { toast.error(d.reason); return; }
    const mime = blob.type.split(";")[0] ?? "";
    if (!AUDIO_IN_MIME.includes(mime)) { toast.error(`Formato no admitido: ${mime || "desconocido"}.`); return; }
    if (blob.size > AUDIO_MAX_BYTES) { toast.error("Audio demasiado grande (máximo 25 MB)."); return; }
    setBusy(true);
    try {
      const { asset, bytes } = await storeAudio(projectId, blob, name);
      const c = await getCore();
      const r = await execute(c, projectId, d.model, { capability, files: [{ bytes, mime, name }], params: translate ? {} : { language }, parentAssetId: asset.id, saveText: true });
      setText(r.text ?? "");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); await mutate(async () => undefined); }
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <label className="flex flex-1 items-center gap-1 text-xs"><input type="checkbox" checked={translate} onChange={(e) => setTranslate(e.target.checked)} /> <Languages className="h-3.5 w-3.5" /> Traducir al inglés</label>
        {!translate && <select aria-label="Idioma" className={inputCls + " w-28"} value={language} onChange={(e) => setLanguage(e.target.value)}>{[["es", "Español"], ["en", "Inglés"], ["pt", "Portugués"], ["fr", "Francés"], ["", "Detectar"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
      </div>
      {!translate && <p className="text-[10px] text-muted-foreground">Para traducir hace falta un modelo con la capacidad «audio.translate».</p>}
      <div className="flex gap-2">
        <RecordButton disabled={busy} onAudio={(b) => process(b, `grabacion-${new Date().toISOString().slice(0, 16)}.${extForAudio(b.type)}`)} />
        <label className="flex cursor-pointer items-center gap-1 rounded-md border px-3 text-xs"><Upload className="h-3.5 w-3.5" /> Archivo
          <input type="file" accept="audio/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) process(f, f.name); }} /></label>
      </div>
      {busy && <p className="text-xs text-primary">Transcribiendo…</p>}
      {text !== null && <p className="whitespace-pre-wrap rounded-lg border bg-background p-2 text-sm">{text}</p>}
      {text && <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success("Copiado"))}>Copiar texto</Button>}
    </div>
  );
}

function Clone({ projectId, decision }: { projectId: string; decision: Decision }) {
  const [name, setName] = useState("");
  const [samples, setSamples] = useState<{ blob: Blob; name: string }[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState(() => challengePhrase());
  const [live, setLive] = useState<Blob | null>(null);
  const [verified, setVerified] = useState<{ id: string; phrase: number; speaker: number; at: number } | null>(null);
  const [step, setStep] = useState("");
  const mutate = useCoreMutate();
  const { data: list = [] } = useCoreQuery(["voices", projectId], (c) => voices.list(c.repo.sql, projectId));
  const { data: models = [] } = useCoreQuery(["registry-models"], (c) => c.repo.registry.listModels());
  const transcriber = route(models, { capability: "audio.transcribe", mode: "auto" });
  const reset = () => { setVerified(null); setLive(null); setPhrase(challengePhrase()); };

  /** Live phrase → transcription must match; then every sample must sound like the live speaker (on-device). */
  async function verify() {
    if (!live) return;
    if (!transcriber.ok) { toast.error("Para verificar tu voz necesitas un modelo que transcriba audio (Modelos → audio.transcribe)."); return; }
    setBusy(true);
    try {
      const c = await getCore();
      setStep("Comprobando que leíste la frase…");
      const mime = live.type.split(";")[0] || "audio/webm";
      const t = await execute(c, projectId, transcriber.model, { capability: "audio.transcribe", files: [{ bytes: new Uint8Array(await live.arrayBuffer()), mime, name: `frase.${extForAudio(mime)}` }] });
      const pm = phraseMatch(phrase, t.text ?? "");
      if (!pm.ok) throw new Error(`La grabación no coincide con la frase (${Math.round(pm.score * 100)} %${pm.numberOk ? "" : ", falta el código"}). Léela completa y vuelve a intentar.`);
      setStep("Comparando tu voz con las muestras…");
      const { decodeAudio } = await import("@/lib/audio-edit");
      const { voiceprint, mono16k, compareVoiceprints } = await import("@/lib/media/voice-verify");
      const ref = voiceprint(mono16k(await decodeAudio(new Uint8Array(await live.arrayBuffer()))));
      let worst = 1;
      for (const sm of samples) {
        const r = compareVoiceprints(ref, voiceprint(mono16k(await decodeAudio(new Uint8Array(await sm.blob.arrayBuffer())))));
        worst = Math.min(worst, r.score);
        if (!r.ok) throw new Error(`La muestra «${sm.name}» no parece de la misma persona que leyó la frase (coincidencia ${Math.round(r.score * 100)} %). Usa solo grabaciones de tu propia voz.`);
      }
      const id = await verifications.record(c.repo.sql, projectId, { phrase, phraseScore: pm.score, speakerScore: worst, samples: samples.length });
      setVerified({ id, phrase: pm.score, speaker: worst, at: Date.now() });
      toast.success("Voz verificada: eres tú quien leyó la frase y las muestras coinciden.");
    } catch (e) { toast.error((e as Error).message); setLive(null); setPhrase(challengePhrase()); } finally { setBusy(false); setStep(""); }
  }

  async function run() {
    if (!decision.ok) { toast.error(decision.reason); return; }
    if (!consent) { toast.error("Confirma el consentimiento."); return; }
    if (!verified || Date.now() - verified.at > VERIFY_TTL_MS) { toast.error("Primero verifica tu voz con la frase en vivo."); reset(); return; }
    setBusy(true);
    try {
      const c = await getCore();
      const files = await Promise.all(samples.map(async (s) => ({ bytes: new Uint8Array(await s.blob.arrayBuffer()), mime: s.blob.type.split(";")[0] || "audio/webm", name: s.name })));
      const consentAt = Date.now();
      const r = await execute(c, projectId, decision.model, { capability: "audio.voice_clone", files, params: { name, consent: true, verificationId: verified.id } });
      await voices.add(c.repo.sql, projectId, { providerId: decision.model.provider_id, voiceId: r.text!, name, consentAt, verificationId: verified.id });
      toast.success(`Voz «${name}» creada. Ya aparece en «Voz».`);
      setName(""); setSamples([]); setConsent(false); reset();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); await mutate(async () => undefined); }
  }
  return (
    <div className="space-y-2">
      <input className={inputCls} placeholder="Nombre de la voz" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="flex flex-wrap gap-2">
        <RecordButton label="Grabar muestra" disabled={busy} onAudio={(b) => { setVerified(null); setSamples((s) => [...s, { blob: b, name: `muestra-${s.length + 1}.${extForAudio(b.type)}` }]); }} />
        <label className="flex cursor-pointer items-center gap-1 rounded-md border px-3 text-xs"><Upload className="h-3.5 w-3.5" /> Muestras
          <input type="file" accept="audio/*" multiple className="hidden" onChange={(e) => { setVerified(null); setSamples((s) => [...s, ...Array.from(e.target.files ?? []).map((f) => ({ blob: f as Blob, name: f.name }))]); }} /></label>
      </div>
      {samples.map((s, i) => <div key={i} className="flex items-center gap-2 text-xs"><span className="flex-1 truncate">{s.name} · {(s.blob.size / 1024).toFixed(0)} KB</span><button aria-label="Quitar" onClick={() => { setVerified(null); setSamples(samples.filter((_, j) => j !== i)); }}><Trash2 className="h-3.5 w-3.5" /></button></div>)}
      <p className="text-[10px] text-muted-foreground">Usa 1–3 minutos de voz clara, sin música. Las muestras se envían al proveedor; MI AI solo guarda el identificador de la voz.</p>
      <div className="space-y-2 rounded-lg border p-2">
        <p className="text-xs font-medium">Verificación: demuestra que la voz es tuya</p>
        <p className="text-xs text-muted-foreground">Graba ahora, en vivo, esta frase. Se comprueba que la leíste y que tu voz coincide con cada muestra. Nada se envía al proveedor hasta superar esto.</p>
        <p className="rounded-md bg-muted/50 p-2 text-sm font-medium">«{phrase}»</p>
        <div className="flex flex-wrap gap-2">
          <RecordButton label={live ? "Grabar de nuevo" : "Grabar la frase"} disabled={busy || !!verified} onAudio={(b) => { setLive(b); setVerified(null); }} />
          <Button size="sm" variant="ghost" disabled={busy} onClick={reset}>Otra frase</Button>
          <Button size="sm" variant="outline" disabled={busy || !live || !samples.length || !!verified} onClick={verify}><ShieldCheck />{busy && step ? step : "Verificar que es mi voz"}</Button>
        </div>
        {verified && <p className="text-xs text-primary">Verificada · frase {Math.round(verified.phrase * 100)} % · coincidencia de voz {Math.round(verified.speaker * 100)} %. Válida 15 minutos y una sola vez.</p>}
        {!transcriber.ok && <p className="text-xs text-destructive">Falta un modelo que transcriba audio para verificar la frase.</p>}
        <p className="text-[10px] text-muted-foreground">La comparación se hace en tu teléfono con rasgos acústicos (timbre y tono). Es una comprobación fuerte, no una prueba forense.</p>
      </div>
      <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Confirmo que la voz es mía o que tengo permiso explícito de su dueño para clonarla.</label>
      <Button className="w-full" disabled={busy || !decision.ok || !consent || !name.trim() || !samples.length || !verified} onClick={run}><Mic2 />{busy && !step ? "Creando…" : "Clonar voz"}</Button>
      {list.length > 0 && <div className="space-y-1 border-t pt-2"><p className="text-xs font-medium">Tus voces</p>
        {list.map((v) => <div key={v.id} className="flex items-center gap-2 text-xs"><span className="flex-1">{v.name} · consentimiento {new Date(v.consent_at).toLocaleDateString()}</span>
          <button aria-label="Quitar voz" onClick={() => confirm("¿Quitar esta voz de MI AI? (No se borra en el proveedor)") && mutate((c) => voices.remove(c.repo.sql, projectId, v.id))}><Trash2 className="h-3.5 w-3.5" /></button></div>)}
      </div>}
    </div>
  );
}
