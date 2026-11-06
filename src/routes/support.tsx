import { createFileRoute } from "@tanstack/react-router";
import { LifeBuoy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useCoreQuery, useCoreMutate } from "@/lib/use-app";
import { APP_NAME, APP_VERSION, SUPPORT_EMAIL } from "@/lib/app-info";

export const Route = createFileRoute("/support")({
  head: () => ({
    meta: [
      { title: "Soporte, privacidad y términos — MI AI" },
      { name: "description", content: "Contacto, política de privacidad, términos de uso, versión y registro local de fallos de MI AI." },
      { property: "og:title", content: "Soporte, privacidad y términos — MI AI" },
      { property: "og:description", content: "Cómo MI AI trata tus datos, términos de uso y contacto de soporte." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Support,
});

function Support() {
  const { data: crashes = [] } = useCoreQuery(["crash-log"], (c) => c.repo.listCrashes());
  const mutate = useCoreMutate();
  const exportLog = async () => {
    const text = crashes.map((c) => `${new Date(c.at).toISOString()}\n${c.message}`).join("\n\n---\n\n") || "Sin fallos registrados.";
    const { shareContent } = await import("@/lib/device");
    await shareContent({ text: `${APP_NAME} ${APP_VERSION}\n\n${text}`, title: "Registro de fallos de MI AI" }).catch(() => navigator.clipboard?.writeText(text).then(() => toast.success("Registro copiado")));
  };
  return <section className="mx-auto max-w-3xl space-y-6 p-4">
    <h1 className="flex items-center gap-2 font-display text-2xl"><LifeBuoy className="h-6 w-6 text-primary" />Soporte y legal</h1>
    <div className="rounded-md border p-4 text-sm"><p><b>{APP_NAME}</b> versión {APP_VERSION}</p><p className="mt-1">Contacto: <a className="text-primary underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p></div>
    <article className="space-y-2 text-sm leading-6">
      <h2 className="text-lg font-medium">Política de privacidad</h2>
      <p>MI AI no tiene servidor propio ni cuentas. Tus proyectos, conversaciones, archivos y la configuración de modelos se guardan cifrados solo en tu dispositivo.</p>
      <p>Cuando usas un modelo, el texto, los archivos y el contexto que envías van directamente desde tu dispositivo al proveedor que configuraste (por ejemplo Azure, OpenAI u otros), usando tus propias claves. Ese proveedor los trata según su propia política.</p>
      <p>Tus claves se guardan cifradas con el almacén seguro del sistema y nunca se incluyen en respaldos, transferencias ni reportes. MI AI no recoge analítica, publicidad ni datos de uso. El registro de fallos se queda en el dispositivo y solo sale si tú lo compartes.</p>
      <p>Puedes borrar cualquier proyecto o desinstalar la app para eliminar todos los datos.</p>
      <h2 className="pt-2 text-lg font-medium">Términos de uso</h2>
      <p>MI AI es una herramienta que conecta con proveedores de IA que tú eliges. Eres responsable del uso que haces de las respuestas y de cumplir los términos y costos de tus proveedores. Las respuestas de IA pueden ser incorrectas: verifica la información importante.</p>
      <p>No uses MI AI para crear contenido ilegal, que dañe a otras personas o que infrinja derechos. Puedes reportar cualquier respuesta inapropiada con el botón de bandera de cada mensaje.</p>
    </article>
    <div className="space-y-2 rounded-md border p-4 text-sm">
      <h2 className="font-medium">Registro local de fallos</h2>
      <p className="text-muted-foreground">{crashes.length ? `${crashes.length} fallos guardados (sin claves ni contraseñas).` : "Sin fallos registrados."}</p>
      <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void exportLog()}>Compartir registro</Button><Button size="sm" variant="ghost" disabled={!crashes.length} onClick={() => mutate((r) => r.clearCrashes())}>Borrar</Button></div>
    </div>
  </section>;
}
