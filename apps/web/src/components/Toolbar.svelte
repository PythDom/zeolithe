<script lang="ts">
  import {
    convertAttnToTask,
    cycleTaskStatus,
    makeAttn,
    makeTask,
    parseNaturalDate,
    setDue,
    toggleAttnResolved,
  } from "@zeolithe/core";
  import type { EditorView } from "@codemirror/view";
  import { insertBlock, insertText, toggleLinePrefix, transformLines, wrapSelection } from "../lib/editor-commands";

  interface Props {
    view: () => EditorView | undefined;
    onStaticToc: () => void;
  }
  let { view, onStaticToc }: Props = $props();

  let dueOpen = $state(false);
  let dueText = $state("");
  let attnOpen = $state(false);

  const run = (fn: (v: EditorView) => void) => () => {
    const v = view();
    if (v) fn(v);
  };
  const lines = (fn: (l: string) => string) => run((v) => transformLines(v, fn));

  function applyDue(iso: string | null) {
    dueOpen = false;
    if (!iso) return;
    const v = view();
    if (v) transformLines(v, (l) => setDue(l, iso));
  }
  const duePreview = $derived(parseNaturalDate(dueText));
</script>

<div class="toolbar" role="toolbar" aria-label="Formatting">
  <div class="group">
    <button title="Heading 1" onclick={run((v) => toggleLinePrefix(v, "# "))}>H1</button>
    <button title="Heading 2" onclick={run((v) => toggleLinePrefix(v, "## "))}>H2</button>
    <button title="Heading 3" onclick={run((v) => toggleLinePrefix(v, "### "))}>H3</button>
  </div>
  <div class="group">
    <button title="Bold (Ctrl+B)" onclick={run((v) => wrapSelection(v, "**"))}><b>B</b></button>
    <button title="Italic" onclick={run((v) => wrapSelection(v, "*"))}><i>I</i></button>
    <button title="Strikethrough" onclick={run((v) => wrapSelection(v, "~~"))}><s>S</s></button>
    <button title="Highlight" onclick={run((v) => wrapSelection(v, "=="))}><mark>H</mark></button>
    <button title="Inline code" onclick={run((v) => wrapSelection(v, "`", "`", "code"))}>&lt;/&gt;</button>
  </div>
  <div class="group">
    <button title="Bullet list" onclick={run((v) => toggleLinePrefix(v, "- "))}>•≡</button>
    <button title="Numbered list" onclick={run((v) => toggleLinePrefix(v, "1. "))}>1≡</button>
    <button title="Quote" onclick={run((v) => toggleLinePrefix(v, "> "))}>❝</button>
    <button title="Code block" onclick={run((v) => insertBlock(v, "```\n\n```"))}>{"{ }"}</button>
    <button title="Wiki link" onclick={run((v) => wrapSelection(v, "[[", "]]", "Note"))}>[[ ]]</button>
    <button title="Table" onclick={run((v) => insertBlock(v, "| Column | Column |\n| ------ | ------ |\n|        |        |"))}>▦</button>
  </div>
  <div class="group">
    <button title="Insert dynamic table of contents" onclick={run((v) => insertBlock(v, "```toc\n```"))}>TOC</button>
    <button title="Write/update a static table of contents" onclick={onStaticToc}>TOC⇣</button>
  </div>
  <div class="group tasks">
    <button class="accent" title="Task" onclick={lines(makeTask)}>☐ Task</button>
    <div class="pop">
      <button class="accent" title="Task with deadline" onclick={() => ((dueOpen = !dueOpen), (attnOpen = false), (dueText = ""))}>📅 Due</button>
      {#if dueOpen}
        <div class="menu">
          <input type="date" onchange={(e) => applyDue((e.currentTarget as HTMLInputElement).value || null)} />
          <input
            placeholder="or type: friday, +3d, oct 15"
            bind:value={dueText}
            onkeydown={(e) => e.key === "Enter" && applyDue(duePreview)}
          />
          <small>{dueText ? (duePreview ?? "not recognised") : ""}</small>
          <div class="quick">
            {#each ["today", "tomorrow", "friday", "next week", "end of month"] as q}
              <button onclick={() => applyDue(parseNaturalDate(q))}>{q}</button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
    <button class="accent" title="Cycle state: open → done → cancelled → deferred" onclick={lines((l) => cycleTaskStatus(l))}>✔ State</button>
    <button class="accent" title="Assign a person" onclick={run((v) => insertText(v, "@"))}>👤</button>
    <div class="pop">
      <button class="attn" title="Attn point" onclick={() => ((attnOpen = !attnOpen), (dueOpen = false))}>⚠ Attn ▾</button>
      {#if attnOpen}
        <div class="menu">
          <button onclick={() => { attnOpen = false; const v = view(); if (v) transformLines(v, makeAttn); }}>⚠ New Attn point</button>
          <button onclick={() => { attnOpen = false; const v = view(); if (v) transformLines(v, (l) => toggleAttnResolved(l)); }}>✓ Resolve / reopen</button>
          <button onclick={() => { attnOpen = false; const v = view(); if (v) transformLines(v, convertAttnToTask); }}>☐ Convert to task</button>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  .group {
    display: flex;
    gap: 2px;
    padding-right: 6px;
    border-right: 1px solid var(--border);
  }
  .group:last-child {
    border-right: none;
  }
  /* Phones: one scrollable row (the Android shell docks it above the keyboard). */
  @media (max-width: 800px) {
    .toolbar {
      flex-wrap: nowrap;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tasks {
      order: -1;
    }
    /* The row scrolls, so menus are placed against the viewport. */
    .menu {
      position: fixed;
      top: 104px;
      left: 8px;
      right: 8px;
    }
  }
  button {
    min-width: 32px;
    height: 30px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--fg);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover {
    background: var(--hover);
    border-color: var(--border);
  }
  button.accent {
    color: var(--accent-strong);
    font-weight: 600;
  }
  button.attn {
    color: var(--warn);
    font-weight: 600;
  }
  mark {
    background: var(--highlight);
    color: inherit;
    padding: 0 2px;
  }
  .pop {
    position: relative;
  }
  .menu {
    position: absolute;
    z-index: 20;
    top: 34px;
    left: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 230px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
  }
  .menu button {
    text-align: left;
  }
  .menu input {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .menu small {
    color: var(--muted);
    min-height: 1em;
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .quick button {
    border-color: var(--border);
    font-size: 12px;
    height: 26px;
  }
</style>
