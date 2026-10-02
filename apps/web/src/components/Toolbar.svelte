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

  function attn(fn: (l: string) => string) {
    attnOpen = false;
    const v = view();
    if (v) transformLines(v, fn);
  }
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
    <button class="accent" class:on={dueOpen} title="Task with deadline" onclick={() => ((dueOpen = !dueOpen), (attnOpen = false), (dueText = ""))}>📅 Due</button>
    <button class="accent" title="Cycle state: open → done → cancelled → deferred" onclick={lines((l) => cycleTaskStatus(l))}>✔ State</button>
    <button class="accent" title="Assign a person" onclick={run((v) => insertText(v, "@"))}>👤</button>
    <button class="attn" class:on={attnOpen} title="Attn point" onclick={() => ((attnOpen = !attnOpen), (dueOpen = false))}>⚠ Attn ▾</button>
  </div>
</div>

{#if dueOpen}
  <div class="options" role="group" aria-label="Deadline">
    <input type="date" aria-label="Pick a date" onchange={(e) => applyDue((e.currentTarget as HTMLInputElement).value || null)} />
    <input
      class="natural"
      aria-label="Type a date"
      placeholder="or type: friday, +3d, oct 15"
      bind:value={dueText}
      onkeydown={(e) => e.key === "Enter" && applyDue(duePreview)}
    />
    {#if dueText}
      <button class="primary" disabled={!duePreview} onclick={() => applyDue(duePreview)}>{duePreview ? `Set ${duePreview}` : "Not recognised"}</button>
    {/if}
    {#each ["today", "tomorrow", "friday", "next week", "end of month"] as q}
      <button onclick={() => applyDue(parseNaturalDate(q))}>{q}</button>
    {/each}
    <button class="close" aria-label="Close" onclick={() => (dueOpen = false)}>✕</button>
  </div>
{/if}

{#if attnOpen}
  <div class="options" role="group" aria-label="Attn point">
    <button onclick={() => attn(makeAttn)}>⚠ New Attn point</button>
    <button onclick={() => attn((l) => toggleAttnResolved(l))}>✓ Resolve / reopen</button>
    <button onclick={() => attn(convertAttnToTask)}>☐ Convert to task</button>
    <button class="close" aria-label="Close" onclick={() => (attnOpen = false)}>✕</button>
  </div>
{/if}

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
  button.on {
    background: var(--accent-soft);
    border-color: var(--border);
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    background: var(--accent-soft);
  }
  .options button {
    border-color: var(--border);
    background: var(--bg);
  }
  .options button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }
  .options button:disabled {
    opacity: 0.6;
  }
  .options .close {
    margin-left: auto;
  }
  .options input {
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
  }
  .options .natural {
    flex: 1 1 180px;
    min-width: 0;
  }
</style>
