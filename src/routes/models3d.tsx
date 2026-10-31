import { createFileRoute } from "@tanstack/react-router";
import { MediaStudio } from "@/components/MediaStudio";
export const Route = createFileRoute("/models3d")({ head: () => ({ meta: [
  { title: "Modelos 3D — MI AI" }, { name: "description", content: "Texto e imágenes a modelos GLB, visor interactivo y biblioteca cifrada." },
  { property: "og:title", content: "Modelos 3D — MI AI" }, { property: "og:description", content: "Genera, inspecciona y exporta modelos 3D por proyecto." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: () => <MediaStudio kind="model3d" /> });