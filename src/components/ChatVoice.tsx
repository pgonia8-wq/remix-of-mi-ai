import { useEffect, useRef, useState } from "react";
import { Loader2, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { getCore } from "@/lib/core";
import { route } from "@/lib/core/router";
import { execute } from "@/lib/core/executor";
import { TTS_MAX_CHARS } from "@/lib/core/adapters/audio";
import { extForAudio } from "@/lib/recorder";
import { RecordButton } from "@/components/RecordButton";
import { Button } from "./ui/button";

/** Dictation: the recording is sent to the transcription model and only the text is kept (audio is not stored). */
export function DictateButton({ projectId, onText }: { projectId: string; onText: (t: string) => void }) {
  const [busy, setBusy] = useState(false);
  async function handle(blob: Blob) {
    setBusy(true);
    try {
      const c = await getCore();
      const d = route(await c.repo.registry.listModels(), { capability: "audio.transcribe", mode: "auto" });
      if (!d.ok) { toast.error(d.reason); return; }
      const mime = blob.type.split(";")[0] || "audio/webm";
      const r = await execute(c, projectId, d.model, { capability: "audio.transcribe", files: [{ bytes: new Uint8Array(await blob.arrayBuffer()), mime, name: `dictado.${extForAudio(mime)}` }] });
      if (r.text?.trim()) onText(r.text.trim());
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  }
  return busy ? <span className="flex items-center px-2" aria-label="Transcribiendo"><Loader2 className="h-4 w-4 animate-spin" /></span> : <RecordButton label="" onAudio={handle} />;
}

/** Read an answer aloud with the TTS model; the audio is saved encrypted in the Library. */
export function SpeakButton({ projectId, text }: { projectId: string; text: string }) {
  const [state, setState] = useState<"idle" | "busy" | "playing">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const objectUrl = useRef("");
  useEffect(() => () => { audio.current?.pause(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);
  async function speak() {
    if (state === "playing") { audio.current?.pause(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = ""; setState("idle"); return; }
    setState("busy");
    try {
      const c = await getCore();
      const d = route(await c.repo.registry.listModels(), { capability: "audio.tts", mode: "auto" });
      if (!d.ok) { toast.error(d.reason); setState("idle"); return; }
      const r = await execute(c, projectId, d.model, { capability: "audio.tts", prompt: text.slice(0, TTS_MAX_CHARS) });
      const a = r.assets[0];
      if (!a) throw new Error("Sin audio.");
      const bytes = await c.assets.read(projectId, a.id);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: a.mime }));
      objectUrl.current = url;
      const el = new Audio(url);
      audio.current = el;
      el.onended = () => { setState("idle"); URL.revokeObjectURL(url); };
      await el.play();
      setState("playing");
    } catch (e) { toast.error((e as Error).message); setState("idle"); }
  }
  return (
    <Button variant="ghost" size="icon" disabled={state === "busy"} onClick={speak} aria-label={state === "playing" ? "Detener lectura" : "Leer en voz alta"} title={state === "playing" ? "Detener lectura" : "Leer en voz alta"} className="h-8 w-8 text-muted-foreground">
      {state === "busy" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : state === "playing" ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
    </Button>
  );
}
