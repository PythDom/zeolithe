<script lang="ts">
  import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
  import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
  import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
  import { languages } from "@codemirror/language-data";
  import { yamlFrontmatter } from "@codemirror/lang-yaml";
  import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
  import { EditorState } from "@codemirror/state";
  import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
  import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
  import { tags as t } from "@lezer/highlight";
  import { convertDueFields } from "@zeolite/core";
  import { onMount } from "svelte";

  interface Props {
    content: string;
    onChange: (text: string) => void;
    /** Save a pasted/dropped file and return the markdown to insert. */
    onFile: (file: File) => Promise<string>;
    tags: () => string[];
    people: () => string[];
  }
  let { content, onChange, onFile, tags, people }: Props = $props();

  let host: HTMLDivElement;
  let view: EditorView | undefined;

  export function getView() {
    return view;
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

  function complete(ctx: CompletionContext) {
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
        fileHandlers,
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
    font-size: 15px;
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
  .editor :global(.cm-panels) {
    background: var(--panel);
    color: var(--fg);
  }
</style>
