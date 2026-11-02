// Chat tools: the chat model can request app capabilities (images, video, research, documents…).
// Every call still goes through invokeTool() inside a `chat` run: policy, limits, budget, exact-action approval.
import type { Core } from "./core";
import type { ToolAsset } from "./automation/tools";

/** Fixed allowlist offered to the chat model. Multi-step work goes to the autonomous team via agents.delegate. */
export const CHAT_TOOLS = [
  // Creación con IA
  "image.generate", "image.edit", "image.upscale", "image.remove_bg", "video.generate", "audio.tts", "music.generate", "model3d.generate", "audio.transcribe", "audio.translate",
  // Investigación e internet
  "research.web", "research.deep", "web.fetch", "web.download", "http.request",
  // Documentos y datos
  "doc.create", "doc.read", "doc.outline", "doc.edit", "sheet.compute", "media.ocr", "data.analyze", "chart.create", "db.list", "db.sql",
  // Archivos del espacio de trabajo
  "fs.list", "fs.read", "fs.write", "fs.patch", "fs.move", "fs.delete", "fs.search", "fs.versions", "code.symbols", "code.refs", "text.diff",
  "ws.snapshot", "ws.restore", "archive.create", "archive.extract", "files.export", "files.attach", "assets.list",
  // Código
  "code.js", "code.ts", "code.python", "code.run", "code.file", "quality.run",
  // Medios locales
  "image.process", "audio.convert", "cad.create", "rig.edit", "video.render", "qr.generate",
  // Productividad
  "note.save", "task.add", "reminder.add", "schedule.add", "notify.now", "memory.search", "memory.save",
  // Sistema
  "datetime.now", "device.info", "clipboard.read", "clipboard.write", "hash.compute", "calc.finance", "unit.convert", "logs.read", "secrets.list", "jobs.list",
  // Agentes y PC/VM
  "agents.delegate", "agents.status", "agents.control", "pc.exec", "vm.list", "ssh.exec",
] as const;

/** Plain-language hints so the model knows when and how to use each tool. */
const HINTS: Record<string, string> = {
  "image.generate": "Crea una imagen. `text` = descripción visual detallada.",
  "image.edit": "Edita una imagen del proyecto con IA. `assetId` (ver assets.list o adjuntos) y `text` = cambio deseado.",
  "video.generate": "Crea un video corto; tarda minutos y queda en Trabajos. `text` = descripción de la escena.",
  "audio.tts": "Convierte texto en un archivo de voz. `text` = lo que se dirá.",
  "music.generate": "Crea música. `text` = estilo, instrumentos, ánimo y duración.",
  "model3d.generate": "Crea un modelo 3D GLB con IA. `text` = descripción del objeto. Para piezas con medidas exactas usa cad.create.",
  "research.web": "Busca en internet. `text` = consulta breve. Cita las fuentes devueltas.",
  "research.deep": "Investigación de varias rondas con lectura de fuentes y citas. `text` = pregunta completa.",
  "doc.edit": "Edita un Word o PowerPoint existente sin perder su diseño (textos, notas del orador, orden y borrado de diapositivas). Primero doc.outline para ver índices.",
  "sheet.compute": "Hojas de cálculo con fórmulas reales que se recalculan; puede partir de un Excel adjunto y guardar el resultado.",
  "video.render": "Renderiza la línea de tiempo (clips con recortes, subtítulos, formato). En el teléfono solo cortes; transiciones con target=pc.",
  "rig.edit": "Agrega huesos, piel con uniones suaves y keyframes con curvas a una malla o pieza CAD y exporta GLB animado.",
  "doc.create": "Crea un archivo PDF, Word (docx), Excel (xlsx, usa tablas Markdown), PowerPoint (pptx, una diapositiva por título), ODT, RTF o Markdown.",
  "fs.write": "Escribe un archivo de texto en el espacio de trabajo. `baseHash`=null si es nuevo; si existe, primero fs.read y usa su hash.",
  "fs.patch": "Edita partes de un archivo existente: cada edición reemplaza un fragmento exacto (`find`) por `replace`.",
  "code.python": "Ejecuta Python 3 con biblioteca estándar, numpy, pandas, matplotlib y scipy (offline). Usa print(). Archivos adjuntos (assetIds) quedan en /in/; lo que guardes en /out/ (gráficas PNG, CSV, etc.) se adjunta al chat.",
  "code.js": "Ejecuta JavaScript aislado para cálculos exactos. Usa console.log para el resultado.",
  "pc.exec": "Solo si hay PC/VM emparejada: ejecuta un programa allí. Para shell usa argv [\"bash\",\"-lc\",\"comando\"] o [\"powershell\",\"-Command\",\"...\"].",
  "agents.delegate": "Delega al sistema autónomo un trabajo de varios pasos (programar, construir una app o script, investigar y redactar, revisar y corregir). Trabaja en el teléfono sin PC; la persona aprueba antes de empezar. `mode`=builder para construir software (con `kind`), team para el resto.",
};
export const TOOL_LABELS: Record<string, string> = {
  "image.generate": "Creando imagen", "image.edit": "Editando imagen", "image.upscale": "Mejorando imagen", "image.remove_bg": "Quitando fondo", "video.generate": "Creando video",
  "audio.tts": "Generando voz", "music.generate": "Creando música", "model3d.generate": "Creando modelo 3D", "audio.transcribe": "Transcribiendo audio", "audio.translate": "Traduciendo audio",
  "research.web": "Buscando en internet", "research.deep": "Investigando a fondo", "web.fetch": "Leyendo página web", "web.download": "Descargando archivo", "http.request": "Enviando petición HTTP",
  "doc.create": "Creando documento", "doc.read": "Leyendo documento", "doc.outline": "Revisando documento", "doc.edit": "Editando documento", "sheet.compute": "Calculando hoja", "rig.edit": "Animando modelo 3D", "video.render": "Renderizando video", "media.ocr": "Leyendo texto de la imagen", "data.analyze": "Analizando datos", "chart.create": "Creando gráfica",
  "db.list": "Consultando bases de datos", "db.sql": "Ejecutando SQL",
  "fs.list": "Listando archivos", "fs.read": "Leyendo archivo", "fs.write": "Escribiendo archivo", "fs.patch": "Editando archivo", "fs.move": "Moviendo archivo", "fs.delete": "Eliminando archivo",
  "fs.search": "Buscando en archivos", "fs.versions": "Revisando versiones", "code.symbols": "Indexando código", "code.refs": "Buscando referencias", "text.diff": "Comparando",
  "ws.snapshot": "Creando punto de restauración", "ws.restore": "Restaurando", "archive.create": "Comprimiendo", "archive.extract": "Extrayendo", "files.export": "Exportando", "files.attach": "Adjuntando archivo", "assets.list": "Revisando archivos",
  "code.js": "Ejecutando JavaScript", "code.ts": "Ejecutando TypeScript", "code.python": "Ejecutando Python", "code.run": "Ejecutando archivo", "code.file": "Ejecutando archivo", "quality.run": "Ejecutando pruebas",
  "image.process": "Procesando imagen", "audio.convert": "Procesando audio", "cad.create": "Modelando 3D", "qr.generate": "Creando QR",
  "note.save": "Guardando nota", "task.add": "Creando tarea", "reminder.add": "Programando recordatorio", "schedule.add": "Programando revisiones", "notify.now": "Enviando notificación",
  "memory.search": "Consultando memoria", "memory.save": "Guardando en memoria",
  "datetime.now": "Consultando fecha", "device.info": "Revisando el teléfono", "clipboard.read": "Leyendo portapapeles", "clipboard.write": "Copiando", "hash.compute": "Calculando hash",
  "calc.finance": "Calculando", "unit.convert": "Convirtiendo unidades", "logs.read": "Leyendo registros", "secrets.list": "Revisando credenciales", "jobs.list": "Revisando trabajos",
  "agents.delegate": "Iniciando equipo de agentes", "agents.status": "Revisando agentes", "agents.control": "Controlando agentes", "pc.exec": "Ejecutando en la PC", "vm.list": "Revisando servidores", "ssh.exec": "Ejecutando por SSH",
};
export const toolName = (id: string) => id.replace(/\./g, "__");
export const toolIdOf = (name: string) => name.replace(/__/g, ".");

export type ChatToolSet = { schemas: unknown[]; available: string[]; unavailable: { id: string; reason: string }[] };

/** Only tools that can actually run now are offered; the rest are described so the model can explain what to configure. */
export async function chatToolSet(core: Core, projectId: string): Promise<ChatToolSet> {
  const { getTool } = await import("./automation/tools");
  const { jsonSchemaOf } = await import("./realtime-voice");
  const ctx = { core, projectId, runId: "", taskId: null, agent: "chat" };
  const schemas: unknown[] = [], available: string[] = [], unavailable: { id: string; reason: string }[] = [];
  for (const id of CHAT_TOOLS) {
    const def = getTool(id); if (!def) continue;
    const a = await def.availability(ctx).catch((e) => ({ ok: false, reason: String(e?.message ?? e) }));
    if (!a.ok) { unavailable.push({ id, reason: a.reason ?? "no disponible" }); continue; }
    available.push(id);
    schemas.push({ type: "function", function: { name: toolName(id), description: `${def.name}. ${HINTS[id] ?? def.description}`, parameters: jsonSchemaOf(def.input) } });
  }
  return { schemas, available, unavailable };
}

export function toolsPrompt(set: ChatToolSet) {
  const on = set.available.map((id) => `- ${TOOL_LABELS[id] ?? id} (${toolName(id)})`).join("\n");
  const off = set.unavailable.map((u) => `- ${TOOL_LABELS[u.id] ?? u.id}: ${u.reason}`).join("\n");
  return `\n\nHerramientas de MI AI:\n${on ? `Puedes usarlas directamente cuando la persona lo pida o cuando ayuden a resolver su petición (crear y editar medios, documentos, internet y APIs, archivos y código en el espacio de trabajo del teléfono, Python/TypeScript/JavaScript, bases de datos, comprimidos, sistema, agentes, PC/VM). Los adjuntos del usuario traen su id para usarlos en herramientas. No digas que no tienes una herramienta si está en esta lista:\n${on}\nLos archivos que crees aparecen solos en la conversación; no inventes enlaces.` : "Ninguna herramienta está lista ahora."}${off ? `\nNo disponibles todavía (explica a la persona qué configurar, normalmente un modelo con esa capacidad en Modelos):\n${off}` : ""}`;
}

export type ToolStep = { reply: string; assets: ToolAsset[]; runId?: string };
type Ask = (summary: string) => Promise<boolean>;

/** Runs one model-requested tool call. Approvals block until the person decides on screen. */
export async function runChatTool(core: Core, projectId: string, runId: string, call: { id: string; name: string; arguments: string }, ask: Ask, signal?: AbortSignal): Promise<ToolStep> {
  const toolId = toolIdOf(call.name);
  if (!(CHAT_TOOLS as readonly string[]).includes(toolId)) return { reply: `No se ejecutó: «${toolId}» no está disponible en el chat.`, assets: [] };
  let input: unknown;
  try { input = JSON.parse(call.arguments || "{}"); } catch { return { reply: "No se ejecutó: argumentos inválidos.", assets: [] }; }
  const { invokeTool, DEFAULT_LIMITS } = await import("./automation/tools");
  const ctx = { core, projectId, runId, taskId: null, agent: "chat", ...(signal ? { signal } : {}) };
  // The person asked for this in the chat: unknown prices proceed (project budgets still apply); known costs ask on screen.
  const opts = { allowed: [...CHAT_TOOLS], limits: { ...DEFAULT_LIMITS, maxCalls: 300, perAgentCalls: 300, unknownCost: "allow" as const }, opKey: `chat:${runId}:${call.id}` };
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await invokeTool(ctx, toolId, input, opts);
    if (r.status === "ok") return { reply: r.trusted ? r.output : `<datos_no_confiables>${r.output}</datos_no_confiables>`, assets: r.assets ?? [], ...(r.runId ? { runId: r.runId } : {}) };
    if (r.status === "approval") {
      const ok = await ask(r.summary);
      const { approvals } = await import("./automation/approvals");
      await approvals.decide(core.repo, projectId, r.approvalId, ok);
      if (!ok) return { reply: "La persona rechazó esta acción. No la repitas sin que lo pida.", assets: [] };
      continue;
    }
    return { reply: `No se ejecutó: ${r.reason}`, assets: [] };
  }
  return { reply: "No se ejecutó: la aprobación no coincidió con la acción.", assets: [] };
}

/** Marker stored in an assistant message to show a live autonomous-run card in the conversation. */
export const RUN_MARKER = /\[\[miai-run:([0-9a-f-]{36})\]\]/g;
export const runMarker = (id: string) => `[[miai-run:${id}]]`;
export function splitRunMarkers(text: string) {
  const ids = [...text.matchAll(RUN_MARKER)].map((m) => m[1]!);
  return { text: text.replace(RUN_MARKER, "").trimEnd(), runIds: [...new Set(ids)] };
}
