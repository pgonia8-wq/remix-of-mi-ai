import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Button } from "./ui/button";
import { getCore } from "@/lib/core";
import { frameAt, overlayAt, segments, type TClip, type TOverlay } from "@/lib/media/timeline";

type Caption = { start: number; end: number; text: string };
/** Real-time composite preview on a canvas: clips, transitions, PiP keyframes and captions. Muted and
 *  approximate in timing; the final render is still produced by Android Media3 or FFmpeg on the PC. */
export function VideoPreview({ pid, clips, overlays, captions, ratio, rotation, time, onTime }: { pid: string; clips: TClip[]; overlays: TOverlay[]; captions: Caption[]; ratio: string; rotation: number; time: number; onTime: (t: number) => void }) {
  const canvas = useRef<HTMLCanvasElement | null>(null), videos = useRef(new Map<string, HTMLVideoElement>()), urls = useRef(new Map<string, string>());
  const [playing, setPlaying] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(""), state = useRef({ time, playing, clips, overlays, captions, ratio, rotation });
  state.current = { ...state.current, clips, overlays, captions, ratio, rotation };
  if (!playing) state.current.time = time;
  const ids = [...new Set([...clips.map((c) => c.assetId), ...overlays.map((o) => o.assetId)])].join(",");
  useEffect(() => {
    let cancelled = false; setLoading(true); setError("");
    (async () => {
      const core = await getCore();
      for (const id of ids.split(",").filter(Boolean)) {
        if (videos.current.has(id)) continue;
        const meta = await core.assets.get(pid, id); if (!meta) continue;
        const bytes = await core.assets.read(pid, id); if (cancelled) return;
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: meta.mime || "video/mp4" })), v = document.createElement("video");
        v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url; urls.current.set(id, url); videos.current.set(id, v);
      }
      for (const [id, v] of videos.current) if (!ids.split(",").includes(id)) { v.pause(); v.removeAttribute("src"); v.load(); URL.revokeObjectURL(urls.current.get(id)!); videos.current.delete(id); urls.current.delete(id); }
    })().catch((e) => setError(e instanceof Error ? e.message : "No se pudo preparar la vista previa")).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ids, pid]);
  useEffect(() => () => { for (const [id, v] of videos.current) { v.pause(); v.removeAttribute("src"); v.load(); URL.revokeObjectURL(urls.current.get(id)!); } videos.current.clear(); urls.current.clear(); }, []);
  useEffect(() => {
    let raf = 0, last = performance.now(), reported = 0;
    const css = getComputedStyle(document.documentElement), bg = css.getPropertyValue("--background").trim() || "black", fg = css.getPropertyValue("--foreground").trim() || "white", accent = css.getPropertyValue("--primary").trim() || "white";
    const sync = (v: HTMLVideoElement, local: number, play: boolean) => { if (v.readyState < 1) return; if (Math.abs(v.currentTime - local) > (play ? 0.3 : 0.04)) v.currentTime = Math.max(0, local); if (play && v.paused) v.play().catch(() => {}); if (!play && !v.paused) v.pause(); };
    const draw = (now: number) => {
      const s = state.current, c = canvas.current, ctx = c?.getContext("2d");
      const { duration } = segments(s.clips);
      if (s.playing) { s.time += (now - last) / 1000; if (s.time >= duration) { s.time = duration; s.playing = false; setPlaying(false); } if (now - reported > 150) { onTime(s.time); reported = now; } }
      last = now;
      if (c && ctx) {
        const first = videos.current.get(s.clips[0]?.assetId ?? ""), portrait = s.ratio === "9:16" || (s.ratio === "original" && first && first.videoHeight > first.videoWidth);
        const W = portrait ? 360 : 640, H = portrait ? 640 : 360;
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
        ctx.save(); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        // Like the FFmpeg plan: each clip is rotated, then letterboxed into the fixed output frame.
        const fit = (v: HTMLVideoElement, x: number, y: number, w: number, h: number) => { if (!v.videoWidth) return; const side = s.rotation === 90 || s.rotation === 270, sw = side ? v.videoHeight : v.videoWidth, sh = side ? v.videoWidth : v.videoHeight, k = Math.min(w / sw, h / sh); ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(s.rotation * Math.PI / 180); ctx.drawImage(v, -v.videoWidth * k / 2, -v.videoHeight * k / 2, v.videoWidth * k, v.videoHeight * k); ctx.restore(); };
        const f = frameAt(s.clips, s.time), used = new Set<HTMLVideoElement>();
        if (f) {
          const va = videos.current.get(s.clips[f.a.seg.index]!.assetId), vb = f.b ? videos.current.get(s.clips[f.b.seg.index]!.assetId) : undefined;
          if (va) { sync(va, f.a.local, s.playing); used.add(va); } if (vb && f.b) { sync(vb, f.b.local, s.playing); used.add(vb); }
          const p = f.progress, kind = f.b?.seg.transition ?? "cut";
          if (va && (!vb || kind !== "slideright")) fit(va, 0, 0, W, H);
          if (vb) {
            ctx.save();
            if (kind === "fade") { ctx.globalAlpha = p; fit(vb, 0, 0, W, H); }
            else if (kind === "wipeleft") { ctx.beginPath(); ctx.rect(W * (1 - p), 0, W * p, H); ctx.clip(); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); fit(vb, 0, 0, W, H); }
            else if (kind === "slideright") { if (va) fit(va, W * p, 0, W, H); fit(vb, -W + W * p, 0, W, H); }
            else if (kind === "circleopen") { ctx.beginPath(); ctx.arc(W / 2, H / 2, p * Math.hypot(W, H) / 2, 0, Math.PI * 2); ctx.clip(); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); fit(vb, 0, 0, W, H); }
            else fit(vb, 0, 0, W, H);
            ctx.restore();
          }
        }
        for (const o of s.overlays) { const v = videos.current.get(o.assetId), at = overlayAt(o, s.time); if (!v || !at || !v.videoWidth) continue; const src = s.clips.find((c) => c.assetId === o.assetId); sync(v, (src?.start ?? 0) + at.local, s.playing); used.add(v); const w = W * at.scale, h = w * v.videoHeight / v.videoWidth, x = (W - w) * at.x, y = (H - h) * at.y; ctx.drawImage(v, x, y, w, h); ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h); }
        const cap = s.captions.find((c) => s.time >= c.start && s.time <= c.end && c.text.trim());
        if (cap) { ctx.font = `600 ${Math.round(H / 18)}px "DM Sans", sans-serif`; ctx.textAlign = "center"; const tw = ctx.measureText(cap.text).width; ctx.globalAlpha = 0.6; ctx.fillStyle = bg; ctx.fillRect(W / 2 - tw / 2 - 10, H - H / 9 - H / 18, tw + 20, H / 14); ctx.globalAlpha = 1; ctx.fillStyle = fg; ctx.fillText(cap.text, W / 2, H - H / 9); }
        ctx.restore();
        for (const v of videos.current.values()) if (!used.has(v) && !v.paused) v.pause();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [onTime]);
  const { duration } = segments(clips);
  return <section className="space-y-2" aria-label="Vista previa compuesta">
    <canvas ref={canvas} className="mx-auto block max-h-[60vh] w-full rounded-xl border bg-card object-contain" aria-label="Vista previa del video" />
    <div className="flex items-center gap-2"><Button size="icon" variant="outline" disabled={!clips.length || loading} aria-label={playing ? "Pausar vista previa" : "Reproducir vista previa"} onClick={() => { const s = state.current; if (!playing && s.time >= duration - 0.05) s.time = 0; s.playing = !playing; setPlaying(!playing); if (playing) onTime(s.time); }}>{playing ? <Pause /> : <Play />}</Button><span className="text-xs text-muted-foreground">{loading ? "Preparando clips…" : "Vista previa sin audio, calculada en el teléfono. El render final se hace al exportar."}</span></div>
    {error && <p className="text-xs text-destructive">{error}</p>}
  </section>;
}
