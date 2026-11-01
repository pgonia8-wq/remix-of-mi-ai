import { createFileRoute, Link } from "@tanstack/react-router";
import { MediaStudio } from "@/components/MediaStudio";
export const Route = createFileRoute("/music")({ head: () => ({ meta: [
  { title: "Música y sonido — MI AI" }, { name: "description", content: "Composiciones musicales, efectos sonoros y versiones cifradas por proyecto." },
  { property: "og:title", content: "Música y sonido — MI AI" }, { property: "og:description", content: "Música y efectos con tus proveedores, derechos y formatos registrados." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: () => <><div className="px-4 pt-3"><Link to="/audio-editor" className="text-sm text-primary underline">Abrir editor de audio</Link></div><MediaStudio kind="music" /></> });