import { useEffect, useState } from "react";
import { FileText, Download, Share2 } from "lucide-react";
import { shareContent } from "@/lib/device";
import type { ChatAttachment } from "@/lib/chat-attachments";
import { getCore } from "@/lib/core";
import { saveExport } from "@/lib/save-export";
import { Button } from "./ui/button";
import { toast } from "sonner";
export function ChatAttachmentPreview({ file }: { file: ChatAttachment }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!/^(image|audio|video)\//.test(file.mime)) return;
    let live = true, objectUrl = "";
    getCore().then((c) => c.assets.read(file.project_id, file.asset_id)).then((b) => { if (!live) return; objectUrl = URL.createObjectURL(new Blob([b as BlobPart], { type: file.mime })); setUrl(objectUrl); }).catch(() => {});
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.asset_id]);
  return <div className="mb-2 max-w-80 overflow-hidden rounded-lg border border-border/70 bg-card">
    {url && file.mime.startsWith("image/") && <img src={url} alt={file.name} className="max-h-72 w-full object-contain" />}
    {url && file.mime.startsWith("audio/") && <audio src={url} controls className="w-full p-2" aria-label={file.name} />}
    {url && file.mime.startsWith("video/") && <video src={url} controls playsInline className="max-h-72 w-full" aria-label={file.name} />}
    <div className="flex items-center gap-2 p-2"><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs">{file.name}</span><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Guardar ${file.name}`} title="Guardar como" onClick={async () => { if (!confirm("¿Guardar una copia sin cifrar?")) return; try { const c = await getCore(); await saveExport(c.assets.stream(file.project_id, file.asset_id), file.name, file.mime); } catch { toast.error("No se pudo guardar."); } }}><Download className="h-3.5 w-3.5" /></Button><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Compartir ${file.name}`} title="Compartir en…" onClick={async () => { try { const c = await getCore(); await shareContent({ file: { data: c.assets.stream(file.project_id, file.asset_id), name: file.name, mime: file.mime }, title: file.name }); } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) toast.error("No se pudo compartir."); } }}><Share2 className="h-3.5 w-3.5" /></Button></div>
  </div>;
}