import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CadStudio } from "@/components/CadStudio";
import { MeshRigStudio } from "@/components/MeshRigStudio";
import { MediaStudio } from "@/components/MediaStudio";
export const Route = createFileRoute("/models3d")({ head: () => ({ meta: [
  { title: "Modelos 3D — MI AI" }, { name: "description", content: "CAD paramétrico con STEP, edición de vértices, huesos y animación GLB, y generación de modelos 3D." },
  { property: "og:title", content: "Modelos 3D — MI AI" }, { property: "og:description", content: "Genera, inspecciona y exporta modelos 3D por proyecto." },
  { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
] }), component: Models3D });
function Models3D(){const [mode,setMode]=useState("cad");return <><div className="flex flex-wrap gap-2 border-b p-4"><Button variant={mode==="cad"?"default":"outline"} onClick={()=>setMode("cad")}>CAD / Modelado</Button><Button variant={mode==="rig"?"default":"outline"} onClick={()=>setMode("rig")}>Malla y animación</Button><Button variant={mode==="generate"?"default":"outline"} onClick={()=>setMode("generate")}>Generación / GLB</Button></div>{mode==="cad"?<CadStudio/>:mode==="rig"?<MeshRigStudio/>:<MediaStudio kind="model3d"/>}</>;}
