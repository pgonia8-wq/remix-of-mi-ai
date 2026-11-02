// Chat/agent tools for editing presentations and Word files, spreadsheets with formulas, rendering the video
// timeline and rigging/animating 3D meshes. Ordinary ToolDefs: every call still goes through invokeTool().
import { z } from "zod";
import type { ToolCtx, ToolDef, ToolAsset } from "./tools";

type Base = Omit<ToolDef, "availability" | "run"> & { availability?: ToolDef["availability"]; run: NonNullable<ToolDef["run"]> };
const ok = async () => ({ ok: true });
const tool = (t: Partial<Base> & Pick<Base, "id" | "name" | "description" | "input" | "run">): ToolDef => ({
  family: "productividad", output: "texto", permissions: [], network: false, cost: "none", maxCalls: 30, timeoutMs: 120_000, parallel: false,
  env: ["android"], risk: "low", approval: "never", sideEffect: false, roles: "all", availability: ok, ...t,
} as ToolDef);
const uuid = z.string().uuid();
const MIME = { docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" } as const;

const VIDEO = z.object({ clips: z.array(z.object({ assetId: uuid, start: z.number().min(0), end: z.number().positive(), transition: z.enum(["cut", "fade", "wipeleft", "slideright", "circleopen"]).default("cut"), transitionSeconds: z.number().min(0.1).max(3).default(0.5) }).strict()).min(1).max(8), captions: z.array(z.object({ start: z.number().min(0), end: z.number().positive(), text: z.string().min(1).max(200) }).strict()).max(60).default([]), ratio: z.enum(["original", "16:9", "9:16"]).default("original"), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0), mute: z.boolean().default(false), target: z.enum(["phone", "pc"]).default("phone") }).strict();
type VideoIn = z.infer<typeof VIDEO>;

export function officeTools(R: new (m: string) => Error): ToolDef[] {
  async function load(ctx: ToolCtx, id: string) {
    const a = await ctx.core.assets.get(ctx.projectId, id);
    if (!a) throw new R("Archivo inexistente en este proyecto. Usa assets.list para ver los ids.");
    return { meta: a, bytes: await ctx.core.assets.read(ctx.projectId, id) };
  }
  async function save(ctx: ToolCtx, bytes: Uint8Array, name: string, mime: string, kind: string, parentId: string | null, capability: string): Promise<ToolAsset> {
    const a = await ctx.core.assets.put(ctx.projectId, (async function* () { yield bytes; })(), { kind, name, mime, capability, parentId });
    return { id: a.id, mime: a.mime, name };
  }

  return [
    tool({ id: "doc.outline", name: "Ver estructura de Word/PowerPoint", description: "Lista los párrafos (índice, estilo, texto) de un .docx o las diapositivas (cuadros de texto y notas) de un .pptx para poder editarlos con doc.edit.",
      input: z.object({ assetId: uuid }).strict(),
      run: async (ctx, i) => {
        const { meta, bytes } = await load(ctx, i.assetId);
        const { officeKind, docxParagraphs, pptxSlides } = await import("../docs/ooxml-edit");
        const kind = officeKind(meta.name ?? "", meta.mime);
        if (kind === "docx") return { output: docxParagraphs(bytes).map((p) => `¶${p.index}${p.style ? ` [${p.style}]` : ""}${p.hasImage ? " (imagen)" : ""}: ${p.text}`).join("\n").slice(0, 20_000), trusted: false };
        if (kind === "pptx") return { output: pptxSlides(bytes).map((s) => `Diapositiva ${s.number}:\n${s.shapes.map((x) => `  cuadro ${x.index} «${x.name}»: ${x.text.replace(/\n/g, " / ")}`).join("\n")}\n  notas: ${s.notes ?? "(sin notas)"}`).join("\n").slice(0, 20_000), trusted: false };
        throw new R("Solo .docx o .pptx.");
      } }),
    tool({ id: "doc.edit", name: "Editar Word o PowerPoint", description: "Edita un .docx o .pptx conservando estilos, imágenes y diseño; guarda una versión nueva. Word: replace{find,replace}, setText{index,text}, insertAfter{index,text,style?}, delete{index}. PowerPoint: replace{find,replace,slide?}, setShapeText{slide,shape,text}, setNotes{slide,text}, deleteSlide{slide}, moveSlide{slide,to}. Usa doc.outline antes para ver índices.",
      input: z.object({ assetId: uuid, ops: z.array(z.object({ op: z.enum(["replace", "setText", "insertAfter", "delete", "setShapeText", "setNotes", "deleteSlide", "moveSlide"]), find: z.string().max(2000).optional(), replace: z.string().max(5000).optional(), all: z.boolean().optional(), index: z.number().int().min(0).optional(), text: z.string().max(20_000).optional(), style: z.string().max(60).optional(), slide: z.number().int().min(1).optional(), shape: z.union([z.number().int().min(0), z.string().max(80)]).optional(), to: z.number().int().min(1).optional() }).strict()).min(1).max(50) }).strict(),
      permissions: ["local.write"], sideEffect: true,
      run: async (ctx, i) => {
        const { meta, bytes } = await load(ctx, i.assetId);
        const m = await import("../docs/ooxml-edit");
        const kind = m.officeKind(meta.name ?? "", meta.mime); if (!kind) throw new R("Solo .docx o .pptx.");
        const wordOps = ["replace", "setText", "insertAfter", "delete"], pptOps = ["replace", "setShapeText", "setNotes", "deleteSlide", "moveSlide"];
        for (const o of i.ops) if (!(kind === "docx" ? wordOps : pptOps).includes(o.op)) throw new R(`«${o.op}» no aplica a ${kind}.`);
        let r;
        try { r = kind === "docx" ? m.editDocx(bytes, i.ops as never) : m.editPptx(bytes, i.ops as never); } catch (e) { throw new R((e as Error).message); }
        const a = await save(ctx, r.bytes, meta.name ?? `documento.${kind}`, MIME[kind], "document", meta.id, "doc.edit");
        return { output: `${r.changes} cambio(s) aplicados; versión nueva guardada.`, trusted: true, assets: [a] };
      } }),
    tool({ id: "sheet.compute", name: "Hoja de cálculo con fórmulas", family: "datos", description: "Calcula una hoja con fórmulas tipo Excel (SUMA/SUM, PROMEDIO, SI, BUSCARV, SUMAR.SI, REDONDEAR…). `cells` = {\"A1\":\"10\",\"B1\":\"=A1*2\"}. Opcional `assetId` de un .xlsx/.ods/.csv para partir de él y `save` para guardar el resultado como .xlsx (versión nueva).",
      input: z.object({ cells: z.record(z.string().regex(/^\$?[A-Za-z]{1,3}\$?\d{1,6}$/), z.string().max(2000)).default({}), assetId: uuid.optional(), sheet: z.string().max(31).optional(), save: z.boolean().default(false), name: z.string().max(80).optional() }).strict(),
      permissions: ["local.write"], sideEffect: true,
      run: async (ctx, i) => {
        const f = await import("../docs/sheet-formulas");
        let sheets = [{ name: i.sheet ?? "Hoja1", cells: {} as Record<string, string> }], parent: string | null = null, baseName = i.name ?? "hoja";
        if (i.assetId) { const { meta, bytes } = await load(ctx, i.assetId); sheets = await f.readSheetFile(bytes); parent = meta.id; baseName = i.name ?? (meta.name ?? "hoja").replace(/\.\w+$/, ""); }
        const idx = Math.max(0, sheets.findIndex((s) => !i.sheet || s.name === i.sheet));
        sheets[idx] = { ...sheets[idx]!, cells: { ...sheets[idx]!.cells, ...i.cells } };
        const values = f.evaluateSheet(sheets[idx]!.cells);
        const shown = Object.entries(values).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })).slice(0, 400).map(([k, v]) => `${k} = ${f.display(v)}${sheets[idx]!.cells[k]?.startsWith("=") ? `   (${sheets[idx]!.cells[k]})` : ""}`).join("\n");
        if (!i.save) return { output: shown || "(hoja vacía)", trusted: true };
        const a = await save(ctx, await f.writeSheetFile(sheets, "xlsx"), `${baseName}.xlsx`, MIME.xlsx, "document", parent, "sheet.document");
        return { output: `${shown}\n\nGuardada como ${a.name}.`, trusted: true, assets: [a] };
      } }),
    tool({ id: "video.render", name: "Renderizar línea de tiempo de video", family: "multimedia", description: "Une clips de video del proyecto con recortes, subtítulos, rotación y formato. En el teléfono (Android) solo cortes directos; transiciones (fade, wipeleft, slideright, circleopen) requieren `target`=pc con FFmpeg en tu PC Node. Resultado: un MP4 nuevo.",
      input: VIDEO,
      permissions: ["local.write"], sideEffect: true, timeoutMs: 15 * 60_000, maxCalls: 5,
      availability: async () => ({ ok: true }),
      run: async (ctx, input) => {
        const i = input as VideoIn;
        for (const c of i.clips) { if (c.end <= c.start) throw new R("Cada clip necesita fin mayor que inicio."); const a = await ctx.core.assets.get(ctx.projectId, c.assetId); if (!a || !a.mime.startsWith("video/")) throw new R("Clip inexistente o que no es video."); }
        if (i.target === "phone") {
          if (i.clips.some((c) => c.transition !== "cut")) throw new R("Las transiciones necesitan target=pc (FFmpeg en tu PC Node). En el teléfono solo cortes directos.");
          const { exportVideo, isNative } = await import("../video-edit").then(async (m) => ({ ...m, isNative: (await import("../app-db")).isNative }));
          if (!isNative()) throw new R("El render en el teléfono solo funciona en la app Android.");
          const clips = i.clips.map((c) => ({ assetId: c.assetId, name: "clip", start: c.start, end: c.end, duration: c.end }));
          const a = await exportVideo(ctx.core, ctx.projectId, clips, i.captions, { rotation: i.rotation, ratio: i.ratio, mute: i.mute });
          return { output: "Video renderizado en el teléfono.", trusted: true, assets: [{ id: a.id, mime: a.mime, name: a.name ?? "Video editado.mp4" }] };
        }
        const { folders } = await import("../nodes/storage"); const { nodes } = await import("../nodes/client");
        let nodeId: string | null = null;
        for (const f of await folders.list(ctx.core.repo, ctx.projectId)) { const n = await nodes.get(ctx.core.repo, f.node_id); if (n && !n.revoked && n.status === "online") { nodeId = n.id; break; } }
        if (!nodeId) throw new R("No hay PC Node en línea para este proyecto.");
        const { submitMedia, collectMedia } = await import("../media/pc-media");
        const plan = { clips: i.clips.map((c) => ({ start: c.start, end: c.end, transition: c.transition, transitionSeconds: c.transitionSeconds })), overlays: [], width: i.ratio === "9:16" ? 720 : 1280, height: i.ratio === "9:16" ? 1280 : 720, rotation: i.rotation, mute: i.mute, originalAudio: true, captions: i.captions };
        const s = await submitMedia(ctx.core, ctx.projectId, nodeId, "video", i.clips.map((c) => c.assetId), plan as never);
        for (let t = 0; t < 280; t++) {
          if (ctx.signal?.aborted) throw new R("Cancelado; el render sigue en la PC y aparece en Trabajos.");
          const r = await collectMedia(ctx.core, ctx.projectId, s) as { status: string; assets?: { id: string; mime: string; name: string | null }[] };
          if (r.status === "failed") throw new R("FFmpeg no pudo renderizar en la PC.");
          if (r.assets?.length) return { output: "Video renderizado en tu PC e importado cifrado.", trusted: true, assets: r.assets.map((a) => ({ id: a.id, mime: a.mime, name: a.name ?? "video.mp4" })) };
          await new Promise((res) => setTimeout(res, 3000));
        }
        return { output: "El render sigue en la PC; el resultado aparecerá en Trabajos.", trusted: true };
      } }),
    tool({ id: "rig.edit", name: "Esqueleto y animación 3D", family: "multimedia", description: "Edita una malla 3D guardada (.miaimesh) o una pieza CAD: agrega huesos, asigna la piel (con uniones suaves), fija keyframes con curvas (linear, ease, in, out, step) y exporta GLB animado u OBJ de una pose. Ops: addBone{name,parent?,head:[x,y,z]}, removeBone{name}, autoSkin{smooth}, key{bone,t,rot:[x,y,z]°,move:[x,y,z],ease?}, duration{seconds}.",
      input: z.object({ assetId: uuid, ops: z.array(z.object({ op: z.enum(["addBone", "removeBone", "autoSkin", "key", "duration"]), name: z.string().regex(/^[\w-]{1,40}$/).optional(), parent: z.string().regex(/^[\w-]{1,40}$/).nullable().optional(), head: z.tuple([z.number(), z.number(), z.number()]).optional(), smooth: z.boolean().optional(), bone: z.string().max(40).optional(), t: z.number().min(0).max(600).optional(), rot: z.tuple([z.number(), z.number(), z.number()]).optional(), move: z.tuple([z.number(), z.number(), z.number()]).optional(), ease: z.enum(["linear", "ease", "in", "out", "step"]).optional(), seconds: z.number().positive().max(600).optional() }).strict()).max(80).default([]), export: z.enum(["none", "glb", "obj"]).default("none"), poseAt: z.number().min(0).max(600).default(0) }).strict(),
      permissions: ["local.write"], sideEffect: true, timeoutMs: 180_000,
      run: async (ctx, i) => {
        const { meta, bytes } = await load(ctx, i.assetId);
        const rig = await import("../media/rig");
        let doc: import("../media/rig").MeshDoc;
        const raw = JSON.parse(new TextDecoder().decode(bytes));
        if (meta.capability_id === "cad.document") { const { visiblePolygons } = await import("../media/cad"); doc = rig.meshFromPolygons(raw.name, visiblePolygons(raw)); }
        else if (meta.capability_id === "mesh.document") doc = raw;
        else throw new R("Usa una malla guardada (.miaimesh) o una pieza CAD del proyecto.");
        const byName = (n?: string) => doc.bones.find((b) => b.name === n || b.id === n);
        for (const o of i.ops) {
          if (o.op === "addBone") { if (!o.name || !o.head) throw new R("addBone necesita name y head."); if (byName(o.name)) throw new R(`Ya existe el hueso ${o.name}.`); const p = o.parent ? byName(o.parent) : null; if (o.parent && !p) throw new R(`No existe el hueso padre ${o.parent}.`); doc = { ...doc, bones: [...doc.bones, { id: crypto.randomUUID(), name: o.name, parent: p?.id ?? null, head: o.head }] }; }
          else if (o.op === "removeBone") { const b = byName(o.name); if (!b) throw new R(`No existe el hueso ${o.name}.`); if (doc.bones.some((x) => x.parent === b.id)) throw new R("Quita primero sus huesos hijos."); const idx = doc.bones.indexOf(b); const fix = (w: number) => (w === idx ? -1 : w > idx ? w - 1 : w); doc = { ...doc, bones: doc.bones.filter((x) => x !== b), weights: doc.weights.map(fix), ...(doc.weights2 ? { weights2: doc.weights2.map(fix) } : {}), tracks: doc.tracks.filter((t) => t.bone !== b.id) }; }
          else if (o.op === "autoSkin") doc = rig.autoAssign(doc, { smooth: o.smooth ?? true });
          else if (o.op === "key") { const b = byName(o.bone); if (!b) throw new R(`No existe el hueso ${o.bone}.`); doc = rig.setKey(doc, b.id, { t: o.t ?? 0, rot: o.rot ?? [0, 0, 0], move: o.move ?? [0, 0, 0], ...(o.ease && o.ease !== "linear" ? { ease: o.ease } : {}) }); }
          else if (o.op === "duration") doc = { ...doc, duration: o.seconds ?? doc.duration };
        }
        try { rig.validateMesh(doc); } catch (e) { throw new R((e as Error).message); }
        const assets: ToolAsset[] = [];
        if (i.ops.length) assets.push(await save(ctx, new TextEncoder().encode(JSON.stringify(doc)), `${doc.name}.miaimesh`, "application/json", "document", meta.capability_id === "mesh.document" ? meta.id : null, "mesh.document"));
        if (i.export === "glb") { const { exportRiggedGlb } = await import("../media/rig-export"); assets.push(await save(ctx, await exportRiggedGlb(doc), `${doc.name}.glb`, "model/gltf-binary", "model3d", null, "mesh.export")); }
        if (i.export === "obj") assets.push(await save(ctx, rig.objFromPose(doc, i.poseAt), `${doc.name}-pose.obj`, "model/obj", "model3d", null, "mesh.export"));
        return { output: `Malla: ${doc.positions.length / 3} vértices, huesos: ${doc.bones.map((b) => b.name).join(", ") || "ninguno"}, pistas: ${doc.tracks.length}, duración ${doc.duration} s.`, trusted: true, assets };
      } }),
  ];
}
