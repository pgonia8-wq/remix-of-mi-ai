import { useEffect, useState } from "react";
import { FileText, Download } from "lucide-react";
import type { ChatAttachment } from "@/lib/chat-attachments";
import { getCore } from "@/lib/core";
import { saveExport } from "@/lib/save-export";
import { Button } from "./ui/button";
import { toast } from "sonner";
export function ChatAttachmentPreview({ file }: { file: ChatAttachment }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!file.mime.startsWith("image/")) return;
    let live = true, objectUrl = "";
    getCore().then((c) => c.assets.read(file.project_id, file.asset_id)).then((b) => { if (!live) return; objectUrl = URL.createObjectURL(new Blob([b as BlobPart], { type: file.mime })); setUrl(objectUrl); }).catch(() => {});
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.asset_id]);
  return <div className="mb-2 max-w-64 overflow-hidden rounded-lg border border-border/70 bg-card">
    {url && <img src={url} alt={file.name} className="max-h-56 w-full object-contain" />}
    <div className="flex items-center gap-2 p-2"><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-xs">{file.name}</span><Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Descargar ${file.name}`} title="Descargar archivo" onClick={async () => { if (!confirm("¿Exportar una copia sin cifrar?")) return; try { const c = await getCore(); await saveExport(await c.assets.read(file.project_id, file.asset_id), file.name, file.mime); } catch { toast.error("No se pudo exportar."); } }}><Download className="h-3.5 w-3.5" /></Button></div>
  </div>;
}