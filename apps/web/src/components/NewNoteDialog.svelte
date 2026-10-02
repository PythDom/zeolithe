<script lang="ts">
  import {
    createFreeNote,
    createInboxNote,
    createJournalNote,
    createParaNote,
    idPrefix,
    nextId,
    numberablePara,
    type NewNote,
    type Taxonomy,
  } from "@zeolithe/core";

  interface Props {
    taxonomy: Taxonomy;
    existingIds: string[];
    onCreate: (note: NewNote) => void;
    onClose: () => void;
  }
  let { taxonomy, existingIds, onCreate, onClose }: Props = $props();

  type Kind = "para" | "journal" | "inbox" | "free";
  let kind = $state<Kind>("para");
  let title = $state("");
  let folder = $state("");
  const paras = $derived(numberablePara(taxonomy));
  let para = $state("");
  let sub = $state("");
  let category = $state("");
  let error = $state("");

  $effect(() => {
    if (!para && paras[0]) para = paras[0].code;
  });
  const subs = $derived(taxonomy.subParas[para] ?? []);
  $effect(() => {
    if (!subs.some((s) => s.code === sub)) sub = subs[0]?.code ?? "";
  });
  $effect(() => {
    if (!category && taxonomy.categories[0]) category = taxonomy.categories[0].code;
  });

  const previewId = $derived.by(() => {
    if (kind !== "para" || !para || !sub || !category) return "";
    try {
      return nextId(para, category, sub, existingIds);
    } catch (e) {
      return `⚠ ${(e as Error).message}`;
    }
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    try {
      let note: NewNote;
      if (kind === "para") note = createParaNote({ taxonomy, para, category, sub, title, existingIds });
      else if (kind === "journal") note = createJournalNote();
      else if (kind === "inbox") note = createInboxNote(title);
      else note = createFreeNote(folder, title);
      onCreate(note);
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <form class="dialog" onsubmit={submit}>
    <h2>New note</h2>
    <div class="kinds" role="radiogroup">
      {#each [["para", "PARA note"], ["journal", "Journal"], ["inbox", "Inbox"], ["free", "Free note"]] as [k, label]}
        <label class:active={kind === k}><input type="radio" bind:group={kind} value={k} />{label}</label>
      {/each}
    </div>

    {#if kind === "para"}
      {#if paras.length === 0}
        <p class="warn">The taxonomy note (_system/Taxonomy.md) defines no PARA with Sub-PARAs.</p>
      {:else}
        <label>PARA
          <select bind:value={para}>
            {#each paras as p}<option value={p.code}>{p.code} · #{p.tag}</option>{/each}
          </select>
        </label>
        <label>Sub-PARA
          <select bind:value={sub}>
            {#each subs as s}<option value={s.code}>{s.code} · #{s.tag}</option>{/each}
          </select>
        </label>
        <label>Category
          <select bind:value={category}>
            {#each taxonomy.categories as c}<option value={c.code}>{c.code} · #{c.tag}</option>{/each}
          </select>
        </label>
        <div class="id">ID <code>{previewId}</code> <small>prefix {idPrefix(para, category, sub)}</small></div>
      {/if}
    {/if}

    {#if kind === "free"}
      <label>Folder <input bind:value={folder} placeholder="(vault root)" /></label>
    {/if}

    {#if kind !== "journal"}
      <!-- svelte-ignore a11y_autofocus -->
      <label>Title <input bind:value={title} autofocus placeholder="Note title" /></label>
    {:else}
      <p class="hint">Opens or creates today's journal note.</p>
    {/if}

    {#if error}<p class="warn">{error}</p>{/if}
    <div class="actions">
      <button type="button" onclick={onClose}>Cancel</button>
      <button type="submit" class="primary">Create</button>
    </div>
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
    gap: 12px;
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
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  input:not([type="radio"]),
  select {
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 14px;
  }
  .kinds {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .kinds label {
    align-items: center;
    padding: 8px 4px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--fg);
    cursor: pointer;
    text-align: center;
  }
  .kinds label.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .kinds input {
    display: none;
  }
  .id code {
    font-size: 16px;
    font-weight: 700;
    color: var(--accent-strong);
  }
  .id small,
  .hint {
    color: var(--muted);
  }
  .warn {
    color: var(--danger);
    margin: 0;
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
</style>
