import { createFileRoute, Link } from "@tanstack/react-router";
import { MediaStudio } from "@/components/MediaStudio";
export const Route = createFileRoute("/video")({ head: () => ({ meta: [
  { title: "Video — MI AI" }, { name: "description", content: "Generación y transformación de video con trabajos recuperables y archivos cifrados." },
  { property: "og:title", content: "Video — MI AI" }, { property: "og:description", content: "Texto e imágenes a video mediante proveedores compatibles." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: () => <><div className="px-4 pt-3"><Link to="/video-editor" className="text-sm text-primary underline">Abrir editor de video</Link></div><MediaStudio kind="video" /></> });