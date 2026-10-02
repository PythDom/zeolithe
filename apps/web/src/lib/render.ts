import {
  chordDiagramSvg,
  chordsFenceInstrument,
  displayValue,
  generateToc,
  headingLinkText,
  isLink,
  lookupFingerings,
  parseSheet,
  sheetChords,
  splitFrontmatter,
  targetSpelling,
  transposeChord,
  transposeSheet,
  type Instrument,
  type QueryResult,
  type ResultRow,
  type Value,
} from "@zeolite/core";
import { CHORD_DBS } from "./chord-db";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type Token from "markdown-it/lib/token.mjs";

export interface RenderContext {
  /** Object URL for an image attachment, if it exists. */
  resolveAsset(target: string): string | undefined;
  /** Vault path of a linked note, if it exists. */
  resolveNote(target: string): string | undefined;
  /** Run a Dataview query over the vault (throws QueryError on bad queries). */
  runQuery(source: string): QueryResult;
  /** View state of chord sheets (transposition, fingerings, diagrams). */
  chords?: ChordView;
}

export interface ChordView {
  /** Semitones shown for the n-th chords block of the note. */
  transpose(block: number): number;
  /** Selected fingering index for a chord. */
  variant(symbol: string, instrument: Instrument): number;
  diagrams: boolean;
  /** Autoscroll state of the note (speed 1–10, saved in its properties). */
  autoscroll?: { on: boolean; speed: number };
}

const INSTRUMENT_LABEL: Record<Instrument, string> = { guitar: "Guitar", ukulele: "Ukulele", mandolin: "Mandolin" };

/** Diagram for a chord (used by the cards and the hover popup). */
export function chordDiagram(symbol: string, instrument: Instrument, variant = 0, width = 84): { svg: string; count: number; index: number } {
  const list = lookupFingerings(CHORD_DBS[instrument], symbol, instrument);
  const index = list.length ? variant % list.length : 0;
  const name = symbol.replace(/\[[^\]]*\]$/, "");
  return { svg: chordDiagramSvg(name, list[index] ?? null, instrument, undefined, width), count: list.length, index };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export function slug(text: string): string {
  return "h-" + headingLinkText(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

// --- inline rules ------------------------------------------------------------

/** [[target#heading|alias]] and ![[embed|size]] */
function wikiLinks(md: MarkdownIt) {
  md.inline.ruler.before("link", "wikilink", (state: StateInline, silent: boolean) => {
    const src = state.src.slice(state.pos);
    const m = /^(!?)\[\[([^\]\n]+?)\]\]/.exec(src);
    if (!m) return false;
    if (!silent) {
      const t = state.push("wikilink", "", 0);
      t.meta = { embed: m[1] === "!", raw: m[2] };
    }
    state.pos += m[0].length;
    return true;
  });
}

type Boundary = "none" | "word" | "line";

function simpleInline(md: MarkdownIt, name: string, re: RegExp, before: string, boundary: Boundary = "none") {
  md.inline.ruler.before(before, name, (state: StateInline, silent: boolean) => {
    const prev = state.pos > 0 ? state.src[state.pos - 1]! : "\n";
    if (boundary === "word" && !/[\s(,;]/.test(prev)) return false;
    if (boundary === "line" && prev !== "\n") return false;
    const m = re.exec(state.src.slice(state.pos));
    if (!m) return false;
    if (!silent) {
      const t = state.push(name, "", 0);
      t.meta = m;
    }
    state.pos += m[0].length;
    return true;
  });
}

// --- core rules ---------------------------------------------------------------

/** Turn `- [ ] text` list items into checkboxes carrying their source line. */
function taskItems(lineOffset: () => number) {
  return (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i]!;
      if (open.type !== "list_item_open") continue;
      const inline = tokens[i + 2];
      if (!inline || inline.type !== "inline") continue;
      const m = /^\[(.)\](\s|$)/.exec(inline.content);
      if (!m) continue;
      const char = m[1]!;
      const status = char === " " ? "open" : char.toLowerCase() === "x" ? "done" : char === "-" ? "cancelled" : char === ">" ? "deferred" : "other";
      const line = (open.map?.[0] ?? 0) + lineOffset();
      open.attrJoin("class", `task task-${status}`);
      open.attrSet("data-line", String(line));
      const first = inline.children?.[0];
      if (first?.type === "text") first.content = first.content.slice(m[0].length);
      const box = new state.Token("html_inline", "", 0);
      box.content =
        status === "open" || status === "done"
          ? `<input type="checkbox" class="task-box" data-line="${line}"${status === "done" ? " checked" : ""}> `
          : `<span class="task-mark" data-line="${line}" title="${status}">${status === "cancelled" ? "✕" : status === "deferred" ? "➜" : esc(char)}</span> `;
      inline.children?.unshift(box);
      open.attrSet("data-status", status);
    }
  };
}

/** `> [!type] Title` blockquotes → callouts. */
function callouts(state: StateCore) {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.type !== "blockquote_open") continue;
    const inline = tokens[i + 2];
    if (!inline || inline.type !== "inline") continue;
    const m = /^\[!([\w-]+)\][+-]?[ \t]*([^\n]*)/.exec(inline.content);
    if (!m) continue;
    const type = m[1]!.toLowerCase();
    tokens[i]!.attrJoin("class", `callout callout-${type}`);
    const title = m[2] || type[0]!.toUpperCase() + type.slice(1);
    const children = inline.children ?? [];
    // Drop the [!type] line (up to the first softbreak) and emit a title.
    const br = children.findIndex((c) => c.type === "softbreak");
    inline.children = br >= 0 ? children.slice(br + 1) : [];
    const t = new state.Token("html_inline", "", 0);
    t.content = `<div class="callout-title">${esc(title)}</div>`;
    inline.children.unshift(t);
  }
}

/** Heading ids so [[#Heading]] links can scroll. */
function headingIds(state: StateCore) {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]!.type === "heading_open") tokens[i]!.attrSet("id", slug(tokens[i + 1]!.content));
  }
}

/** Mark paragraphs that start with `Attn::` and carry source lines. */
function attnParagraphs(lineOffset: () => number) {
  return (state: StateCore) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (t.type !== "paragraph_open") continue;
      const inline = tokens[i + 1];
      if (inline && /(^|\n)Attn::/i.test(inline.content)) {
        t.attrJoin("class", /\[resolved::/i.test(inline.content) ? "attn attn-resolved" : "attn");
        t.attrSet("data-line", String((t.map?.[0] ?? 0) + lineOffset()));
      }
    }
  };
}

// --- renderer -----------------------------------------------------------------

/**
 * Markdown parser with Zeolite's Obsidian-flavoured extensions. Shared by the
 * HTML preview and the PDF exporter so both read notes the same way.
 */
export function createMarkdown(lineOffset: () => number = () => 0): MarkdownIt {
  const md: MarkdownIt = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        } catch {
          /* fall through */
        }
      }
      return "";
    },
  });

  wikiLinks(md);
  simpleInline(md, "mark", /^==(?=\S)([^\n]*?\S)==/, "emphasis");
  simpleInline(md, "comment", /^%%[\s\S]*?%%/, "emphasis");
  simpleInline(md, "field", /^[[(]([\p{L}\p{N}_\- ]+?)::\s*([^\])\n]*?)\s*[\])]/u, "link");
  // Line fields start with letters, which the "text" rule would swallow first.
  simpleInline(md, "linefield", /^([\p{L}\p{N}_-]+)::[ \t]*/u, "text", "line");
  simpleInline(md, "tag", /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u, "emphasis", "word");
  simpleInline(md, "person", /^@([\p{L}\p{N}_.-]*[\p{L}\p{N}_])/u, "emphasis", "word");

  md.core.ruler.push("tasks", taskItems(lineOffset));
  md.core.ruler.push("callouts", callouts);
  md.core.ruler.push("heading_ids", headingIds);
  md.core.ruler.push("attn", attnParagraphs(lineOffset));
  return md;
}

export function createRenderer(ctx: RenderContext) {
  let offset = 0;
  let source = "";
  const md = createMarkdown(() => offset);

  const r = md.renderer.rules;
  r.mark = (t: Token[], i: number) => `<mark>${md.renderInline((t[i]!.meta as RegExpExecArray)[1]!)}</mark>`;
  r.comment = () => "";
  r.field = (t: Token[], i: number) => {
    const m = t[i]!.meta as RegExpExecArray;
    const key = m[1]!.trim();
    return `<span class="field field-${esc(key.toLowerCase())}"><span class="field-key">${esc(key)}</span><span class="field-value">${md.renderInline(m[2]!)}</span></span>`;
  };
  r.linefield = (t: Token[], i: number) => {
    const key = (t[i]!.meta as RegExpExecArray)[1]!;
    return `<span class="linefield linefield-${esc(key.toLowerCase())}">${esc(key)}</span> `;
  };
  r.tag = (t: Token[], i: number) => {
    const tag = (t[i]!.meta as RegExpExecArray)[1]!;
    return `<a class="tag" data-tag="${esc(tag)}" href="#">#${esc(tag)}</a>`;
  };
  r.person = (t: Token[], i: number) => `<span class="person">@${esc((t[i]!.meta as RegExpExecArray)[1]!)}</span>`;
  r.wikilink = (t: Token[], i: number) => {
    const { embed, raw } = t[i]!.meta as { embed: boolean; raw: string };
    const [targetPart, alias] = raw.split("|") as [string, string | undefined];
    const [target, heading] = targetPart.split("#") as [string, string | undefined];
    if (embed && IMAGE.test(target)) {
      const url = ctx.resolveAsset(target.trim());
      const size = alias && /^\d+(x\d+)?$/.test(alias) ? alias.split("x") : null;
      const dims = size ? ` width="${size[0]}"${size[1] ? ` height="${size[1]}"` : ""}` : "";
      return url
        ? `<img src="${url}" alt="${esc(alias && !size ? alias : target)}"${dims}>`
        : `<span class="missing">Missing image: ${esc(target)}</span>`;
    }
    const path = target ? ctx.resolveNote(target.trim()) : "";
    const label = alias ?? (heading && !target ? heading : targetPart);
    const cls = `wikilink${path === undefined ? " unresolved" : ""}${embed ? " embed" : ""}`;
    return `<a class="${cls}" href="#" data-target="${esc(target.trim())}" data-heading="${esc(heading ?? "")}">${esc(label)}</a>`;
  };

  const linkOpen = r.link_open ?? ((t: Token[], i: number, o, _e, self) => self.renderToken(t, i, o));
  r.link_open = (tokens: Token[], idx: number, opts, env, self) => {
    const href = tokens[idx]!.attrGet("href") ?? "";
    if (/^https?:/i.test(href)) {
      tokens[idx]!.attrSet("target", "_blank");
      tokens[idx]!.attrSet("rel", "noopener noreferrer");
    }
    return linkOpen(tokens, idx, opts, env, self);
  };

  const fence = r.fence!;
  r.fence = (tokens: Token[], idx: number, opts, env, self) => {
    const t = tokens[idx]!;
    const lang = t.info.trim().split(/\s+/)[0]?.toLowerCase();
    if (lang === "toc") {
      const toc = generateToc(source, { minLevel: 2 });
      return `<nav class="toc"><div class="toc-title">Contents</div>${toc ? md.render(toc) : "<p><em>No headings yet.</em></p>"}</nav>`;
    }
    if (lang === "dataview" || lang === "query") return renderQuery(t.content);
    const instrument = chordsFenceInstrument(t.info);
    if (instrument) return renderChords(t.content.replace(/\n$/, ""), instrument, chordBlock++);
    return fence(tokens, idx, opts, env, self);
  };

  const noteLink = (path: string, name: string) =>
    `<a class="wikilink" href="#" data-target="${esc(path.replace(/\.md$/i, ""))}" data-heading="">${esc(name)}</a>`;

  const valueHtml = (v: Value): string => {
    if (isLink(v)) return noteLink(v.link, v.name);
    if (Array.isArray(v)) return v.map(valueHtml).join(", ");
    return md.renderInline(displayValue(v));
  };

  const rowHtml = (res: QueryResult, row: ResultRow): string => {
    if (row.task) {
      const t = row.task;
      const body = md.renderInline(t.raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s?/, ""));
      const box =
        t.status === "open" || t.status === "done"
          ? `<input type="checkbox" class="task-box" data-path="${esc(row.path)}" data-line="${t.line}"${t.status === "done" ? " checked" : ""}>`
          : `<span class="task-mark" title="${t.status}">${t.status === "cancelled" ? "✕" : t.status === "deferred" ? "➜" : esc(t.char)}</span>`;
      return `<li class="task task-${t.status}">${box} ${body}</li>`;
    }
    if (row.attn) {
      const a = row.attn;
      return `<li class="attn-row${a.resolved ? " attn-resolved" : ""}"><span class="linefield linefield-attn">Attn</span> ${md.renderInline(a.text)} <span class="query-src">· ${noteLink(row.path, row.name)}</span></li>`;
    }
    const value = row.values.length ? `: ${row.values.map(valueHtml).join(" ")}` : "";
    return `<li>${noteLink(row.path, row.name)}${value}</li>`;
  };

  const tableHtml = (res: QueryResult, rows: ResultRow[]): string => {
    const head = res.headers.map((h) => `<th>${esc(h)}</th>`).join("");
    const body = rows
      .map((r) => `<tr>${res.withoutId ? "" : `<td>${noteLink(r.path, r.name)}</td>`}${r.values.map((v) => `<td>${valueHtml(v)}</td>`).join("")}</tr>`)
      .join("");
    return `<div class="query-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  };

  /** Run a ```dataview block and render its results. */
  function renderQuery(source: string): string {
    let res: QueryResult;
    try {
      res = ctx.runQuery(source);
    } catch (e) {
      return `<div class="query query-error"><div class="query-title">Dataview query error</div><p>${esc((e as Error).message)}</p><pre><code>${esc(source)}</code></pre></div>`;
    }
    const groups = res.groups
      .map((g) => {
        const title = g.key !== undefined ? `<div class="query-group">${g.key === null ? "(none)" : valueHtml(g.key)} <span>${g.rows.length}</span></div>` : "";
        const content = res.kind === "table" ? tableHtml(res, g.rows) : `<ul class="query-list">${g.rows.map((r) => rowHtml(res, r)).join("")}</ul>`;
        return title + content;
      })
      .join("");
    const noun = res.kind === "task" ? "task" : res.kind === "attn" ? "Attn point" : "note";
    const empty = res.count === 0 ? `<p class="query-empty">No matching ${noun}s.</p>` : groups;
    return `<div class="query"><div class="query-title">Dataview · ${res.count} ${noun}${res.count === 1 ? "" : "s"}</div>${empty}</div>`;
  }

  let chordBlock = 0;

  /** A chords block: transpose bar, diagram cards and the sheet itself. */
  function renderChords(source: string, instrument: Instrument, block: number): string {
    const view = ctx.chords;
    const shift = view?.transpose(block) ?? 0;
    const text = shift ? transposeSheet(source, shift) : source;
    // A custom shape ([x13333]) is hidden but its width kept, so the following
    // chords stay above their syllables.
    const chordSpan = (sym: string, inline = false) => {
      const shown = sym.replace(/\[[^\]]*\]$/, "");
      const pad = inline ? "" : " ".repeat(sym.length - shown.length);
      return `<span class="chord${inline ? " inline" : ""}" data-chord="${esc(sym)}">${esc(shown)}</span>${pad}`;
    };
    const lines = parseSheet(text).map((l) => {
      if (l.kind === "section") return `<span class="chord-section">${esc(l.text)}</span>`;
      if (!l.chords.length) return esc(l.text);
      let out = "";
      let col = 0;
      for (const c of l.chords) {
        const before = l.kind === "lyrics" ? l.text.slice(col, c.start - 1) : l.text.slice(col, c.start);
        out += l.kind === "chords" ? `<span class="chord-fill">${esc(before)}</span>` : esc(before);
        out += chordSpan(c.symbol, l.kind === "lyrics");
        col = l.kind === "lyrics" ? c.end + 1 : c.end;
      }
      const rest = l.text.slice(col);
      return out + (l.kind === "chords" ? `<span class="chord-fill">${esc(rest)}</span>` : esc(rest));
    });

    const first = sheetChords(source)[0];
    const key = first && shift ? ` <span class="chords-key">${esc(first.replace(/\[[^\]]*\]$/, ""))} → ${esc(transposeChord(first, shift, targetSpelling(source, shift)))}</span>` : "";
    const sign = shift > 0 ? `+${shift}` : String(shift);
    const bar = `<div class="chords-bar">
      <span class="chords-instr">${INSTRUMENT_LABEL[instrument]}</span>
      <span class="chords-tr" title="Transpose">
        <button type="button" data-act="down" data-block="${block}" aria-label="Transpose down">♭ −1</button>
        <span class="chords-shift">${shift ? sign : "0"}</span>
        <button type="button" data-act="up" data-block="${block}" aria-label="Transpose up">+1 ♯</button>
      </span>${key}
      ${shift ? `<button type="button" data-act="reset" data-block="${block}">Reset</button><button type="button" data-act="apply" data-block="${block}" title="Rewrite this block with the transposed chords">Write to note</button>` : ""}
      <span class="chords-scroll" title="Autoscroll (speed is saved in the note)">
        <button type="button" data-act="scroll" class="${view?.autoscroll?.on ? "on" : ""}">${view?.autoscroll?.on ? "⏸ Stop" : "▶ Autoscroll"}</button>
        <button type="button" data-act="slower" aria-label="Slower">−</button>
        <span class="chords-speed">${view?.autoscroll?.speed ?? 3}</span>
        <button type="button" data-act="faster" aria-label="Faster">+</button>
      </span>
      <button type="button" class="chords-toggle" data-act="diagrams">${view?.diagrams === false ? "Show diagrams" : "Hide diagrams"}</button>
    </div>`;

    let cards = "";
    if (view?.diagrams !== false) {
      cards = sheetChords(text)
        .map((sym) => {
          const d = chordDiagram(sym, instrument, view?.variant(sym, instrument) ?? 0);
          const more = d.count > 1;
          return `<button type="button" class="chord-card" data-act="${more ? "variant" : ""}" data-chord="${esc(sym)}" data-instrument="${instrument}" title="${more ? `Fingering ${d.index + 1} of ${d.count}: click for the next one` : esc(sym)}">${d.svg}${more ? `<small>${d.index + 1}/${d.count}</small>` : ""}</button>`;
        })
        .join("");
      cards = cards ? `<div class="chord-cards">${cards}</div>` : "";
    }
    return `<div class="chords" data-instrument="${instrument}">${bar}${cards}<pre class="chord-sheet">${lines.join("\n")}</pre></div>`;
  }

  return (markdown: string): string => {
    chordBlock = 0;
    const { body, hasFrontmatter } = splitFrontmatter(markdown);
    offset = hasFrontmatter ? markdown.slice(0, markdown.length - body.length).split("\n").length - 1 : 0;
    source = markdown;
    const html = md.render(body);
    return DOMPurify.sanitize(html, {
      ALLOW_DATA_ATTR: true,
      ADD_ATTR: ["target"],
      // Attachments are shown through blob: URLs.
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    });
  };
}
