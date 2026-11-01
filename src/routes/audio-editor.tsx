import { createFileRoute } from "@tanstack/react-router";
import { AudioEditor } from "@/components/AudioEditor";
export const Route = createFileRoute("/audio-editor")({ head: () => ({ meta: [
  { title: "Editor de audio — MI AI" }, { name: "description", content: "Recorte, fundidos, normalización, mezcla local de pistas y versiones WAV cifradas." },
  { property: "og:title", content: "Editor de audio — MI AI" }, { property: "og:description", content: "Procesamiento musical local sin enviar archivos a un servidor." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: AudioEditor });