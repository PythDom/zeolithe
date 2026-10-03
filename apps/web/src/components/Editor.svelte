<script lang="ts">
  import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { yamlFrontmatter } from "@codemirror/lang-yaml";
  import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
  import { EditorState, Transaction } from "@codemirror/state";
  import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
  import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
  import { tags as t } from "@lezer/highlight";
  import { convertDueFields } from "@zeolite/core";
  import { onMount } from "svelte";
  import { chordHighlight } from "../lib/chord-highlight";
  import { editorLinks } from "../lib/editor-links";
  import { openExternal } from "../lib/native";

  interface Props {
    content: string;
    onChange: (text: string) => void;
    /** Save a pasted/dropped file and return the markdown to insert. */
    onFile: (file: File) => Promise<string>;
    tags: () => string[];
    people: () => string[];
    /** Notes and attachments offered after typing [[ (link text, folder, headings). */
    links?: () => LinkTarget[];
    /** Follow a link: table of contents entries, Ctrl/Cmd+click on [[links]]. */
    onOpenLink?: (target: string, heading: string) => void;
  }
  export interface LinkTarget {
    link: string;
    detail: string;
    headings: string[];
  }
  let { content, onChange, onFile, tags, people, links = () => [], onOpenLink = () => {} }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

  export function getView() {
    return view;
  }

  /** Insert text at the cursor, replacing the selection. */
  export function insert(text: string) {
    if (!view) return;
    view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true });
    view.focus();
  }

  /**
   * Take in a new version of the same note (changed by another app), as a
   * minimal edit: the cursor and scroll position stay, and undo skips it.
   */
  export function replaceDoc(text: string) {
    if (!view) return;
    const cur = view.state.doc.toString();
    if (cur === text) return;
    let a = 0;
    while (a < cur.length && a < text.length && cur[a] === text[a]) a++;
    let b = 0;
    while (b < cur.length - a && b < text.length - a && cur[cur.length - 1 - b] === text[text.length - 1 - b]) b++;
    view.dispatch({ changes: { from: a, to: cur.length - b, insert: text.slice(a, text.length - b) }, annotations: Transaction.addToHistory.of(false) });
  }

  /** Replace the document (when another note is opened or the file changed). */
  export function setContent(text: string) {
    if (!view || view.state.doc.toString() === text) return;
    view.setState(makeState(text));
  }

  const highlight = HighlightStyle.define([
    { tag: t.heading1, fontSize: "1.45em", fontWeight: "700" },
    { tag: t.heading2, fontSize: "1.25em", fontWeight: "700" },
    { tag: t.heading3, fontSize: "1.1em", fontWeight: "700" },
    { tag: [t.heading4, t.heading5, t.heading6], fontWeight: "700" },
    { tag: t.strong, fontWeight: "700" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: [t.link, t.url], color: "var(--accent)" },
    { tag: t.monospace, fontFamily: "var(--mono)", color: "var(--code-fg)" },
    { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--muted)" },
    { tag: t.quote, color: "var(--muted)", fontStyle: "italic" },
    { tag: t.keyword, color: "var(--accent-strong)" },
    { tag: t.string, color: "var(--ok)" },
    { tag: t.comment, color: "var(--muted)" },
    { tag: [t.propertyName, t.definition(t.propertyName)], color: "var(--accent-strong)" },
    { tag: [t.atom, t.bool, t.number, t.squareBracket], color: "var(--muted)" },
  ]);

  /** "]]" is added unless it is already there (typed or auto-closed). */
  function closeLink(view: EditorView, text: string, from: number, to: number) {
    const close = view.state.sliceDoc(to, to + 2) === "]]" ? "" : "]]";
    view.dispatch({ changes: { from, to, insert: text + close }, selection: { anchor: from + text.length + close.length } });
  }

  function complete(ctx: CompletionContext) {
    // [[Note#Heading
    const head = ctx.matchBefore(/\[\[([^[\]|#\n]+)#[^[\]|\n]*/);
    if (head) {
      const target = head.text.slice(2, head.text.indexOf("#"));
      const all = links();
      const lower = target.toLowerCase();
      const loose = all.filter((l) => l.link.toLowerCase().includes(lower));
      const t = all.find((l) => l.link === target || l.link.split("/").pop() === target) ?? (loose.length === 1 ? loose[0] : undefined);
      if (!t?.headings.length) return null;
      return {
        from: head.from + head.text.indexOf("#") + 1,
        options: t.headings.map((h) => ({ label: h, type: "text", apply: (v: EditorView, _c: unknown, _from: number, to: number) => closeLink(v, `${t.link}#${h}`, head.from + 2, to) })),
        validFor: /^[^[\]|\n]*$/,
      };
    }
    // [[Note
    const link = ctx.matchBefore(/\[\[[^[\]|#\n]*/);
    if (link) {
      return {
        from: link.from + 2,
        options: links().map((l) => ({
          label: l.link,
          detail: l.detail,
          type: "class",
          apply: (v: EditorView, _c: unknown, from: number, to: number) => closeLink(v, l.link, from, to),
        })),
        validFor: /^[^[\]|#\n]*$/,
      };
    }
    const tag = ctx.matchBefore(/(?:^|[\s(])#[\p{L}\p{N}_\-/]*/u);
    if (tag) {
      const from = tag.from + tag.text.indexOf("#") + 1;
      return { from, options: tags().map((label) => ({ label, type: "keyword" })), validFor: /^[\p{L}\p{N}_\-/]*$/u };
    }
    const person = ctx.matchBefore(/(?:^|[\s(])@[\p{L}\p{N}_.-]*/u);
    if (person) {
      const from = person.from + person.text.indexOf("@") + 1;
      return { from, options: people().map((label) => ({ label, type: "variable" })), validFor: /^[\p{L}\p{N}_.-]*$/u };
    }
    return null;
  }

  /** Typing "]" after [due:: friday] converts the date to ISO. */
  const dueConverter = EditorView.inputHandler.of((v, from, to, text) => {
    if (text !== "]") return false;
    const line = v.state.doc.lineAt(from);
    const before = line.text.slice(0, from - line.from) + text;
    const after = line.text.slice(to - line.from);
    const converted = convertDueFields(before + after);
    if (converted === before + after) return false;
    const cursor = line.from + converted.length - after.length;
    v.dispatch({ changes: { from: line.from, to: line.to, insert: converted }, selection: { anchor: cursor }, userEvent: "input.type" });
    return true;
  });

  const fileHandlers = EditorView.domEventHandlers({
    paste(e, v) {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length === 0) return false;
      e.preventDefault();
      void insertFiles(v, files, v.state.selection.main.head);
      return true;
    },
    drop(e, v) {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length === 0) return false;
      e.preventDefault();
      const pos = v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? v.state.selection.main.head;
      void insertFiles(v, files, pos);
      return true;
    },
  });

  async function insertFiles(v: EditorView, files: File[], pos: number) {
    const parts: string[] = [];
    for (const f of files) parts.push(await onFile(f));
    v.dispatch({ changes: { from: pos, insert: parts.join("\n") } });
  }

  function makeState(doc: string) {
    return EditorState.create({
      doc,
      extensions: [
        history(),
        drawSelection(),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        yamlFrontmatter({ content: markdown({ base: markdownLanguage, codeLanguages: languages }) }),
        syntaxHighlighting(highlight),
        autocompletion({ override: [complete], icons: false }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        placeholder("Start writing…"),
        dueConverter,
        chordHighlight,
        fileHandlers,
        editorLinks((t, h) => onOpenLink(t, h), (url) => void openExternal(url)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      ],
    });
  }

  onMount(() => {
    view = new EditorView({ state: makeState(content), parent: host });
    return () => view?.destroy();
  });
</script>

<div class="editor" bind:this={host}></div>

<style>
  .editor {
    height: 100%;
    overflow: hidden;
  }
  .editor :global(.cm-editor) {
    height: 100%;
    background: var(--bg);
    color: var(--fg);
    font-size: var(--note-size, 15px);
  }
  .editor :global(.cm-editor.cm-focused) {
    outline: none;
  }
  .editor :global(.cm-scroller) {
    font-family: var(--sans);
    line-height: 1.6;
    padding: 12px 0 40vh;
  }
  .editor :global(.cm-content) {
    max-width: 820px;
    margin: 0 auto;
    padding: 0 20px;
    caret-color: var(--accent);
  }
  .editor :global(.cm-selectionBackground),
  .editor :global(.cm-focused .cm-selectionBackground) {
    background: var(--selection) !important;
  }
  .editor :global(.cm-tooltip) {
    background: var(--panel);
    border: 1px solid var(--border);
    color: var(--fg);
  }
  .editor :global(.cm-tooltip-autocomplete ul li[aria-selected]) {
    background: var(--accent);
    color: var(--on-accent);
  }
  /* Inside ```chords blocks: lyrics in the normal colour, chords highlighted. */
  .editor :global(.cm-chord-line),
  .editor :global(.cm-chord-line *) {
    color: var(--fg) !important;
  }
  .editor :global(.cm-chord-line .cm-chord),
  .editor :global(.cm-chord-line .cm-chord *) {
    color: var(--accent-strong) !important;
    font-weight: 700;
  }
  .editor :global(.cm-chord-line .cm-chord-section),
  .editor :global(.cm-chord-line .cm-chord-section *) {
    color: var(--muted) !important;
    font-weight: 700;
  }
  .editor :global(.cm-panels) {
    background: var(--panel);
    color: var(--fg);
  }
</style>
