<script lang="ts">
  import {
    addEntry,
    codeUsage,
    editTaxonomyNote,
    parseTaxonomy,
    removeEntry,
    renameEntry,
    suggestCode,
    taxonomyTemplate,
    TAXONOMY_PATH,
    type Taxonomy,
    type TaxonomyEntry,
    type TaxonomyKind,
  } from "@zeolithe/core";
  import type { Vault } from "../lib/vault.svelte";

  interface Props {
    vault: Vault;
    onOpenNote: (path: string) => void;
    onClose: () => void;
  }
  let { vault, onOpenNote, onClose }: Props = $props();

  let kind = $state<TaxonomyKind>("category");
  let para = $state("");
  let error = $state("");
  let message = $state("");
  let newCode = $state("");
  let newTag = $state("");
  let newFolder = $state("");
  let editing = $state<string | null>(null);
  let editTag = $state("");
  let renameInNotes = $state(true);

  const exists = $derived(vault.exists(TAXONOMY_PATH));
  const tax = $derived(vault.taxonomy);
  $effect(() => {
    if (!para && tax.paras[0]) para = tax.paras[0].code;
  });
  const entries = $derived<TaxonomyEntry[]>(kind === "para" ? tax.paras : kind === "category" ? tax.categories : (tax.subParas[para] ?? []));
  const suggestion = $derived.by(() => {
    try {
      return kind === "sub" && !para ? "" : suggestCode(tax, kind, para);
    } catch {
      return "";
    }
  });
  const ids = $derived(vault.existingIds);
  const counts = $derived(vault.tagCounts());

  async function apply(edit: (t: Taxonomy) => Taxonomy, done: string) {
    error = "";
    message = "";
    try {
      const current = vault.read(TAXONOMY_PATH);
      const next = current ? editTaxonomyNote(current, edit) : taxonomyTemplate(edit(parseTaxonomy("")));
      await vault.save(TAXONOMY_PATH, next);
      message = done;
      return true;
    } catch (e) {
      error = (e as Error).message;
      return false;
    }
  }

  async function add(e: SubmitEvent) {
    e.preventDefault();
    const code = newCode.trim() || suggestion;
    const tag = newTag.trim().replace(/^#/, "");
    const ok = await apply((t) => addEntry(t, kind, { code, tag, folder: newFolder }, para), `Added ${code} · #${tag}`);
    if (ok) (newCode = ""), (newTag = ""), (newFolder = "");
  }

  async function rename(entry: TaxonomyEntry) {
    const to = editTag.trim().replace(/^#/, "");
    if (!to || to === entry.tag) return (editing = null);
    const ok = await apply((t) => renameEntry(t, kind, entry.code, to, para), `Renamed #${entry.tag} → #${to}`);
    if (!ok) return;
    editing = null;
    if (renameInNotes) {
      const n = await vault.renameTag(entry.tag, to);
      message += n ? ` and updated ${n} note${n > 1 ? "s" : ""}` : "";
    }
  }

  async function remove(entry: TaxonomyEntry) {
    await apply((t) => removeEntry(t, kind, entry.code, ids, para), `Removed ${entry.code} · #${entry.tag}`);
  }

  async function create() {
    await apply((t) => t, "Created the taxonomy note");
  }

  const label: Record<TaxonomyKind, string> = { para: "PARA", category: "Categories", sub: "Sub-PARA" };
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="dialog" role="dialog" aria-label="Manage taxonomy">
    <header>
      <h2>Taxonomy</h2>
      {#if exists}<button class="ghost" onclick={() => onOpenNote(TAXONOMY_PATH)}>Open note</button>{/if}
      <button class="ghost" aria-label="Close" onclick={onClose}>✕</button>
    </header>

    {#if !exists}
      <div class="body">
        <p>This vault has no <code>{TAXONOMY_PATH}</code> yet. Create it, then add PARAs, categories and Sub-PARAs here.</p>
        <button class="primary" onclick={create}>Create taxonomy note</button>
      </div>
    {:else}
      <nav class="tabs">
        {#each ["para", "category", "sub"] as k}
          <button class:active={kind === k} onclick={() => ((kind = k as TaxonomyKind), (editing = null), (error = ""))}>{label[k as TaxonomyKind]}</button>
        {/each}
        {#if kind === "sub"}
          <select bind:value={para} aria-label="PARA">
            {#each tax.paras as p}<option value={p.code}>{p.code} · #{p.tag}</option>{/each}
          </select>
        {/if}
      </nav>

      <div class="body">
        <p class="hint">
          {#if kind === "para"}PARA codes are the <b>XX</b> of an ID; each has its vault folder.
          {:else if kind === "category"}Categories are the <b>YY</b> of an ID, shared by every PARA.
          {:else}Sub-PARAs are the <b>ZZ</b> of an ID and belong to one PARA.{/if}
          Codes used by note IDs can be renamed but not removed.
        </p>

        <div class="list">
          <table>
            <thead><tr><th>Code</th><th>Tag</th>{#if kind === "para"}<th>Folder</th>{/if}<th class="num">IDs</th><th class="num">Notes</th><th></th></tr></thead>
            <tbody>
              {#each entries as e (e.code)}
                {@const used = codeUsage(ids, kind, e.code, para)}
                <tr>
                  <td class="code">{e.code}</td>
                  <td>
                    {#if editing === e.code}
                      <!-- svelte-ignore a11y_autofocus -->
                      <input class="inline" bind:value={editTag} autofocus onkeydown={(ev) => { if (ev.key === "Enter") rename(e); if (ev.key === "Escape") { ev.stopPropagation(); editing = null; } }} />
                    {:else}
                      <span class="tag">#{e.tag}</span>
                    {/if}
                  </td>
                  {#if kind === "para"}<td class="muted">{e.folder}/</td>{/if}
                  <td class="num">{used}</td>
                  <td class="num">{counts.get(e.tag) ?? 0}</td>
                  <td class="actions">
                    {#if editing === e.code}
                      <button onclick={() => rename(e)}>Save</button>
                      <button onclick={() => (editing = null)}>Cancel</button>
                    {:else}
                      <button onclick={() => ((editing = e.code), (editTag = e.tag))}>Rename</button>
                      <button disabled={used > 0} title={used ? `Used by ${used} note ID${used > 1 ? "s" : ""}` : "Remove"} onclick={() => remove(e)}>Remove</button>
                    {/if}
                  </td>
                </tr>
              {:else}
                <tr><td colspan="6" class="muted">Nothing here yet.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
        {#if editing}
          <label class="check"><input type="checkbox" bind:checked={renameInNotes} /> Also rename the tag in every note</label>
        {/if}

        <form class="add" onsubmit={add}>
          <label class="code-in">Code <input bind:value={newCode} placeholder={suggestion} maxlength="2" inputmode="numeric" /></label>
          <label class="grow">Tag <input bind:value={newTag} placeholder="e.g. Aviation" required /></label>
          {#if kind === "para"}<label class="grow">Folder <input bind:value={newFolder} placeholder={`${newCode || suggestion} ${newTag || "Name"}`} /></label>{/if}
          <button class="primary" type="submit" disabled={kind === "sub" && !para}>Add {kind === "para" ? "PARA" : kind === "category" ? "category" : "Sub-PARA"}</button>
        </form>

        {#if error}<p class="error">{error}</p>{/if}
        {#if message}<p class="ok">✓ {message}</p>{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(0 0 0 / 0.35);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(720px, 100%);
    max-height: 100%;
    border-radius: 12px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
    overflow: hidden;
  }
  header {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 17px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    align-items: center;
    padding: 8px 16px 0;
  }
  .tabs button {
    padding: 7px 12px;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }
  .tabs button.active {
    border-bottom-color: var(--accent);
    color: var(--fg);
    font-weight: 600;
  }
  .tabs select {
    margin-left: auto;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px 16px;
    overflow: auto;
  }
  .hint,
  .muted {
    color: var(--muted);
    font-size: 13px;
  }
  .hint {
    margin: 0;
  }
  .list {
    max-height: 46vh;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }
  th,
  td {
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--panel);
    font-size: 11px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .code {
    font-family: var(--mono);
    font-weight: 700;
    color: var(--accent-strong);
  }
  .tag {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-strong);
  }
  .actions {
    white-space: nowrap;
    text-align: right;
  }
  button,
  select,
  input {
    font: inherit;
    font-size: 13px;
  }
  .actions button,
  .ghost {
    padding: 4px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    cursor: pointer;
  }
  .actions button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  input,
  select {
    padding: 7px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
  }
  .inline {
    width: 100%;
    padding: 3px 6px;
  }
  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: flex-end;
  }
  .add label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .code-in input {
    width: 64px;
  }
  .grow {
    flex: 1 1 160px;
  }
  .primary {
    padding: 8px 14px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.5;
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    font-size: 13px;
  }
  .error {
    margin: 0;
    color: var(--danger);
  }
  .ok {
    margin: 0;
    color: var(--ok);
  }
</style>
