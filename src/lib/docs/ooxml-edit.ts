// In-place editing of Word (.docx) and PowerPoint (.pptx) packages on the phone. Only the touched XML parts are
// rewritten; styles, images, charts, themes, headers and every other part are copied byte-for-byte.
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";

export type Pkg = Record<string, Uint8Array>;
export function openPkg(bytes: Uint8Array): Pkg {
  try { return unzipSync(bytes); } catch { throw new Error("El archivo no es un documento de Office válido."); }
}
export function savePkg(pkg: Pkg): Uint8Array {
  // mimetype-like first entries stay first; everything else keeps its original bytes.
  const out: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [k, v] of Object.entries(pkg)) out[k] = [v, { level: /\.(png|jpe?g|gif|mp4|mp3|wav|emf|wmf)$/i.test(k) ? 0 : 6 }];
  return zipSync(out);
}
const parse = (pkg: Pkg, path: string) => {
  const raw = pkg[path]; if (!raw) throw new Error(`Falta la parte ${path} del documento.`);
  const d = new DOMParser().parseFromString(strFromU8(raw), "application/xml");
  if (d.getElementsByTagName("parsererror").length) throw new Error(`XML dañado en ${path}.`);
  return d;
};
const write = (pkg: Pkg, path: string, d: Document) => { pkg[path] = strToU8(new XMLSerializer().serializeToString(d)); };
const XMLNS = "http://www.w3.org/XML/1998/namespace";
const preserve = (el: Element) => el.setAttributeNS(XMLNS, "xml:space", "preserve");
const els = (root: Document | Element, ns: string, tag: string) => Array.from(root.getElementsByTagNameNS(ns, tag));
const kids = (el: Element, ns: string, tag: string) => Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === ns && (n as Element).localName === tag);

/** Replace `find` inside a sequence of text nodes, even when the match spans several runs. Text outside each match
 * keeps its own run (and formatting); the replacement takes the formatting of the run where the match starts. */
function replaceInNodes(nodes: Element[], find: string, replace: string, all: boolean): number {
  if (!find) return 0;
  let count = 0;
  for (let guard = 0; guard < 10_000; guard++) {
    const texts = nodes.map((n) => n.textContent ?? "");
    const full = texts.join("");
    const at = full.indexOf(find, 0);
    if (at < 0) break;
    let pos = 0, remaining = find.length, startDone = false;
    for (let i = 0; i < nodes.length && remaining > 0; i++) {
      const t = texts[i]!, s = pos, e = pos + t.length; pos = e;
      if (e <= at) continue;
      const from = Math.max(0, at - s), take = Math.min(t.length - from, remaining);
      const before = t.slice(0, from), after = t.slice(from + take);
      nodes[i]!.textContent = startDone ? before + after : before + replace + after;
      startDone = true; remaining -= take;
      if (/\s$|^\s/.test(nodes[i]!.textContent ?? "")) preserve(nodes[i]!);
    }
    count++;
    if (!all) break;
    if (replace.includes(find)) break; // avoid infinite loops on self-containing replacements
  }
  return count;
}

// ---------------------------------------------------------------- Word
export type DocxParagraph = { index: number; style: string | null; text: string; hasImage: boolean; inTable: boolean };
const docParas = (d: Document) => { const body = els(d, W, "body")[0]; if (!body) throw new Error("Documento Word sin cuerpo."); return els(body, W, "p"); };
const runTexts = (p: Element) => els(p, W, "t");

export function docxParagraphs(bytes: Uint8Array): DocxParagraph[] {
  const d = parse(openPkg(bytes), "word/document.xml");
  return docParas(d).map((p, index) => ({
    index, text: runTexts(p).map((t) => t.textContent ?? "").join(""),
    style: els(p, W, "pStyle")[0]?.getAttributeNS(W, "val") ?? null,
    hasImage: els(p, W, "drawing").length > 0 || els(p, W, "pict").length > 0,
    inTable: !!p.parentElement && p.parentElement.localName === "tc",
  }));
}

export type DocxOp =
  | { op: "replace"; find: string; replace: string; all?: boolean }
  | { op: "setText"; index: number; text: string }
  | { op: "insertAfter"; index: number; text: string; style?: string }
  | { op: "delete"; index: number };

function setParagraphText(p: Element, text: string) {
  const ts = runTexts(p);
  if (!ts.length) {
    const d = p.ownerDocument, r = d.createElementNS(W, "w:r"), t = d.createElementNS(W, "w:t");
    preserve(t); t.textContent = text; r.appendChild(t); p.appendChild(r); return;
  }
  ts[0]!.textContent = text; preserve(ts[0]!);
  for (const t of ts.slice(1)) t.textContent = "";
}

export function editDocx(bytes: Uint8Array, ops: DocxOp[]): { bytes: Uint8Array; changes: number } {
  const pkg = openPkg(bytes), d = parse(pkg, "word/document.xml");
  let changes = 0;
  for (const o of ops) {
    const paras = docParas(d);
    if (o.op === "replace") {
      let n = 0;
      for (const p of paras) { n += replaceInNodes(runTexts(p), o.find, o.replace, o.all ?? true); if (n && !(o.all ?? true)) break; }
      // headers/footers keep their own styles too
      for (const part of Object.keys(pkg).filter((k) => /^word\/(header|footer)\d*\.xml$/.test(k))) {
        if (n && !(o.all ?? true)) break;
        const hd = parse(pkg, part); let m = 0;
        for (const p of els(hd, W, "p")) m += replaceInNodes(runTexts(p), o.find, o.replace, o.all ?? true);
        if (m) { write(pkg, part, hd); n += m; }
      }
      if (!n) throw new Error(`No se encontró «${o.find}».`);
      changes += n; continue;
    }
    const p = paras[o.index];
    if (!p) throw new Error(`No existe el párrafo ${o.index}.`);
    if (o.op === "setText") { if (els(p, W, "drawing").length && !runTexts(p).length) throw new Error("Ese párrafo solo contiene una imagen."); setParagraphText(p, o.text); }
    else if (o.op === "insertAfter") {
      const c = p.cloneNode(true) as Element;
      // keep paragraph + first run formatting, drop images, fields and extra runs
      for (const r of els(c, W, "r").slice(1)) r.parentNode?.removeChild(r);
      for (const x of [...els(c, W, "drawing"), ...els(c, W, "pict"), ...els(c, W, "fldChar"), ...els(c, W, "instrText")]) x.parentNode?.removeChild(x);
      setParagraphText(c, o.text);
      if (o.style) {
        let pPr = kids(c, W, "pPr")[0]; if (!pPr) { pPr = d.createElementNS(W, "w:pPr"); c.insertBefore(pPr, c.firstChild); }
        let ps = kids(pPr, W, "pStyle")[0]; if (!ps) { ps = d.createElementNS(W, "w:pStyle"); pPr.insertBefore(ps, pPr.firstChild); }
        ps.setAttributeNS(W, "w:val", o.style);
      }
      p.parentNode!.insertBefore(c, p.nextSibling);
    } else if (o.op === "delete") {
      if (els(p, W, "drawing").length) throw new Error("Ese párrafo contiene una imagen; edítalo en lugar de borrarlo.");
      if (p.parentElement?.localName === "tc" && kids(p.parentElement, W, "p").length === 1) setParagraphText(p, "");
      else p.parentNode!.removeChild(p);
    }
    changes++;
  }
  write(pkg, "word/document.xml", d);
  return { bytes: savePkg(pkg), changes };
}

// ---------------------------------------------------------------- PowerPoint
export type PptxShape = { index: number; name: string; text: string };
export type PptxSlide = { number: number; path: string; shapes: PptxShape[]; notes: string | null; hasNotesPart: boolean };

const relsPath = (part: string) => { const i = part.lastIndexOf("/"); return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`; };
const resolve = (base: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) { if (seg === "..") parts.pop(); else if (seg !== ".") parts.push(seg); }
  return parts.join("/");
};
function rels(pkg: Pkg, part: string) {
  const p = relsPath(part); if (!pkg[p]) return { doc: null as Document | null, list: [] as { id: string; type: string; target: string; el: Element }[] };
  const doc = parse(pkg, p);
  return { doc, list: els(doc, REL, "Relationship").map((el) => ({ id: el.getAttribute("Id") ?? "", type: el.getAttribute("Type") ?? "", target: resolve(part, el.getAttribute("Target") ?? ""), el })) };
}
function slideOrder(pkg: Pkg) {
  const pres = parse(pkg, "ppt/presentation.xml");
  const map = new Map(rels(pkg, "ppt/presentation.xml").list.map((r) => [r.id, r.target]));
  const lst = els(pres, P, "sldIdLst")[0];
  const ids = lst ? kids(lst, P, "sldId") : [];
  return { pres, lst, ids, paths: ids.map((e) => map.get(e.getAttributeNS(R, "id") ?? "") ?? "") };
}
const shapesOf = (d: Document) => els(d, P, "sp").filter((sp) => kids(sp, P, "txBody").length > 0);
const shapeText = (sp: Element) => els(sp, A, "p").map((p) => els(p, A, "t").map((t) => t.textContent ?? "").join("")).join("\n");
const shapeName = (sp: Element) => els(sp, P, "cNvPr")[0]?.getAttribute("name") ?? "";
function notesPart(pkg: Pkg, slidePath: string) { return rels(pkg, slidePath).list.find((r) => r.type.endsWith("/notesSlide"))?.target ?? null; }
function notesBody(d: Document) { return shapesOf(d).find((sp) => els(sp, P, "ph")[0]?.getAttribute("type") === "body") ?? null; }

export function pptxSlides(bytes: Uint8Array): PptxSlide[] {
  const pkg = openPkg(bytes);
  return slideOrder(pkg).paths.map((path, i) => {
    const d = parse(pkg, path), np = notesPart(pkg, path);
    let notes: string | null = null;
    if (np && pkg[np]) { const b = notesBody(parse(pkg, np)); notes = b ? shapeText(b) : null; }
    return { number: i + 1, path, shapes: shapesOf(d).map((sp, index) => ({ index, name: shapeName(sp), text: shapeText(sp) })), notes, hasNotesPart: !!np };
  });
}

export type PptxOp =
  | { op: "replace"; find: string; replace: string; slide?: number; all?: boolean }
  | { op: "setShapeText"; slide: number; shape: number | string; text: string }
  | { op: "setNotes"; slide: number; text: string }
  | { op: "deleteSlide"; slide: number }
  | { op: "moveSlide"; slide: number; to: number };

/** Rewrites a text body keeping the first paragraph's properties and the first run's formatting for every line. */
function setBodyText(txBody: Element, text: string) {
  const d = txBody.ownerDocument;
  const ps = kids(txBody, A, "p");
  const tmpl = ps[0] ?? d.createElementNS(A, "a:p");
  const pPr = kids(tmpl, A, "pPr")[0]?.cloneNode(true) ?? null;
  const rPr = (els(tmpl, A, "rPr")[0] ?? els(tmpl, A, "endParaRPr")[0])?.cloneNode(true) as Element | undefined;
  for (const p of ps) txBody.removeChild(p);
  for (const line of text.split("\n")) {
    const p = d.createElementNS(A, "a:p");
    if (pPr) p.appendChild(pPr.cloneNode(true));
    const r = d.createElementNS(A, "a:r");
    if (rPr) { const rp = d.createElementNS(A, "a:rPr"); for (const at of Array.from(rPr.attributes)) rp.setAttribute(at.name, at.value); for (const c of Array.from(rPr.childNodes)) rp.appendChild(c.cloneNode(true)); r.appendChild(rp); }
    const t = d.createElementNS(A, "a:t"); t.textContent = line; r.appendChild(t); p.appendChild(r); txBody.appendChild(p);
  }
}

function addNotesSlide(pkg: Pkg, slidePath: string): string {
  const master = Object.keys(pkg).find((k) => /^ppt\/notesMasters\/notesMaster\d+\.xml$/.test(k));
  if (!master) throw new Error("Esta presentación no tiene patrón de notas; no se pueden crear notas nuevas.");
  let n = 1; while (pkg[`ppt/notesSlides/notesSlide${n}.xml`]) n++;
  const path = `ppt/notesSlides/notesSlide${n}.xml`;
  pkg[path] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Notas"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="es-ES"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
  const rel = (from: string, to: string) => { const f = from.split("/").slice(0, -1), t = to.split("/"); let i = 0; while (i < f.length && f[i] === t[i]) i++; return [...f.slice(i).map(() => ".."), ...t.slice(i)].join("/"); };
  pkg[relsPath(path)] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/notesMaster" Target="${rel(path, master)}"/><Relationship Id="rId2" Type="${R}/slide" Target="${rel(path, slidePath)}"/></Relationships>`);
  const sr = rels(pkg, slidePath);
  const doc = sr.doc ?? new DOMParser().parseFromString(`<Relationships xmlns="${REL}"/>`, "application/xml");
  const used = new Set(els(doc, REL, "Relationship").map((e) => e.getAttribute("Id")));
  let id = 1; while (used.has(`rId${id}`)) id++;
  const e = doc.createElementNS(REL, "Relationship"); e.setAttribute("Id", `rId${id}`); e.setAttribute("Type", `${R}/notesSlide`); e.setAttribute("Target", rel(slidePath, path));
  doc.documentElement.appendChild(e); write(pkg, relsPath(slidePath), doc);
  const ct = parse(pkg, "[Content_Types].xml"); const o = ct.createElementNS("http://schemas.openxmlformats.org/package/2006/content-types", "Override");
  o.setAttribute("PartName", `/${path}`); o.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml");
  ct.documentElement.appendChild(o); write(pkg, "[Content_Types].xml", ct);
  return path;
}

export function editPptx(bytes: Uint8Array, ops: PptxOp[]): { bytes: Uint8Array; changes: number } {
  const pkg = openPkg(bytes);
  let changes = 0;
  for (const o of ops) {
    const order = slideOrder(pkg);
    const slidePath = (n: number) => { const p = order.paths[n - 1]; if (!p) throw new Error(`No existe la diapositiva ${n}.`); return p; };
    if (o.op === "replace") {
      let n = 0;
      const targets = o.slide ? [slidePath(o.slide)] : order.paths;
      for (const path of targets) {
        const d = parse(pkg, path); let m = 0;
        for (const p of els(d, A, "p")) m += replaceInNodes(els(p, A, "t"), o.find, o.replace, o.all ?? true);
        if (m) { write(pkg, path, d); n += m; }
        if (n && !(o.all ?? true)) break;
      }
      if (!n) throw new Error(`No se encontró «${o.find}».`);
      changes += n;
    } else if (o.op === "setShapeText") {
      const path = slidePath(o.slide), d = parse(pkg, path), shapes = shapesOf(d);
      const sp = typeof o.shape === "number" ? shapes[o.shape] : shapes.find((s) => shapeName(s) === o.shape);
      if (!sp) throw new Error(`No existe ese cuadro de texto en la diapositiva ${o.slide}.`);
      setBodyText(kids(sp, P, "txBody")[0]!, o.text); write(pkg, path, d); changes++;
    } else if (o.op === "setNotes") {
      const path = slidePath(o.slide);
      const np = notesPart(pkg, path) ?? addNotesSlide(pkg, path);
      const d = parse(pkg, np), body = notesBody(d);
      if (!body) throw new Error("Las notas de esa diapositiva no tienen cuadro de texto.");
      setBodyText(kids(body, P, "txBody")[0]!, o.text); write(pkg, np, d); changes++;
    } else if (o.op === "deleteSlide") {
      if (order.ids.length <= 1) throw new Error("La presentación debe conservar al menos una diapositiva.");
      const el = order.ids[o.slide - 1]; if (!el) throw new Error(`No existe la diapositiva ${o.slide}.`);
      const rid = el.getAttributeNS(R, "id"); order.lst!.removeChild(el); write(pkg, "ppt/presentation.xml", order.pres);
      const pr = rels(pkg, "ppt/presentation.xml"); const rel = pr.list.find((r) => r.id === rid);
      if (rel && pr.doc) { rel.el.parentNode?.removeChild(rel.el); write(pkg, relsPath("ppt/presentation.xml"), pr.doc); }
      changes++;
    } else if (o.op === "moveSlide") {
      const el = order.ids[o.slide - 1]; if (!el || o.to < 1 || o.to > order.ids.length) throw new Error("Posición de diapositiva no válida.");
      order.lst!.removeChild(el);
      const rest = kids(order.lst!, P, "sldId"); order.lst!.insertBefore(el, rest[o.to - 1] ?? null);
      write(pkg, "ppt/presentation.xml", order.pres); changes++;
    }
  }
  return { bytes: savePkg(pkg), changes };
}

export const officeKind = (name: string, mime = "") => /\.docx$/i.test(name) || mime.includes("wordprocessingml") ? "docx" : /\.pptx$/i.test(name) || mime.includes("presentationml") ? "pptx" : null;
