import { EditorSelection, type ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/** Apply a transform to every line touched by the selection. */
export function transformLines(view: EditorView, fn: (line: string) => string) {
  const { state } = view;
  const changes: ChangeSpec[] = [];
  const seen = new Set<number>();
  let lastFrom = 0;
  let lastLen = 0;
  for (const r of state.selection.ranges) {
    for (let pos = r.from; pos <= r.to; ) {
      const line = state.doc.lineAt(pos);
      if (!seen.has(line.number)) {
        seen.add(line.number);
        const next = fn(line.text);
        if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next });
        lastFrom = line.from;
        lastLen = next.split("\n")[0]!.length;
      }
      pos = line.to + 1;
    }
  }
  if (changes.length === 0) return;
  const set = state.changes(changes);
  // A single-cursor edit leaves the cursor at the end of the transformed line.
  const selection = state.selection.main.empty && seen.size === 1 ? EditorSelection.cursor(set.mapPos(lastFrom, -1) + lastLen) : undefined;
  view.dispatch({ changes: set, selection });
  view.focus();
}

/** Wrap the selection in markers (toggle when already wrapped). */
export function wrapSelection(view: EditorView, before: string, after = before, placeholder = "text") {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    const outerFrom = range.from - before.length;
    const outerTo = range.to + after.length;
    if (outerFrom >= 0 && state.sliceDoc(outerFrom, range.from) === before && state.sliceDoc(range.to, outerTo) === after) {
      return {
        changes: [
          { from: outerFrom, to: range.from, insert: "" },
          { from: range.to, to: outerTo, insert: "" },
        ],
        range: EditorSelection.range(outerFrom, range.to - before.length),
      };
    }
    const inner = text || placeholder;
    return {
      changes: { from: range.from, to: range.to, insert: before + inner + after },
      range: EditorSelection.range(range.from + before.length, range.from + before.length + inner.length),
    };
  });
  view.dispatch(tr);
  view.focus();
}

/** Toggle a line prefix such as "> " or "## ". Headings replace each other. */
export function toggleLinePrefix(view: EditorView, prefix: string) {
  const isHeading = /^#+ $/.test(prefix);
  transformLines(view, (line) => {
    if (isHeading) {
      const m = /^(#{1,6}) /.exec(line);
      if (m && `${m[1]} ` === prefix) return line.slice(prefix.length);
      return prefix + (m ? line.slice(m[0].length) : line);
    }
    if (prefix === "1. ") {
      const m = /^(\s*)\d+[.)] /.exec(line);
      return m ? m[1] + line.slice(m[0].length) : line.replace(/^(\s*)(?:[-*+] )?/, "$11. ");
    }
    if (prefix === "- ") {
      const m = /^(\s*)[-*+] (?!\[.\])/.exec(line);
      return m ? m[1] + line.slice(m[0].length) : line.replace(/^(\s*)(?:\d+[.)] )?/, "$1- ");
    }
    return line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line;
  });
}

export function insertText(view: EditorView, text: string) {
  view.dispatch(view.state.replaceSelection(text));
  view.focus();
}

/** End offset of the YAML frontmatter (0 when there is none). */
function frontmatterEnd(doc: string): number {
  const m = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(doc);
  return m ? m[0].length : 0;
}

/**
 * Insert a block on its own line(s) after the cursor's line. A cursor inside
 * the frontmatter (e.g. a freshly opened note) appends to the end instead.
 */
export function insertBlock(view: EditorView, block: string) {
  const head = view.state.selection.main.head;
  const pos = head < frontmatterEnd(view.state.doc.toString()) ? view.state.doc.length : head;
  const line = view.state.doc.lineAt(pos);
  const insert = (line.text.trim() ? "\n\n" : "") + block + "\n";
  view.dispatch({ changes: { from: line.to, insert }, selection: { anchor: line.to + insert.length } });
  view.focus();
}
