import { createFileRoute, Link } from "@tanstack/react-router";
import { Brain, FileText, GraduationCap, ListChecks, Search, Activity, ShieldCheck, Bot, Workflow, Code, Briefcase, Server, BarChart3, Music, Video, Box } from "lucide-react";

export const Route = createFileRoute("/tools")({
  head: () => ({
    meta: [
      { title: "Herramientas — MI AI" },
      { name: "description", content: "Documentos, notas y tareas, investigación web, modo estudio y memoria del proyecto." },
      { property: "og:title", content: "Herramientas — MI AI" },
      { property: "og:description", content: "Productividad, investigación y estudio con tus propios modelos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Tools,
});

const ITEMS = [
  { to: "/music", icon: Music, label: "Música y sonido", desc: "" },
  { to: "/video", icon: Video, label: "Video", desc: "" },
  { to: "/models3d", icon: Box, label: "Modelos 3D", desc: "" },
  { to: "/workspace", icon: Briefcase, label: "Espacio profesional", desc: "" },
  { to: "/servers", icon: Server, label: "Servidores", desc: "" },
  { to: "/data", icon: BarChart3, label: "Datos y presupuestos", desc: "" },
  { to: "/agents", icon: Bot, label: "Agentes", desc: "" },
  { to: "/automation", icon: Workflow, label: "Automatización", desc: "" },
  { to: "/code", icon: Code, label: "Código", desc: "" },
  { to: "/documents", icon: FileText, label: "Documentos", desc: "Analiza PDF, Word y Excel; crea y exporta documentos" },
  { to: "/notes", icon: ListChecks, label: "Notas y tareas", desc: "Notas, pendientes y tareas sacadas de un texto" },
  { to: "/research", icon: Search, label: "Investigar", desc: "Búsqueda en internet con fuentes citadas" },
  { to: "/study", icon: GraduationCap, label: "Estudiar", desc: "Explicaciones, cuestionarios, tarjetas y planes" },
  { to: "/memory", icon: Brain, label: "Memoria", desc: "Memoria del proyecto e índice inteligente" },
  { to: "/jobs", icon: Activity, label: "Trabajos", desc: "Estado y recuperación de operaciones" },
  { to: "/diagnostics", icon: ShieldCheck, label: "Diagnóstico", desc: "Seguridad y rendimiento del teléfono" },
] as const;

function Tools() {
  return (
    <div className="space-y-3 p-4">
      <h1 className="text-2xl font-bold">Herramientas</h1>
      <div className="grid grid-cols-2 gap-2">
        {ITEMS.map(({ to, icon: Icon, label, desc }) => (
          <Link key={to} to={to} className="space-y-1 rounded-xl border bg-card p-3">
            <Icon className="h-5 w-5 text-primary" />
            <div className="text-sm font-semibold">{label}</div>
            <div className="text-xs text-muted-foreground">{desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
