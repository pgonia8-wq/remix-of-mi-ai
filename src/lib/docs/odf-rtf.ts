// OpenDocument Text (.odt) and Rich Text Format (.rtf): read text and write documents on the phone, no server.
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { parseMarkdown } from "./markdown";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------- ODT
const TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const TABLE = "urn:oasis:names:tc:opendocument:xmlns:table:1.0";
export function readOdt(bytes: Uint8Array): string {
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes); } catch { throw new Error("El archivo no es un ODT válido."); }
  const raw = files["content.xml"]; if (!raw) throw new Error("El ODT no tiene contenido.");
  const d = new DOMParser().parseFromString(strFromU8(raw), "application/xml");
  const out: string[] = [];
  const inline = (n: Node): string => {
    let s = "";
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) s += c.nodeValue ?? "";
      else if (c.nodeType === 1) {
        const e = c as Element;
        if (e.namespaceURI === TEXT && e.localName === "s") s += " ".repeat(Number(e.getAttributeNS(TEXT, "c") ?? "1") || 1);
        else if (e.namespaceURI === TEXT && e.localName === "tab") s += "\t";
        else if (e.namespaceURI === TEXT && e.localName === "line-break") s += "\n";
        else if (!(e.namespaceURI === TEXT && e.localName === "note")) s += inline(e);
      }
    }
    return s;
  };
  const walk = (n: Element) => {
    for (const c of Array.from(n.children)) {
      if (c.namespaceURI === TEXT && c.localName === "h") out.push(`${"#".repeat(Math.min(3, Number(c.getAttributeNS(TEXT, "outline-level") ?? "1") || 1))} ${inline(c)}`);
      else if (c.namespaceURI === TEXT && c.localName === "p") out.push(inline(c));
      else if (c.namespaceURI === TEXT && c.localName === "list-item") { for (const p of Array.from(c.getElementsByTagNameNS(TEXT, "p"))) out.push(`- ${inline(p)}`); }
      else if (c.namespaceURI === TABLE && c.localName === "table-row") out.push("| " + Array.from(c.getElementsByTagNameNS(TABLE, "table-cell")).map((x) => inline(x).trim()).join(" | ") + " |");
      else walk(c);
    }
  };
  walk(d.documentElement);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function writeOdt(md: string, title: string): Uint8Array {
  const body: string[] = [`<text:h text:style-name="Title" text:outline-level="1">${esc(title)}</text:h>`];
  for (const b of parseMarkdown(md)) {
    if (b.t === "h") body.push(`<text:h text:style-name="Heading_20_${b.level}" text:outline-level="${b.level}">${esc(b.text)}</text:h>`);
    else if (b.t === "p") body.push(`<text:p text:style-name="Text_20_body">${esc(b.text)}</text:p>`);
    else if (b.t === "li") body.push(`<text:list><text:list-item><text:p text:style-name="Text_20_body">${esc(b.text)}</text:p></text:list-item></text:list>`);
    else if (b.t === "table") {
      const cols = Math.max(...b.rows.map((r) => r.length));
      body.push(`<table:table table:name="Tabla${body.length}"><table:table-column table:number-columns-repeated="${cols}"/>${b.rows.map((r) => `<table:table-row>${Array.from({ length: cols }, (_, i) => `<table:table-cell office:value-type="string"><text:p>${esc(r[i] ?? "")}</text:p></table:table-cell>`).join("")}</table:table-row>`).join("")}</table:table>`);
    } else body.push(`<text:p/>`);
  }
  const ns = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="${TEXT}" xmlns:table="${TABLE}" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${ns}><office:styles>
<style:style style:name="Standard" style:family="paragraph"><style:text-properties style:font-name="Liberation Sans" fo:font-size="11pt"/></style:style>
<style:style style:name="Text_20_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-bottom="0.2cm" fo:line-height="130%"/></style:style>
<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Standard"><style:text-properties fo:font-size="24pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:default-outline-level="1"><style:paragraph-properties fo:margin-top="0.4cm" fo:margin-bottom="0.2cm"/><style:text-properties fo:font-size="18pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:default-outline-level="2"><style:text-properties fo:font-size="15pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:default-outline-level="3"><style:text-properties fo:font-size="13pt" fo:font-weight="bold"/></style:style>
</office:styles></office:document-styles>`;
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ns}><office:body><office:text>${body.join("")}</office:text></office:body></office:document-content>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.3"><office:meta><dc:title>${esc(title)}</dc:title><meta:generator>MI AI</meta:generator></office:meta></office:document-meta>`;
  // The ODF spec requires "mimetype" first and uncompressed.
  return zipSync({ mimetype: [strToU8("application/vnd.oasis.opendocument.text"), { level: 0 }], "content.xml": strToU8(content), "styles.xml": strToU8(styles), "meta.xml": strToU8(meta), "META-INF/manifest.xml": strToU8(manifest) });
}

// ---------------------------------------------------------------- RTF
const SKIP = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "headerl", "headerr", "footerl", "footerr", "listtable", "listoverridetable", "rsidtbl", "generator", "xmlnstbl", "themedata", "colorschememapping", "latentstyles", "datastore", "fldinst"]);
const CP1252: Record<number, number> = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030, 0x8a: 0x160, 0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153, 0x9e: 0x17e, 0x9f: 0x178 };

export function readRtf(src: string): string {
  if (!src.trimStart().startsWith("{\\rtf")) throw new Error("El archivo no es RTF.");
  let out = "", i = 0, uc = 1, skipChars = 0;
  const stack: { skip: boolean; uc: number }[] = []; let skip = false;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "{") { stack.push({ skip, uc }); i++; if (src.startsWith("\\*", i)) { skip = true; } continue; }
    if (ch === "}") { const s = stack.pop(); if (s) { skip = s.skip; uc = s.uc; } i++; continue; }
    if (ch === "\\") {
      const nx = src[i + 1] ?? "";
      if (nx === "\\" || nx === "{" || nx === "}") { if (!skip) { if (skipChars) skipChars--; else out += nx; } i += 2; continue; }
      if (nx === "'") { const code = parseInt(src.slice(i + 2, i + 4), 16); if (!skip) { if (skipChars) skipChars--; else out += String.fromCharCode(CP1252[code] ?? code); } i += 4; continue; }
      if (nx === "~") { if (!skip) out += "\u00a0"; i += 2; continue; }
      if (nx === "\n" || nx === "\r") { if (!skip) out += "\n"; i += 2; continue; }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i, i + 40));
      if (!m) { i += 2; continue; }
      const word = m[1]!, arg = m[2] === undefined ? null : Number(m[2]); i += m[0].length;
      if (SKIP.has(word)) { skip = true; continue; }
      if (skip) continue;
      if (word === "par" || word === "line" || word === "sect" || word === "page") out += "\n";
      else if (word === "tab") out += "\t";
      else if (word === "cell") out += " | ";
      else if (word === "row") out += "\n";
      else if (word === "uc" && arg !== null) uc = arg;
      else if (word === "u" && arg !== null) { out += String.fromCharCode(arg < 0 ? arg + 65536 : arg); skipChars = uc; }
      else if (word === "emdash") out += "—"; else if (word === "endash") out += "–"; else if (word === "bullet") out += "•";
      else if (word === "lquote") out += "‘"; else if (word === "rquote") out += "’"; else if (word === "ldblquote") out += "“"; else if (word === "rdblquote") out += "”";
      continue;
    }
    if (ch === "\r" || ch === "\n") { i++; continue; }
    if (!skip) { if (skipChars) skipChars--; else out += ch; }
    i++;
  }
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

const rtfText = (s: string) => {
  let o = "";
  for (const c of s) {
    const n = c.codePointAt(0)!;
    if (c === "\\" || c === "{" || c === "}") o += "\\" + c;
    else if (c === "\n") o += "\\line ";
    else if (n < 128) o += c;
    else if (n < 0x10000) o += `\\u${n > 32767 ? n - 65536 : n}?`;
    else { const hi = 0xd800 + ((n - 0x10000) >> 10), lo = 0xdc00 + ((n - 0x10000) & 0x3ff); o += `\\u${hi - 65536}?\\u${lo - 65536}?`; }
  }
  return o;
};
/** Inline **bold** and *italic* survive Markdown parsing as control markers and become RTF formatting. */
const markInline = (md: string) => md.replace(/\*\*(.+?)\*\*/g, "\u0001$1\u0002").replace(/(^|[^*])\*([^*\n]+?)\*/g, "$1\u0003$2\u0004");
const rtfInline = (s: string) => rtfText(s).replace(/\u0001/g, "{\\b ").replace(/\u0003/g, "{\\i ").replace(/[\u0002\u0004]/g, "}");

export function writeRtf(md: string, title: string): Uint8Array {
  const parts = [`{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1{\\fonttbl{\\f0\\fswiss Arial;}}{\\info{\\title ${rtfText(title)}}}\\viewkind4\\f0\\fs22`, `{\\pard\\sb0\\sa200\\b\\fs40 ${rtfText(title)}\\par}`];
  const clean = (t: string) => t.replace(/[\u0001-\u0004]/g, "");
  for (const b of parseMarkdown(markInline(md))) {
    if (b.t === "h") parts.push(`{\\pard\\sb240\\sa120\\b\\fs${b.level === 1 ? 32 : b.level === 2 ? 28 : 24} ${rtfText(clean(b.text))}\\par}`);
    else if (b.t === "p") parts.push(`{\\pard\\sa160 ${rtfInline(b.text)}\\par}`);
    else if (b.t === "li") parts.push(`{\\pard\\fi-280\\li560\\sa80 \\bullet\\tab ${rtfInline(b.text)}\\par}`);
    else if (b.t === "table") for (const r of b.rows) { let x = 0; parts.push(`\\trowd\\trgaph108${r.map(() => `\\cellx${(x += 2200)}`).join("")}${r.map((c) => `\\pard\\intbl ${rtfText(clean(c))}\\cell`).join("")}\\row`); }
    else parts.push("\\par");
  }
  parts.push("}");
  return new TextEncoder().encode(parts.join("\n"));
}
