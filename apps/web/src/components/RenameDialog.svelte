<script lang="ts">
  import { idFromFileName, sanitizeTitle } from "@zeolite/core";
  import { untrack } from "svelte";
  import type { Vault } from "../lib/vault.svelte";

  interface Props {
    vault: Vault;
    path: string;
    /** Note text (unsaved edits included). */
    content: string;
    onRename: (to: string, content: string) => Promise<void>;
    onClose: () => void;
  }
  let { vault, path, content, onRename, onClose }: Props = $props();

  // Fixed for the dialog's lifetime.
  const original = (() => {
    const parts = path.split("/");
    const file = parts.pop()!.replace(/\.md$/i, "");
    const id = idFromFileName(file);
    return { folder: parts.join("/"), id, title: id ? file.slice(id.length).trim() : file };
  })();

  let title = $state(original.title);
  let folder = $state(original.folder);
  let error = $state("");
  let busy = $state(false);

  // The note as it was when the dialog opened.
  const heading = untrack(() => /^(#\s+)(.+?)\s*$/m.exec(content.replace(/^---\n[\s\S]*?\n---\n?/, "")));
  const headingMatches = !!heading && sanitizeTitle(heading[2]!) === sanitizeTitle(original.title);
  let updateHeading = $state(headingMatches);

  const folders = $derived(["", ...new Set([...vault.folders(), original.folder].filter(Boolean))].sort());
  const clean = $derived(sanitizeTitle(title));
  const fileName = $derived(`${original.id ? `${original.id}${clean ? " " : ""}` : ""}${clean}.md`);
  const target = $derived(folder ? `${folder.replace(/\/+$/, "")}/${fileName}` : fileName);
  const unchanged = $derived(target === path && !(updateHeading && clean !== original.title));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    if (!clean && !original.id) return (error = "The name cannot be empty.");
    if (target !== path && vault.exists(target)) return (error = `A note already exists at ${target}.`);
    let text = content;
    if (updateHeading && heading && clean) {
      text = content.replace(heading[0], `${heading[1]}${title.trim()}`);
    }
    busy = true;
    try {
      await onRename(target, text);
    } catch (err) {
      error = (err as Error).message;
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <form class="dialog" onsubmit={submit}>
    <h2>Rename note</h2>
    <label for="rn-title">Name</label>
    <div class="name">
      {#if original.id}<span class="id" title="Note IDs never change">{original.id}</span>{/if}
      <!-- svelte-ignore a11y_autofocus -->
      <input id="rn-title" bind:value={title} autofocus onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
    </div>
    <label>Folder
      <select bind:value={folder}>
        {#each folders as f}<option value={f}>{f || "(vault root)"}</option>{/each}
      </select>
    </label>
    {#if heading}
      <label class="check">
        <input type="checkbox" bind:checked={updateHeading} /> Also change the heading “{heading[2]}”
      </label>
    {/if}
    <p class="hint">New path: <code>{target}</code>. Links to this note are updated across the vault.</p>
    {#if error}<p class="error">{error}</p>{/if}
    <div class="actions">
      <button type="button" onclick={onClose}>Cancel</button>
      <button type="submit" class="primary" disabled={busy || unchanged}>Rename</button>
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
    padding: calc(16px + var(--safe-top)) calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left));
    background: rgb(0 0 0 / 0.35);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(480px, 100%);
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
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--fg);
  }
  .name {
    display: flex;
    align-items: stretch;
  }
  .id {
    display: flex;
    align-items: center;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-right: none;
    border-radius: 6px 0 0 6px;
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-family: var(--mono);
    font-size: 13px;
    font-weight: 700;
  }
  .id + input {
    border-radius: 0 6px 6px 0;
  }
  input:not([type="checkbox"]),
  select {
    flex: 1;
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 14px;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 12.5px;
    overflow-wrap: anywhere;
  }
  .error {
    margin: 0;
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
