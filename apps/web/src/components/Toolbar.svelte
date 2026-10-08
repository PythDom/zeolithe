<script lang="ts">
  import {
    convertAttnToTask,
    cycleTaskStatus,
    makeAttn,
    makeDecide,
    makeTask,
    parseNaturalDate,
    recordDecision,
    setOwner,
    setDue,
    toggleAttnResolved,
  } from "@zeolite/core";
  import type { EditorView } from "@codemirror/view";
  import { insertBlock, toggleLinePrefix, transformLines, wrapSelection } from "../lib/editor-commands";

  interface Props {
    view: () => EditorView | undefined;
    onStaticToc: () => void;
    onQuery: () => void;
    templates: () => string[];
    onTemplate: (path: string) => void;
    onManageTemplates: () => void;
    /** Open the link dialog with the selected text. */
    onLink: (selected: string) => void;
    /** People already assigned in the vault, for the 👤 picker. */
    people: () => string[];
  }
  let { view, onStaticToc, onQuery, templates, onTemplate, onManageTemplates, onLink, people }: Props = $props();
  let tplOpen = $state(false);

  let dueOpen = $state(false);
  let dueText = $state("");
  let attnOpen = $state(false);
  let ownerOpen = $state(false);
  let ownerText = $state("");
  const known = $derived(ownerOpen ? people() : []);

  /** [owner:: name] on the selected lines (other lines become tasks). */
  function applyOwner(name: string) {
    ownerOpen = false;
    const n = name.trim().replace(/^@/, "");
    const v = view();
    if (v && n) transformLines(v, (l) => setOwner(l, n));
  }
  /** Focus the name box when it appears (the click left focus on the toolbar button). */
  const focusNow = (el: HTMLInputElement) => void requestAnimationFrame(() => el.focus());
  const closeOthers = () => ((dueOpen = false), (attnOpen = false), (tplOpen = false), (ownerOpen = false));

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

  /** ``` around the selected lines, or an empty code block. */
  function codeBlock(v: EditorView) {
    const sel = v.state.selection.main;
    if (sel.empty) return insertBlock(v, "```\n\n```");
    const from = v.state.doc.lineAt(sel.from).from;
    const to = v.state.doc.lineAt(sel.to).to;
    v.dispatch({ changes: { from, to, insert: `\`\`\`\n${v.state.sliceDoc(from, to)}\n\`\`\`` } });
    v.focus();
  }

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
    <button title="Code block (``` … ```): wraps the selection, or inserts an empty block" onclick={run(codeBlock)}><code>```</code></button>
    <button title="Link to a note (Ctrl+K). Tip: typing [[ in the editor also suggests notes." onclick={run((v) => onLink(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)))}>[[ ]]</button>
    <button title="Table" onclick={run((v) => insertBlock(v, "| Column | Column |\n| ------ | ------ |\n|        |        |"))}>▦</button>
  </div>
  <div class="group">
    <button title="Insert a table of contents (updates itself)" onclick={run((v) => insertBlock(v, "```toc\n```"))}>☰ TOC</button>
    <button title="Write/update a static table of contents" onclick={onStaticToc}>TOC⇣</button>
    <button class="accent" title="Build a Dataview query" onclick={onQuery}>🔍<span class="lbl">Query</span></button>
    <button class="accent" class:on={tplOpen} title="Insert a template" onclick={() => ((tplOpen = !tplOpen), (dueOpen = false), (attnOpen = false), (ownerOpen = false))}>📄<span class="lbl">Template</span></button>
  </div>
  <div class="group tasks">
    <button class="accent" title="Task" onclick={lines(makeTask)}>☐<span class="lbl">Task</span></button>
    <button class="accent" class:on={dueOpen} title="Task with deadline" onclick={() => ((dueOpen = !dueOpen), (attnOpen = false), (tplOpen = false), (ownerOpen = false), (dueText = ""))}>📅<span class="lbl">Due</span></button>
    <button class="accent" title="Cycle state: open → done → cancelled → deferred" onclick={lines((l) => cycleTaskStatus(l))}>✔<span class="lbl">State</span></button>
    <button class="accent" class:on={ownerOpen} title="Assign to a person: [owner:: name], which Dataview queries can find" onclick={() => { const was = ownerOpen; closeOthers(); ownerOpen = !was; ownerText = ""; }}>👤<span class="lbl">Owner</span></button>
    <button class="attn" class:on={attnOpen} title="Attn point" onclick={() => ((attnOpen = !attnOpen), (dueOpen = false), (tplOpen = false), (ownerOpen = false))}>⚠<span class="lbl">Attn</span> ▾</button>
  </div>
  <div class="group">
    <button class="decide" title="Decision required (Decide::)" onclick={lines(makeDecide)}>❓<span class="lbl">Decision rqd</span></button>
    <button class="decide" title="Decision taken (Decision:: … [decided:: today]); turns a Decision rqd into a decision" onclick={lines((l) => recordDecision(l))}>⚖<span class="lbl">Decision</span></button>
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

{#if ownerOpen}
  <div class="options" role="group" aria-label="Owner">
    <input
      class="natural"
      aria-label="Person"
      placeholder="Name, then Enter"
      list="owner-people"
      use:focusNow
      bind:value={ownerText}
      onkeydown={(e) => (e.key === "Enter" ? (e.preventDefault(), applyOwner(ownerText)) : e.key === "Escape" && (ownerOpen = false))}
    />
    <datalist id="owner-people">{#each known as p}<option value={p}></option>{/each}</datalist>
    {#if ownerText.trim()}<button class="primary" onclick={() => applyOwner(ownerText)}>Assign to {ownerText.trim().replace(/^@/, "")}</button>{/if}
    {#each known.slice(0, 8) as p}
      <button onclick={() => applyOwner(p)}>👤 {p}</button>
    {/each}
    <button class="close" aria-label="Close" onclick={() => (ownerOpen = false)}>✕</button>
  </div>
{/if}

{#if tplOpen}
  <div class="options" role="group" aria-label="Templates">
    {#each templates() as t}
      <button onclick={() => ((tplOpen = false), onTemplate(t))}>{t.split("/").pop()!.replace(/\.md$/i, "")}</button>
    {:else}
      <span class="none">No templates yet.</span>
    {/each}
    <button onclick={() => ((tplOpen = false), onManageTemplates())}>⚙ Manage templates…</button>
    <button class="close" aria-label="Close" onclick={() => (tplOpen = false)}>✕</button>
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
  .lbl {
    margin-left: 4px;
  }
  /* Phones and narrow windows: every button visible on a few compact rows. */
  @media (max-width: 800px) {
    .toolbar {
      gap: 4px;
      padding: 4px 6px;
    }
    .group {
      padding-right: 4px;
    }
    .tasks {
      order: -1;
    }
    .lbl {
      display: none;
    }
    button {
      min-width: 30px !important;
      height: 30px;
      padding: 0 5px !important;
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
  button.decide {
    color: var(--decide);
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
  .options .none {
    color: var(--muted);
    font-size: 13px;
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
