<script lang="ts">
  import { buildQuery, DEFAULT_QUERY, queryBlock, type QuerySpec, type Taxonomy } from "@zeolite/core";
  import { untrack } from "svelte";
  import Preview from "./Preview.svelte";

  interface Props {
    taxonomy: Taxonomy;
    tags: string[];
    people: string[];
    folders: string[];
    /** Render markdown (used to preview the results). */
    render: (markdown: string) => string;
    /** Insert into the open note; undefined when no editor is open. */
    onInsert?: (block: string) => void;
    onSave: (title: string, block: string) => void;
    onOpenLink: (target: string, heading: string) => void;
    onToggleTask: (line: number, path?: string) => void;
    onClose: () => void;
  }
  let { taxonomy, tags, people, folders, render, onInsert, onSave, onOpenLink, onToggleTask, onClose }: Props = $props();

  // Taken once when the dialog opens.
  const archives = untrack(() => taxonomy.paras.find((p) => p.tag.toLowerCase() === "archives")?.folder ?? "");
  let spec = $state<QuerySpec>({ ...DEFAULT_QUERY, excludeFolder: archives });
  let tagInput = $state("");
  let edited = $state<string | null>(null);
  let title = $state("");
  let copied = $state(false);

  const generated = $derived(buildQuery(spec));
  const query = $derived(edited ?? generated);
  const html = $derived(render(queryBlock(query)));

  // Any change to the form discards hand edits of the query text.
  function touch() {
    edited = null;
  }

  function addTag(t: string) {
    const tag = t.trim().replace(/^#/, "");
    if (tag && !spec.tags.includes(tag)) spec.tags = [...spec.tags, tag];
    tagInput = "";
    touch();
  }

  /** Sensible sort/group defaults for each kind of result. */
  function retarget() {
    if (spec.target === "tasks") (spec.sort = "due"), (spec.group = "file");
    else if (spec.target === "attn" || spec.target === "decisions") (spec.sort = "name"), (spec.group = "file");
    else (spec.sort = spec.target === "table" ? "id" : "name"), (spec.group = "none");
  }

  const COLUMNS = ["id", "file.tags", "created", "file.folder", "file.tasks"];

  async function copy() {
    try {
      await navigator.clipboard.writeText(queryBlock(query));
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="dialog" role="dialog" aria-label="Query builder">
    <header>
      <h2>Query builder</h2>
      <button class="x" aria-label="Close" onclick={onClose}>✕</button>
    </header>

    <div class="body">
      <form class="form" oninput={touch} onchange={touch} onsubmit={(e) => e.preventDefault()}>
        <fieldset>
          <legend>Find</legend>
          <div class="seg">
            {#each [["tasks", "☐ Tasks"], ["attn", "⚠ Attn points"], ["decisions", "⚖ Decisions"], ["notes", "Notes"], ["table", "Table"]] as [k, l]}
              <label class:active={spec.target === k}><input type="radio" bind:group={spec.target} value={k} onchange={retarget} />{l}</label>
            {/each}
          </div>
        </fieldset>

        <fieldset>
          <legend>Where</legend>
          <label for="qb-tag">Tags (any of)</label>
          <div class="chips">
            {#each spec.tags as t}
              <button type="button" class="chip" onclick={() => ((spec.tags = spec.tags.filter((x) => x !== t)), touch())}>#{t} ✕</button>
            {/each}
            <input
              id="qb-tag"
              list="qb-tags"
              placeholder="Add a tag…"
              bind:value={tagInput}
              onchange={() => addTag(tagInput)}
              onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), addTag(tagInput))}
            />
            <datalist id="qb-tags">{#each tags as t}<option value={t}></option>{/each}</datalist>
          </div>
          <div class="row">
            <label>Folder
              <select bind:value={spec.folder}>
                <option value="">Whole vault</option>
                {#each folders as f}<option value={f}>{f}</option>{/each}
              </select>
            </label>
            {#if archives}
              <label class="check"><input type="checkbox" checked={!!spec.excludeFolder} onchange={(e) => (spec.excludeFolder = (e.currentTarget as HTMLInputElement).checked ? archives : "")} /> Skip {archives}</label>
            {/if}
          </div>

          {#if spec.target === "tasks"}
            <div class="row">
              <label>Status
                <select bind:value={spec.status}>
                  <option value="open">Open</option>
                  <option value="done">Done</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="deferred">Deferred</option>
                  <option value="any">Any</option>
                </select>
              </label>
              <label>Deadline
                <select bind:value={spec.due}>
                  <option value="any">Any</option>
                  <option value="overdue">Overdue</option>
                  <option value="today">Due today</option>
                  <option value="week">Within 7 days (incl. overdue)</option>
                  <option value="next">In the next N days</option>
                  <option value="has">Has a deadline</option>
                  <option value="none">No deadline</option>
                </select>
              </label>
              {#if spec.due === "next"}
                <label class="narrow">Days <input type="number" min="1" bind:value={spec.dueDays} /></label>
              {/if}
            </div>
          {/if}

          {#if spec.target === "attn"}
            <label>State
              <select bind:value={spec.attn}>
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="any">Any</option>
              </select>
            </label>
          {/if}

          {#if spec.target === "decisions"}
            <label>State
              <select bind:value={spec.decision}>
                <option value="required">Required (Decide::)</option>
                <option value="taken">Taken (Decision::)</option>
              </select>
            </label>
          {/if}

          <div class="row">
            {#if spec.target === "tasks" || spec.target === "attn" || spec.target === "decisions"}
              <label>Person
                <input list="qb-people" placeholder="@anyone" bind:value={spec.person} />
                <datalist id="qb-people">{#each people as p}<option value={p}></option>{/each}</datalist>
              </label>
            {:else}
              <label>ID starts with
                <input placeholder="e.g. 01.02" bind:value={spec.idPrefix} list="qb-ids" />
                <datalist id="qb-ids">
                  {#each taxonomy.paras as p}<option value={p.code}>{p.tag}</option>{/each}
                </datalist>
              </label>
            {/if}
            <label>{spec.target === "notes" || spec.target === "table" ? "Name contains" : "Text contains"}
              <input bind:value={spec.text} />
            </label>
          </div>

          {#if spec.target === "table"}
            <span class="lbl">Columns</span>
            <div class="chips">
              {#each COLUMNS as c}
                <label class="check">
                  <input type="checkbox" checked={spec.columns.includes(c)} onchange={(e) => (spec.columns = (e.currentTarget as HTMLInputElement).checked ? [...spec.columns, c] : spec.columns.filter((x) => x !== c))} />
                  {c}
                </label>
              {/each}
            </div>
          {/if}
        </fieldset>

        <fieldset>
          <legend>Show</legend>
          <div class="row">
            <label>Sort
              <select bind:value={spec.sort}>
                {#if spec.target === "tasks"}<option value="due">Deadline</option>{/if}
                <option value="name">Name</option>
                <option value="id">ID</option>
                <option value="created-desc">Newest first</option>
                <option value="created">Oldest first</option>
                <option value="none">Unsorted</option>
              </select>
            </label>
            <label>Group by
              <select bind:value={spec.group}>
                <option value="none">Nothing</option>
                <option value="file">Note</option>
                <option value="folder">Folder</option>
                {#if spec.target === "tasks"}<option value="due">Deadline</option>{/if}
              </select>
            </label>
            <label class="narrow">Limit <input type="number" min="0" bind:value={spec.limit} placeholder="0 = all" /></label>
          </div>
        </fieldset>
      </form>

      <div class="out">
        <label for="qb-query" class="lbl">Dataview query {#if edited !== null}<em>(edited)</em>{/if}</label>
        <textarea id="qb-query" rows="7" spellcheck="false" value={query} oninput={(e) => (edited = (e.currentTarget as HTMLTextAreaElement).value)}></textarea>
        <div class="results">
          <Preview {html} {onOpenLink} {onToggleTask} onTag={(t) => addTag(t)} />
        </div>
      </div>
    </div>

    <footer>
      <button type="button" onclick={copy}>{copied ? "Copied" : "Copy"}</button>
      <input class="title" placeholder="Search name, e.g. Typhoon open tasks" bind:value={title} />
      <button type="button" disabled={!title.trim()} onclick={() => onSave(title, queryBlock(query))} title="Creates a note in Searches/">Save as search</button>
      <button type="button" class="primary" disabled={!onInsert} onclick={() => onInsert?.(queryBlock(query))} title={onInsert ? "Insert at the cursor" : "Open a note in Edit or Split mode to insert"}>Insert in note</button>
    </footer>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: calc(16px + var(--safe-top)) calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left));
    background: rgb(0 0 0 / 0.35);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(1100px, 100%);
    max-height: 100%;
    border-radius: 12px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
    overflow: hidden;
  }
  header,
  footer {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 16px;
  }
  header {
    border-bottom: 1px solid var(--border);
  }
  footer {
    flex-wrap: wrap;
    border-top: 1px solid var(--border);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 17px;
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
    min-height: 0;
    overflow: auto;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 16px;
    border-right: 1px solid var(--border);
  }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0 0 10px;
    border: none;
    border-bottom: 1px solid var(--border);
  }
  fieldset:last-child {
    border-bottom: none;
  }
  legend {
    padding: 6px 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  label,
  .lbl {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12.5px;
    color: var(--muted);
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--fg);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: flex-end;
  }
  .row > label:not(.check) {
    flex: 1 1 140px;
    min-width: 0;
  }
  .row > label.narrow {
    flex: 0 0 90px;
  }
  input:not([type="radio"]):not([type="checkbox"]),
  select,
  textarea {
    padding: 7px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 13.5px;
  }
  .seg {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .seg label {
    align-items: center;
    padding: 7px 4px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--fg);
    cursor: pointer;
    font-size: 13px;
    text-align: center;
  }
  .seg label.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .seg input {
    display: none;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .chips input {
    flex: 1 1 120px;
    min-width: 0;
  }
  .chip {
    padding: 3px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-strong);
    font: inherit;
    font-size: 12.5px;
    cursor: pointer;
  }
  .out {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    padding: 12px 16px;
  }
  textarea {
    font-family: var(--mono);
    font-size: 12.5px;
    resize: vertical;
  }
  .results {
    min-height: 200px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    overflow: auto;
  }
  .results :global(.preview) {
    padding: 0 12px;
  }
  .results :global(.query) {
    border: none;
    padding: 0;
  }
  footer button,
  header .x {
    padding: 7px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  footer button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  footer .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  footer .title {
    flex: 1 1 200px;
    min-width: 0;
  }
  @media (max-width: 800px) {
    .body {
      grid-template-columns: 1fr;
    }
    .form {
      border-right: none;
      border-bottom: 1px solid var(--border);
    }
    .seg {
      grid-template-columns: repeat(2, 1fr);
    }
  }
</style>
