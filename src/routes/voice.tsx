import { createFileRoute } from "@tanstack/react-router";
import { RealtimeVoice } from "@/components/RealtimeVoice";
export const Route = createFileRoute("/voice")({ head: () => ({ meta: [
  { title: "Conversación por voz — MI AI" }, { name: "description", content: "Voz bidireccional, transcripciones, interrupción y contexto autorizado por proyecto." }, { property: "og:title", content: "Conversación por voz — MI AI" }, { property: "og:description", content: "Sesiones de voz con modelos compatibles y control del micrófono." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: RealtimeVoice });