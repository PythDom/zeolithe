import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from "@codemirror/view";
import { chordsFenceInstrument, parseSheet } from "@zeolite/core";

const chordMark = Decoration.mark({ class: "cm-chord" });
const sectionMark = Decoration.mark({ class: "cm-chord-section" });
const blockLine = Decoration.line({ class: "cm-chord-line" });

/** Highlight chords and section headers inside ```chords blocks. */
function build(view: EditorView): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const visible = view.visibleRanges;
  let fence: string | null = null;
  let chords = false;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (fence === null && m) {
      fence = m[1]!;
      chords = chordsFenceInstrument(m[2]!) !== null;
      continue;
    }
    if (fence !== null && m && m[1]!.startsWith(fence[0]!) && m[1]!.length >= fence.length && !m[2]!.trim()) {
      fence = null;
      chords = false;
      continue;
    }
    if (!chords || !visible.some((r) => line.to >= r.from && line.from <= r.to)) continue;
    b.add(line.from, line.from, blockLine);
    const parsed = parseSheet(line.text)[0]!;
    if (parsed.kind === "section") {
      if (line.to > line.from) b.add(line.from, line.to, sectionMark);
      continue;
    }
    for (const c of parsed.chords) b.add(line.from + parsed.marker + c.start, line.from + parsed.marker + c.end, chordMark);
  }
  return b.finish();
}

export const chordHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
