import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { startRecording } from "@/lib/recorder";
import { Button } from "@/components/ui/button";

/** Tap to record, tap again to stop. Calls onAudio with the recording. */
export function RecordButton({ onAudio, disabled, label = "Grabar" }: { onAudio: (blob: Blob) => void; disabled?: boolean; label?: string }) {
  const [rec, setRec] = useState<{ stop: () => void } | null>(null);
  const [secs, setSecs] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { rec?.stop(); if (timer.current) clearInterval(timer.current); }, [rec]);
  async function toggle() {
    if (rec) { rec.stop(); return; }
    try {
      const r = await startRecording((blob) => {
        setRec(null); if (timer.current) clearInterval(timer.current);
        if (blob.size < 1000) { toast.error("Grabación demasiado corta."); return; }
        onAudio(blob);
      }, (m) => toast.error(m));
      setSecs(0); timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
      setRec(r);
    } catch (e) { toast.error((e as Error).message); }
  }
  return (
    <Button type="button" variant={rec ? "destructive" : "outline"} size="sm" disabled={disabled && !rec} onClick={toggle} aria-label={rec ? "Detener grabación" : label}>
      {rec ? <><Square /> {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</> : <><Mic /> {label}</>}
    </Button>
  );
}
