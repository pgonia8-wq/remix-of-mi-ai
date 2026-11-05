import { Star } from "lucide-react";
import { toast } from "sonner";
import { inputCls } from "@/components/AppShell";
import { useCoreMutate } from "@/lib/use-app";
import type { ModelWithCaps } from "@/lib/core/registry";

/** Functions a person usually wants to pin to one model. "Chat" also drives the agents and chat tools. */
export const DEFAULT_FUNCTIONS: [string, string][] = [
  ["chat", "Chat y agentes"], ["vision", "Ver imágenes"], ["image.generate", "Crear imágenes"], ["image.edit", "Editar imágenes"],
  ["video.generate", "Crear videos"], ["audio.tts", "Texto a voz"], ["audio.transcribe", "Transcribir audio"], ["speech.realtime", "Voz en tiempo real"],
  ["music.generate", "Música"], ["model3d.generate", "Modelos 3D"], ["embedding", "Buscar en documentos"], ["research.web", "Buscar en internet"],
];

/** One selector per function: "Automático" or a specific model. Every screen and the agents respect it. */
export function DefaultModels({ models }: { models: ModelWithCaps[] }) {
  const mutate = useCoreMutate();
  const usable = models.filter((m) => m.status === "active" && m.provider_enabled);
  const rows = DEFAULT_FUNCTIONS.map(([cap, label]) => ({ cap, label, options: usable.filter((m) => m.capabilities.includes(cap) || (cap === "chat" && m.capabilities.includes("chat.tools"))) })).filter((r) => r.options.length > 0);
  if (!rows.length) return null;
  return <section className="space-y-2 rounded-xl border bg-card p-3 text-sm">
    <div className="flex items-center gap-2"><Star className="h-4 w-4 text-primary" /><h2 className="font-semibold">Modelo predeterminado por función</h2></div>
    <p className="text-xs text-muted-foreground">Elige qué modelo usa MI AI para cada cosa. «Automático» elige el mejor verificado. El chat y los agentes también te dejan cambiarlo en cada uso.</p>
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((r) => {
        const current = r.options.find((m) => m.defaults?.includes(r.cap))?.id ?? "";
        return <label key={r.cap} className="block text-xs">{r.label}
          <select aria-label={`Modelo para ${r.label}`} className={inputCls} value={current} onChange={(e) => {
            const id = e.target.value || null;
            void mutate((c) => c.repo.registry.setDefaultModel(r.cap, id)).then(() => toast.success(id ? `${r.label}: usará ${r.options.find((m) => m.id === id)?.name}` : `${r.label}: automático`)).catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo guardar."));
          }}>
            <option value="">Automático</option>
            {r.options.map((m) => <option key={m.id} value={m.id}>{m.name} · {m.provider_name}</option>)}
          </select></label>;
      })}
    </div>
  </section>;
}
