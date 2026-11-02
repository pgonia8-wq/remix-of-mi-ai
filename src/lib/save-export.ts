import { toast } from "sonner";
import { saveAs, type Bytesish } from "@/lib/device";

/** Saves an exported (unencrypted, user-requested) file where the person chooses ("Guardar como"). */
export async function saveExport(data: Bytesish, name: string, mime: string) {
  const r = await saveAs(data, name, mime);
  if (r === "saved") toast.success(`Guardado: ${name}`);
  else if (r === "documents") toast.success(`Guardado en Documentos/MI AI/${name}`);
  else if (r === "cancelled") toast("No se guardó el archivo.");
  return r;
}
