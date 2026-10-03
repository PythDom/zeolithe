/**
 * Links that work inside the editor (Edit mode, phones):
 *   - a ```toc block shows a clickable contents list under it;
 *   - entries of a static TOC (between <!-- toc --> markers) are clickable;
 *   - Ctrl/Cmd+click follows any [[link]] or web address.
 */
import { RangeSetBuilder, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { extractHeadings, headingLinkText, TOC_END, TOC_START } from "@zeolite/core";

export type OpenLink = (target: string, heading: string) => void;

const WIKI = /!?\[\[([^\]|#^]*)(?:[#^]([^\]|]*))?(?:\|[^\]]*)?\]\]/g;

class TocWidget extends WidgetType {
  constructor(
    readonly entries: { level: number; text: string }[],
    readonly open: OpenLink,
  ) {
    super();
  }
  eq(other: TocWidget) {
    return JSON.stringify(other.entries) === JSON.stringify(this.entries);
  }
  toDOM() {
    const box = document.createElement("div");
    box.className = "cm-toc-widget";
    const title = document.createElement("div");
    title.className = "cm-toc-title";
    title.textContent = "Contents";
    box.append(title);
    if (!this.entries.length) {
      const empty = document.createElement("div");
      empty.className = "cm-toc-empty";
      empty.textContent = "No headings yet.";
      box.append(empty);
    }
    const base = Math.min(...this.entries.map((e) => e.level));
    for (const e of this.entries) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cm-toc-entry";
      b.style.paddingLeft = `${(e.level - base) * 16 + 6}px`;
      b.textContent = e.text;
      b.title = `Go to “${e.text}”`;
      // mousedown, so the editor does not move the cursor first.
      b.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      b.addEventListener("click", (ev) => {
        ev.preventDefault();
        this.open("", e.text);
      });
      box.append(b);
    }
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState, open: OpenLink): DecorationSet {
  const doc = state.doc;
  const text = doc.toString();
  const headings = extractHeadings(text)
    .filter((h) => h.level >= 2)
    .map((h) => ({ level: h.level, text: headingLinkText(h.text) }));
  const ranges: { from: number; to: number; deco: Decoration }[] = [];
  let staticToc = false;
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const t = line.text.trim();
    if (t === TOC_START) staticToc = true;
    else if (t === TOC_END) staticToc = false;
    else if (staticToc) {
      for (const m of line.text.matchAll(WIKI)) {
        const from = line.from + m.index!;
        ranges.push({ from, to: from + m[0].length, deco: Decoration.mark({ class: "cm-toc-link", attributes: { "data-target": m[1] ?? "", "data-heading": m[2] ?? "", title: "Go to this heading" } }) });
      }
    } else if (/^\s{0,3}```+\s*toc\s*$/.test(line.text)) {
      // The widget goes after the closing fence.
      let j = i + 1;
      while (j <= doc.lines && !/^\s{0,3}```+\s*$/.test(doc.line(j).text)) j++;
      const end = doc.line(Math.min(j, doc.lines));
      ranges.push({ from: end.to, to: end.to, deco: Decoration.widget({ widget: new TocWidget(headings, open), block: true, side: 1 }) });
      i = j;
    }
  }
  const b = new RangeSetBuilder<Decoration>();
  for (const r of ranges.sort((x, y) => x.from - y.from)) b.add(r.from, r.to, r.deco);
  return b.finish();
}

/** A web address under a document position: bare, <…> or in [text](url). */
function urlAt(state: EditorState, pos: number): string | null {
  const line = state.doc.lineAt(pos);
  for (const m of line.text.matchAll(/(?:https?:\/\/|mailto:)[^\s<>()\[\]"']+/gi)) {
    const from = line.from + m.index!;
    if (pos >= from && pos <= from + m[0].length) return m[0].replace(/[.,;:!?]+$/, "");
  }
  // [text](url): clicking the text follows it too.
  for (const m of line.text.matchAll(/\[[^\]]*\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/gi)) {
    const from = line.from + m.index!;
    if (pos >= from && pos <= from + m[0].length) return m[1]!;
  }
  return null;
}

/** The [[link]] under a document position, if any. */
function linkAt(state: EditorState, pos: number): { target: string; heading: string } | null {
  const line = state.doc.lineAt(pos);
  for (const m of line.text.matchAll(WIKI)) {
    const from = line.from + m.index!;
    if (pos >= from && pos <= from + m[0].length) return { target: (m[1] ?? "").trim(), heading: m[2] ?? "" };
  }
  return null;
}

export function editorLinks(open: OpenLink, openUrl: (url: string) => void) {
  const field = StateField.define<DecorationSet>({
    create: (s) => build(s, open),
    update: (deco, tr) => (tr.docChanged ? build(tr.state, open) : deco),
    provide: (f) => EditorView.decorations.from(f),
  });
  const clicks = EditorView.domEventHandlers({
    mousedown(e, view) {
      if (e.button !== 0) return false;
      const el = e.target as HTMLElement;
      const toc = el.closest<HTMLElement>(".cm-toc-link");
      if (toc) {
        e.preventDefault();
        open(toc.dataset.target ?? "", toc.dataset.heading ?? "");
        return true;
      }
      if (!(e.ctrlKey || e.metaKey)) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      const link = linkAt(view.state, pos);
      if (link) {
        e.preventDefault();
        open(link.target, link.heading);
        return true;
      }
      const url = urlAt(view.state, pos);
      if (!url) return false;
      e.preventDefault();
      openUrl(url);
      return true;
    },
  });
  const theme = EditorView.baseTheme({
    ".cm-toc-widget": {
      margin: "4px 0 8px",
      padding: "8px 10px",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      background: "var(--panel)",
      fontFamily: "var(--sans, inherit)",
    },
    ".cm-toc-title": { fontSize: "11px", fontWeight: "700", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "4px" },
    ".cm-toc-empty": { color: "var(--muted)", fontStyle: "italic" },
    ".cm-toc-entry": {
      display: "block",
      width: "100%",
      padding: "3px 6px",
      border: "none",
      borderRadius: "4px",
      background: "none",
      color: "var(--accent-strong)",
      font: "inherit",
      fontSize: "14px",
      textAlign: "left",
      cursor: "pointer",
    },
    ".cm-toc-entry:hover": { background: "var(--accent-soft)" },
    ".cm-toc-link": { color: "var(--accent-strong)", textDecoration: "underline dotted", cursor: "pointer" },
  });
  return [field, clicks, theme];
}
