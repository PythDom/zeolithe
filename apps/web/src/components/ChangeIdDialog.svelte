<script lang="ts">
  import { assignId, idFromFileName, idPrefix, nextId, numberablePara, parseId, type NewNote } from "@zeolite/core";
  import { untrack } from "svelte";
  import type { Vault } from "../lib/vault.svelte";

  interface Props {
    vault: Vault;
    path: string;
    /** Note text (unsaved edits included). */
    content: string;
    onApply: (note: NewNote & { id: string }) => Promise<void>;
    onSetupTaxonomy: () => void;
    onClose: () => void;
  }
  let { vault, path, content, onApply, onSetupTaxonomy, onClose }: Props = $props();

  const tax = $derived(vault.taxonomy);
  const paras = $derived(numberablePara(tax));
  // The note's current ID, taken when the dialog opens.
  const currentId = untrack(() => vault.records.get(path)?.id ?? idFromFileName(path) ?? undefined);
  const cur = currentId ? parseId(currentId) : null;

  let para = $state(cur?.para ?? "");
  let sub = $state(cur?.sub ?? "");
  let category = $state(cur?.category ?? "");
  let move = $state(true);
  let error = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!paras.some((p) => p.code === para) && paras[0]) para = paras[0].code;
  });
  const subs = $derived(tax.subParas[para] ?? []);
  $effect(() => {
    if (!subs.some((s) => s.code === sub)) sub = subs[0]?.code ?? "";
  });
  $effect(() => {
    if (!tax.categories.some((c) => c.code === category) && tax.categories[0]) category = tax.categories[0].code;
  });

  const sameSeries = $derived(!!cur && idPrefix(cur.para, cur.category, cur.sub) === idPrefix(para, category, sub));
  const preview = $derived.by(() => {
    if (!para || !sub || !category) return "";
    if (sameSeries) return currentId!;
    try {
      return nextId(para, category, sub, vault.existingIds.filter((x) => x !== currentId));
    } catch (e) {
      return `⚠ ${(e as Error).message}`;
    }
  });
  const folder = $derived(paras.find((p) => p.code === para)?.folder ?? "");

  async function apply(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    busy = true;
    try {
      const note = assignId({ taxonomy: tax, path, content, para, category, sub, existingIds: vault.existingIds, moveToParaFolder: move });
      if (note.path !== path && vault.exists(note.path)) throw new Error(`A note already exists at ${note.path}.`);
      await onApply(note);
    } catch (err) {
      error = (err as Error).message;
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <form class="dialog" onsubmit={apply}>
    <h2>{currentId ? "Change ID" : "Assign an ID"}</h2>
    {#if paras.length === 0}
      <p>The vault has no taxonomy with Sub-PARAs yet, so notes cannot be numbered.</p>
      <div class="actions">
        <button type="button" onclick={onClose}>Close</button>
        <button type="button" class="primary" onclick={onSetupTaxonomy}>Set up the taxonomy</button>
      </div>
    {:else}
      {#if currentId}
        <p class="note">Current ID <code>{currentId}</code>. IDs are meant to stay stable: links inside the vault are updated, but references elsewhere (PDFs, emails, paper) will still show the old ID.</p>
      {:else}
        <p class="note">This note has no ID yet. It gets the next number in the series you choose.</p>
      {/if}
      <label>PARA
        <select bind:value={para}>{#each paras as p}<option value={p.code}>{p.code} · #{p.tag}</option>{/each}</select>
      </label>
      <label>Category
        <select bind:value={category}>{#each tax.categories as c}<option value={c.code}>{c.code} · #{c.tag}</option>{/each}</select>
      </label>
      <label>Sub-PARA
        <select bind:value={sub}>{#each subs as s}<option value={s.code}>{s.code} · #{s.tag}</option>{/each}</select>
      </label>
      <div class="id">New ID <code>{preview}</code></div>
      <label class="check"><input type="checkbox" bind:checked={move} /> Move the note to <b>{folder}/</b></label>
      <p class="hint">The note's PARA, Category and Sub-PARA tags are replaced by the new ones; other tags are kept.</p>
      {#if error}<p class="error">{error}</p>{/if}
      <div class="actions">
        <button type="button" onclick={onClose}>Cancel</button>
        <button type="submit" class="primary" disabled={busy || sameSeries || preview.startsWith("⚠")}>{currentId ? "Change ID" : "Assign ID"}</button>
      </div>
    {/if}
  </form>
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
    gap: 10px;
    width: min(460px, 100%);
    padding: 20px;
    border-radius: 12px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  p {
    margin: 0;
    font-size: 13.5px;
  }
  .note {
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--warn-soft);
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--fg);
  }
  select {
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 14px;
  }
  .id code {
    font-size: 16px;
    font-weight: 700;
    color: var(--accent-strong);
  }
  .hint {
    color: var(--muted);
    font-size: 12.5px;
  }
  .error {
    color: var(--danger);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions button {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .actions .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }
  .actions .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
