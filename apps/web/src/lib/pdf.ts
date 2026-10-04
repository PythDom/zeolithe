/**
 * Export notes to PDF with pdfmake: real text (selectable, searchable), a
 * clickable table of contents with page numbers, page numbers in the footer,
 * embedded images and Dataview results. pdfmake is loaded on first use.
 */
import {
  chordDiagramSvg,
  chordsFenceInstrument,
  displayValue,
  isLink,
  lookupFingerings,
  parseSheet,
  sheetChords,
  splitFrontmatter,
  transposeSheet,
  type Instrument,
  type QueryResult,
  type Value,
} from "@zeolite/core";
import { CHORD_DBS } from "./chord-db";
import type Token from "markdown-it/lib/token.mjs";
import { createMarkdown } from "./render";

// pdfmake's content tree (kept loose on purpose).
type Node = Record<string, unknown> | string | Node[];
type Run = Record<string, unknown>;

export interface PdfNote {
  path: string;
  title: string;
  markdown: string;
  id?: string;
  tags: string[];
  created?: string;
}

export interface PdfContext {
  /** Raw bytes of an attachment (by link target), if it exists. */
  readAsset(target: string): Promise<Blob | undefined>;
  runQuery(source: string, thisPath: string): QueryResult;
  /** Chord sheets as shown on screen (transposition, fingerings, diagrams). */
  chords?: {
    transpose(path: string, block: number): number;
    variant(symbol: string, instrument: Instrument): number;
    diagrams: boolean;
  };
}

export interface PdfOptions {
  pageSize: "A4" | "LETTER";
  /** ID, tags and creation date under the title. */
  properties: boolean;
  /** Add a table of contents at the top when the note has none. */
  toc: boolean;
}

const C = {
  fg: "#1d2525",
  muted: "#64716f",
  accent: "#0f6f69",
  soft: "#dcf5f1",
  border: "#dde4e3",
  code: "#f0f3f3",
  codeFg: "#9a3412",
  mark: "#fde68a",
  warn: "#b45309",
  warnSoft: "#fef3c7",
  danger: "#b91c1c",
};

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;

/**
 * The embedded PDF font (Roboto) has no emoji, arrows or symbol glyphs:
 * map common ones to text and drop the rest instead of printing boxes.
 */
const GLYPHS: Record<string, string> = {
  "→": "->", "⇒": "=>", "⟶": "->", "➜": "->", "←": "<-", "⇐": "<=", "↔": "<->",
  "↑": "^", "↓": "v", "♭": "b", "♯": "#", "♮": "", "✓": "(ok)", "✔": "(ok)", "☑": "[x]", "☐": "[ ]", "✗": "x", "✘": "x", "⚠": "!",
};
export function pdfText(s: string): string {
  return s
    .replace(/[→⇒⟶➜←⇐↔↑↓♭♯♮✓✔☑☐✗✘⚠]/g, (c) => GLYPHS[c] ?? "")
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]\uFE0F?\s?|\uFE0F|\u200D/gu, "");
}
const TASK_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s?/;

/** Checkbox drawn as SVG (the PDF font has no ballot-box glyphs). */
const box = (checked: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" rx="1.5" fill="${checked ? C.accent : "#ffffff"}" stroke="${checked ? C.accent : "#8a9896"}"/>${checked ? '<path d="M2.2 5.2 L4.2 7.1 L7.9 2.9" stroke="#ffffff" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' : ""}</svg>`;

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

/** PNG data URL for formats pdfmake cannot embed directly (gif, webp, bmp). */
async function rasterize(b: Blob): Promise<string> {
  const bmp = await createImageBitmap(b);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0);
  return canvas.toDataURL("image/png");
}

/** Image nodes for every embed in the notes, resolved before layout. */
async function loadImages(notes: PdfNote[], ctx: PdfContext): Promise<Map<string, Record<string, unknown>>> {
  const targets = new Set<string>();
  for (const n of notes) {
    for (const m of n.markdown.matchAll(/!\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]|!\[[^\]]*\]\(([^)\s]+)/g)) {
      const t = (m[1] ?? decodeURI(m[2] ?? "")).trim();
      if (IMAGE.test(t)) targets.add(t);
    }
  }
  const out = new Map<string, Record<string, unknown>>();
  for (const t of targets) {
    try {
      const blob = await ctx.readAsset(t);
      if (!blob) continue;
      if (/\.svg$/i.test(t)) out.set(t, { svg: await blob.text() });
      else if (/\.(png|jpe?g)$/i.test(t)) out.set(t, { image: await blobToDataUrl(blob) });
      else out.set(t, { image: await rasterize(blob) });
    } catch {
      // An unreadable image is shown as missing.
    }
  }
  return out;
}

const thinBox = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => C.border,
  vLineColor: () => C.border,
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};

// ---------------------------------------------------------------------------
// Markdown → pdfmake

class Builder {
  private md = createMarkdown();
  private chordBlock = 0;
  hasToc = false;

  constructor(
    private images: Map<string, Record<string, unknown>>,
    private ctx: PdfContext,
    private note: PdfNote,
  ) {}

  build(): Node[] {
    const tokens = this.md.parse(splitFrontmatter(this.note.markdown).body, {});
    return this.blocks(tokens, 0, tokens.length);
  }

  /** Convert block tokens in [from, to). */
  private blocks(t: Token[], from: number, to: number): Node[] {
    const out: Node[] = [];
    let i = from;
    while (i < to) {
      const tok = t[i]!;
      switch (tok.type) {
        case "heading_open": {
          const level = Number(tok.tag.slice(1));
          const node: Record<string, unknown> = { text: this.inline(t[i + 1]!), style: `h${level}` };
          if (level === 2 || level === 3) {
            node.tocItem = true;
            node.tocStyle = `toc${level}`;
            node.tocMargin = [level === 3 ? 14 : 0, 0, 0, 2];
          }
          out.push(node);
          i += 3;
          break;
        }
        case "paragraph_open": {
          const close = this.close(t, i, "paragraph_close");
          const cls = tok.attrGet("class") ?? "";
          const para = this.paragraph(t[i + 1]!);
          if (/\battn\b/.test(cls)) out.push(this.bar(para, C.warn, /resolved/.test(cls) ? undefined : C.warnSoft));
          else out.push(para);
          i = close + 1;
          break;
        }
        case "bullet_list_open":
        case "ordered_list_open": {
          const close = this.close(t, i, tok.type.replace("open", "close"));
          out.push(this.list(t, i, close));
          i = close + 1;
          break;
        }
        case "blockquote_open": {
          const close = this.close(t, i, "blockquote_close");
          const inner = this.blocks(t, i + 1, close);
          const callout = /\bcallout\b/.test(tok.attrGet("class") ?? "");
          out.push(callout ? this.bar(inner, C.accent, C.soft) : this.bar(inner, C.border, undefined, C.muted));
          i = close + 1;
          break;
        }
        case "fence":
        case "code_block": {
          const lang = tok.info.trim().split(/\s+/)[0]?.toLowerCase();
          if (lang === "toc") {
            this.hasToc = true;
            out.push({ toc: { title: { text: "CONTENTS", style: "tocTitle" } }, margin: [0, 0, 0, 12] });
          } else if (lang === "dataview" || lang === "query") {
            out.push(this.query(tok.content));
          } else if (chordsFenceInstrument(tok.info)) {
            out.push(this.chordSheet(tok.content.replace(/\n$/, ""), chordsFenceInstrument(tok.info)!, this.chordBlock++));
          } else {
            out.push(this.code(tok.content));
          }
          i++;
          break;
        }
        case "table_open": {
          const close = this.close(t, i, "table_close");
          out.push(this.table(t, i, close));
          i = close + 1;
          break;
        }
        case "hr":
          out.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6, lineColor: C.border }], margin: [0, 8, 0, 8] });
          i++;
          break;
        case "html_block": {
          const text = tok.content.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").trim();
          if (text) out.push({ text, style: "p" });
          i++;
          break;
        }
        default:
          i++;
      }
    }
    return out;
  }

  /** Index of the matching closing token. */
  private close(t: Token[], open: number, type: string): number {
    const level = t[open]!.level;
    for (let j = open + 1; j < t.length; j++) if (t[j]!.type === type && t[j]!.level === level) return j;
    return t.length - 1;
  }

  /** Box with a coloured left border (quotes, callouts, Attn points). */
  private bar(content: Node, color: string, fill?: string, textColor?: string): Node {
    return {
      table: {
        widths: ["*"],
        body: [[{ stack: Array.isArray(content) ? content : [content], fillColor: fill, color: textColor, margin: [8, 4, 6, 2] }]],
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: (i: number) => (i === 0 ? 2.5 : 0),
        vLineColor: () => color,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 0,
        paddingBottom: () => 0,
      },
      margin: [0, 2, 0, 8],
    };
  }

  /**
   * A chord sheet: diagrams row, then the sheet in a monospaced font so
   * chords stay above their syllables. A chord line and the lyrics under it
   * are kept on the same page.
   */
  private chordSheet(source: string, instrument: Instrument, block: number): Node {
    const view = this.ctx.chords;
    const shift = view?.transpose(this.note.path, block) ?? 0;
    const text = shift ? transposeSheet(source, shift) : source;
    const parts: Node[] = [];

    if (view?.diagrams !== false) {
      const colors = { line: "#8a9896", dot: C.fg, text: C.fg, onDot: "#ffffff" };
      const cards = sheetChords(text).map((sym) => {
        const list = lookupFingerings(CHORD_DBS[instrument], sym, instrument);
        const f = list.length ? list[(view?.variant(sym, instrument) ?? 0) % list.length]! : null;
        return { svg: chordDiagramSvg(sym.replace(/\[[^\]]*\]$/, ""), f, instrument, colors, 60), width: 60 };
      });
      for (let i = 0; i < cards.length; i += 8) {
        parts.push({ columns: cards.slice(i, i + 8), columnGap: 4, margin: [0, 0, 0, 4] });
      }
    }

    const lines = parseSheet(text);
    const lineNode = (l: (typeof lines)[number]): Node => {
      if (l.kind === "empty") return { text: " ", style: "sheet" };
      if (l.kind === "section") return { text: pdfText(l.text), style: "sheet", bold: true, color: C.muted, margin: [0, 4, 0, 0] };
      // Custom shapes ([x13333]) become spaces so later chords keep their columns.
      if (l.kind === "chords") return { text: pdfText(l.text.replace(/(\S)(\[[^\]]*\])/g, (_m, c: string, shape: string) => c + " ".repeat(shape.length))), style: "sheet", bold: true, color: C.accent };
      if (!l.chords.length) return { text: pdfText(l.text), style: "sheet" };
      const runs: Run[] = [];
      let col = 0;
      for (const c of l.chords) {
        runs.push({ text: pdfText(l.text.slice(col, c.start - 1)) });
        runs.push({ text: c.symbol.replace(/\[[^\]]*\]$/, ""), bold: true, color: C.accent, background: C.soft });
        col = c.end + 1;
      }
      runs.push({ text: pdfText(l.text.slice(col)) });
      return { text: runs, style: "sheet" };
    };
    const sheet: Node[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      const next = lines[i + 1];
      if (l.kind === "chords" && next?.kind === "lyrics") {
        sheet.push({ stack: [lineNode(l), lineNode(next)], unbreakable: true });
        i++;
      } else {
        sheet.push(lineNode(l));
      }
    }
    if (shift) parts.unshift({ text: `TRANSPOSED ${shift > 0 ? "+" : ""}${shift}`, style: "label" });
    parts.push({ stack: sheet, margin: [0, 2, 0, 0] });
    return { stack: parts, margin: [0, 2, 0, 12] };
  }

  private code(text: string): Node {
    return {
      table: { widths: ["*"], body: [[{ text: pdfText(text.replace(/\n$/, "")), style: "code", preserveLeadingSpaces: true }]] },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        fillColor: () => C.code,
        paddingLeft: () => 8,
        paddingRight: () => 8,
        paddingTop: () => 6,
        paddingBottom: () => 6,
      },
      margin: [0, 2, 0, 10],
    };
  }

  /** Paragraph: text runs, split around embedded images. */
  private paragraph(inline: Token): Node {
    const parts: Node[] = [];
    let runs: Run[] = [];
    const flush = () => {
      if (runs.some((r) => String(r.text ?? "").trim())) parts.push({ text: runs, style: "p" });
      runs = [];
    };
    for (const r of this.inline(inline, (img) => (flush(), parts.push(img)))) runs.push(r);
    flush();
    return parts.length === 1 ? parts[0]! : { stack: parts };
  }

  private imageNode(target: string, size?: string): Node {
    const name = target.split("/").pop();
    const img = this.images.get(target) ?? [...this.images].find(([k]) => k.split("/").pop() === name)?.[1];
    if (!img) return { text: `[missing image: ${target}]`, color: C.muted, italics: true };
    const width = size && /^\d+/.test(size) ? Math.min(Number(size.split("x")[0]), 515) : undefined;
    return { ...img, ...(width ? { width } : { fit: [515, 420] }), margin: [0, 4, 0, 8] };
  }

  /** Inline tokens → pdfmake text runs. `onImage` receives block images. */
  private inline(tok: Token, onImage?: (n: Node) => void): Run[] {
    const runs: Run[] = [];
    const style: { bold?: boolean; italics?: boolean; strike?: boolean; link?: string } = {};
    const push = (raw: string, extra: Run = {}) => {
      const text = pdfText(raw);
      if (!text) return;
      runs.push({
        text,
        ...(style.bold ? { bold: true } : {}),
        ...(style.italics ? { italics: true } : {}),
        ...(style.strike ? { decoration: "lineThrough" } : {}),
        ...(style.link ? { link: style.link, color: C.accent, decoration: "underline" } : {}),
        ...extra,
      });
    };
    for (const c of tok.children ?? []) {
      switch (c.type) {
        case "text":
          push(c.content);
          break;
        case "softbreak":
          // As on screen: one line break in the note is a line break.
          push("\n");
          break;
        case "hardbreak":
          push("\n");
          break;
        case "strong_open":
        case "strong_close":
          style.bold = c.type === "strong_open";
          break;
        case "em_open":
        case "em_close":
          style.italics = c.type === "em_open";
          break;
        case "s_open":
        case "s_close":
          style.strike = c.type === "s_open";
          break;
        case "link_open":
          style.link = c.attrGet("href") ?? undefined;
          break;
        case "link_close":
          style.link = undefined;
          break;
        case "code_inline":
          push(c.content, { background: C.code, color: C.codeFg, fontSize: 9.5 });
          break;
        case "mark":
          push((c.meta as RegExpExecArray)[1]!, { background: C.mark });
          break;
        case "tag":
          push(`#${(c.meta as RegExpExecArray)[1]}`, { color: C.accent });
          break;
        case "person":
          push(`@${(c.meta as RegExpExecArray)[1]}`, { color: C.accent, bold: true });
          break;
        case "field": {
          const m = c.meta as RegExpExecArray;
          const key = m[1]!.trim();
          const attn = key.toLowerCase() === "attn";
          push(` ${key} `, { fontSize: 8.5, bold: attn, color: attn ? C.warn : C.muted, background: attn ? C.warnSoft : C.code });
          push(` ${m[2]} `, { fontSize: 8.5, background: attn ? C.warnSoft : C.code });
          break;
        }
        case "linefield": {
          const key = (c.meta as RegExpExecArray)[1]!;
          push(`${key}: `, { bold: true, color: key.toLowerCase() === "attn" ? C.warn : C.muted });
          break;
        }
        case "wikilink": {
          const { embed, raw } = c.meta as { embed: boolean; raw: string };
          const [target, alias] = raw.split("|") as [string, string | undefined];
          const name = target.split("#")[0]!.trim();
          if (embed && IMAGE.test(name) && onImage) onImage(this.imageNode(name, alias));
          else push(alias ?? target, { color: C.accent });
          break;
        }
        case "image": {
          const src = decodeURI(c.attrGet("src") ?? "");
          if (onImage && IMAGE.test(src) && !/^https?:/.test(src)) onImage(this.imageNode(src));
          else push(c.content || src, { color: C.muted, italics: true });
          break;
        }
        case "html_inline":
          // Task checkboxes are drawn by the list; callout titles become bold text.
          if (/callout-title/.test(c.content)) push(`${c.content.replace(/<[^>]+>/g, "")}\n`, { bold: true });
          break;
        default:
          break;
      }
    }
    return runs;
  }

  private taskMark(status: string): Node {
    if (status === "open" || status === "done") return { svg: box(status === "done"), width: 10, margin: [0, 2.5, 0, 0] };
    return { text: status === "cancelled" ? "×" : "»", width: 10, color: C.muted, bold: true };
  }

  private list(t: Token[], open: number, close: number): Node {
    const ordered = t[open]!.type === "ordered_list_open";
    const items: Node[] = [];
    let anyTask = false;
    for (let i = open + 1; i < close; ) {
      const item = t[i]!;
      if (item.type !== "list_item_open") {
        i++;
        continue;
      }
      const end = this.close(t, i, "list_item_close");
      const status = item.attrGet("data-status");
      const inner = this.blocks(t, i + 1, end).map((n) => (n && typeof n === "object" && !Array.isArray(n) ? { ...n, margin: [0, 0, 0, 2] } : n));
      if (status) {
        anyTask = true;
        const dim = status === "done" || status === "cancelled" ? { color: C.muted, decoration: "lineThrough" } : {};
        const [first, ...rest] = inner;
        const firstNode = first && typeof first === "object" && !Array.isArray(first) ? { ...first, ...dim } : (first ?? "");
        items.push({
          stack: [
            { columns: [this.taskMark(status), { stack: [firstNode], width: "*" }], columnGap: 6 },
            ...rest.map((r) => ({ stack: [r], margin: [16, 0, 0, 0] })),
          ],
        });
      } else {
        items.push({ stack: inner });
      }
      i = end + 1;
    }
    if (anyTask && !ordered) return { stack: items, margin: [0, 0, 0, 8] };
    return { [ordered ? "ol" : "ul"]: items, margin: [0, 0, 0, 8], markerColor: C.muted };
  }

  private table(t: Token[], open: number, close: number): Node {
    const rows: Node[][] = [];
    let row: Node[] = [];
    for (let i = open; i < close; i++) {
      const tok = t[i]!;
      if (tok.type === "tr_open") row = [];
      else if (tok.type === "th_open" || tok.type === "td_open") {
        const th = tok.type === "th_open";
        row.push({ text: this.inline(t[i + 1]!), bold: th, fillColor: th ? "#f6f8f8" : undefined });
      } else if (tok.type === "tr_close") rows.push(row);
    }
    const cols = Math.max(...rows.map((r) => r.length));
    for (const r of rows) while (r.length < cols) r.push("");
    return { table: { headerRows: 1, widths: Array(cols).fill("auto"), body: rows }, layout: thinBox, style: "table", margin: [0, 2, 0, 10] };
  }

  private valueRuns(v: Value): Run[] {
    if (isLink(v)) return [{ text: v.name, color: C.accent }];
    if (Array.isArray(v)) return v.flatMap((x, i) => [...(i ? [{ text: ", " }] : []), ...this.valueRuns(x)]);
    return [{ text: displayValue(v) }];
  }

  /** Dataview block → its results at export time. */
  private query(source: string): Node {
    let res: QueryResult;
    try {
      res = this.ctx.runQuery(source, this.note.path);
    } catch (e) {
      return this.bar({ text: `Dataview query error: ${(e as Error).message}`, color: C.danger }, C.danger);
    }
    const noun = res.kind === "task" ? "task" : res.kind === "attn" ? "Attn point" : "note";
    const parts: Node[] = [{ text: `DATAVIEW · ${res.count} ${noun.toUpperCase()}${res.count === 1 ? "" : "S"}`, style: "label" }];
    for (const g of res.groups) {
      if (g.key !== undefined) parts.push({ text: g.key === null ? "(none)" : this.valueRuns(g.key), bold: true, margin: [0, 6, 0, 2] });
      if (res.kind === "table") {
        const head = res.headers.map((h) => ({ text: h, bold: true, fillColor: "#f6f8f8" }));
        const body = g.rows.map((r) => [
          ...(res.withoutId ? [] : [{ text: r.name, color: C.accent }]),
          ...r.values.map((v) => ({ text: this.valueRuns(v) })),
        ]);
        parts.push({ table: { headerRows: 1, widths: Array(head.length).fill("auto"), body: [head, ...body] }, layout: thinBox, style: "table" });
        continue;
      }
      for (const r of g.rows) {
        if (r.task) {
          const text = this.inline(this.md.parseInline(r.task.raw.replace(TASK_PREFIX, ""), {})[0]!);
          parts.push({
            columns: [this.taskMark(r.task.status), { text, width: "*", ...(r.task.status === "done" ? { color: C.muted } : {}) }],
            columnGap: 6,
            margin: [0, 1, 0, 1],
          });
        } else if (r.attn) {
          parts.push({
            text: [{ text: "Attn: ", bold: true, color: C.warn }, { text: r.attn.text }, { text: `  · ${r.name}`, color: C.muted, fontSize: 9 }],
            margin: [0, 1, 0, 1],
          });
        } else {
          const values = r.values.length ? [{ text: ": " }, ...r.values.flatMap((v) => this.valueRuns(v))] : [];
          parts.push({ text: [{ text: "• ", color: C.muted }, { text: r.name, color: C.accent }, ...values], margin: [0, 1, 0, 1] });
        }
      }
    }
    if (res.count === 0) parts.push({ text: `No matching ${noun}s.`, color: C.muted, italics: true });
    return {
      table: { widths: ["*"], body: [[{ stack: parts, margin: [8, 6, 8, 6] }]] },
      layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => C.border, vLineColor: () => C.border },
      margin: [0, 2, 0, 10],
    };
  }
}

function properties(note: PdfNote): Node | null {
  const bits: Run[] = [];
  if (note.id) bits.push({ text: note.id, bold: true, color: C.accent });
  if (note.tags.length) bits.push({ text: note.tags.map((t) => `#${t}`).join("  "), color: C.accent });
  if (note.created) bits.push({ text: `Created ${note.created.replace("T", " ")}`, color: C.muted });
  if (!bits.length) return null;
  return { text: bits.flatMap((b, i) => (i ? [{ text: "   ·   ", color: C.border }, b] : [b])), fontSize: 9, margin: [0, 0, 0, 10] };
}

type PdfMake = { createPdf(doc: unknown): { getBlob(): Promise<Blob> } };
let pdfMakePromise: Promise<PdfMake> | null = null;

/** pdfmake and its fonts (~2 MB) are only loaded when exporting. */
function loadPdfMake(): Promise<PdfMake> {
  pdfMakePromise ??= (async () => {
    const [{ default: pdfMake }, { default: vfs }, mono] = await Promise.all([
      import("pdfmake/build/pdfmake"),
      import("pdfmake/build/vfs_fonts"),
      import("./pdf-fonts"),
    ]);
    const pm = pdfMake as { addVirtualFileSystem(v: unknown): void; addFonts(f: unknown): void };
    pm.addVirtualFileSystem(vfs);
    pm.addVirtualFileSystem(mono.monoVfs);
    pm.addFonts(mono.monoFonts);
    return pdfMake as PdfMake;
  })();
  return pdfMakePromise;
}

/** Build one PDF from one or more notes (each note starts on a new page). */
export async function exportPdf(notes: PdfNote[], ctx: PdfContext, opts: PdfOptions): Promise<Blob> {
  if (notes.length === 0) throw new Error("Nothing to export.");
  const [pdfMake, images] = await Promise.all([loadPdfMake(), loadImages(notes, ctx)]);
  const content: Node[] = [];
  let tocInNotes = false;
  let tocAt = 0;

  notes.forEach((note, n) => {
    const b = new Builder(images, ctx, note);
    const blocks = b.build();
    tocInNotes ||= b.hasToc;
    if (n > 0) content.push({ text: "", pageBreak: "before" });
    const firstLine = splitFrontmatter(note.markdown).body.split("\n").find((l) => l.trim()) ?? "";
    // Title: the note's own H1, or its name.
    if (/^#\s/.test(firstLine)) content.push(blocks.shift()!);
    else content.push({ text: pdfText(note.title), style: "h1" });
    const props = opts.properties ? properties(note) : null;
    if (props) content.push(props);
    if (n === 0) tocAt = content.length;
    content.push(...blocks);
  });
  if (opts.toc && !tocInNotes) content.splice(tocAt, 0, { toc: { title: { text: "CONTENTS", style: "tocTitle" } }, margin: [0, 0, 0, 14] });

  const title = notes.length === 1 ? notes[0]!.title : `${notes[0]!.title} (+${notes.length - 1})`;
  const doc = {
    pageSize: opts.pageSize,
    pageMargins: [40, 48, 40, 52],
    info: { title, creator: "Zeolite", producer: "Zeolite" },
    content,
    footer: (page: number, pages: number) => ({
      columns: [
        { text: title, color: C.muted, fontSize: 8, margin: [40, 0, 0, 0] },
        { text: `${page} / ${pages}`, alignment: "right", color: C.muted, fontSize: 8, margin: [0, 0, 40, 0] },
      ],
      margin: [0, 18, 0, 0],
    }),
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.3, color: C.fg },
    styles: {
      h1: { fontSize: 20, bold: true, margin: [0, 0, 0, 6] },
      h2: { fontSize: 15, bold: true, margin: [0, 12, 0, 6], color: C.accent },
      h3: { fontSize: 12.5, bold: true, margin: [0, 10, 0, 4] },
      h4: { fontSize: 11, bold: true, margin: [0, 8, 0, 3] },
      h5: { fontSize: 10.5, bold: true, margin: [0, 6, 0, 2] },
      h6: { fontSize: 10.5, bold: true, italics: true, margin: [0, 6, 0, 2] },
      p: { margin: [0, 0, 0, 7] },
      code: { font: "RobotoMono", fontSize: 8.5, lineHeight: 1.25 },
      sheet: { font: "RobotoMono", fontSize: 9.5, lineHeight: 1.2, preserveLeadingSpaces: true },
      table: { fontSize: 9.5 },
      label: { fontSize: 7.5, bold: true, color: C.muted, characterSpacing: 0.6, margin: [0, 0, 0, 3] },
      tocTitle: { fontSize: 8, bold: true, color: C.muted, characterSpacing: 0.8, margin: [0, 0, 0, 4] },
      toc2: { fontSize: 10 },
      toc3: { fontSize: 9.5, color: C.muted },
    },
  };
  return pdfMake.createPdf(doc).getBlob();
}
