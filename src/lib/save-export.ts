import { toast } from "sonner";
import { isNative } from "@/lib/app-db";

/** Saves an exported (unencrypted, user-requested) file to Documents/MI AI on Android, or downloads it in the preview. */
export async function saveExport(bytes: Uint8Array, name: string, mime: string) {
  if (isNative()) {
    const { Filesystem, Directory } = await import("@capacitor/filesystem");
    let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await Filesystem.writeFile({ path: `MI AI/${name}`, data: btoa(s), directory: Directory.Documents, recursive: true });
    toast.success(`Exportado a Documentos/MI AI/${name}`);
  } else {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime })); a.download = name; a.click();
  }
}
