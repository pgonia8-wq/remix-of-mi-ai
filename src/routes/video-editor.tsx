import { createFileRoute } from "@tanstack/react-router";
import { VideoEditor } from "@/components/VideoEditor";
export const Route = createFileRoute("/video-editor")({ head: () => ({ meta: [
  { title: "Editor de video — MI AI" }, { name: "description", content: "Recorta, ordena y une clips en Android; subtítulos y exportación MP4 local." }, { property: "og:title", content: "Editor de video — MI AI" }, { property: "og:description", content: "Línea de tiempo, subtítulos y transformación local con originales cifrados." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: VideoEditor });