<script lang="ts">
  import type { Vault } from "../lib/vault.svelte";

  interface Props {
    vault: Vault;
    path: string;
    /** Insert a link to it in the open note (absent when no note is being edited). */
    onInsert?: (text: string) => void;
    onOpenNote: (path: string) => void;
    /** After the file went to .trash: where to. */
    onDeleted?: (trashPath: string) => void;
    onClose: () => void;
  }
  let { vault, path, onInsert, onOpenNote, onDeleted, onClose }: Props = $props();

  const name = $derived(path.split("/").pop()!);
  const folder = $derived(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "(vault root)");
  const isImage = $derived(/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path));
  const url = $derived(isImage ? vault.resolveAsset(path) : undefined);
  const link = $derived(vault.linkText(path));
  // Notes that link to or embed this file.
  const usedBy = $derived(vault.notes.filter((r) => r.links.some((l) => l.target === link || l.target === name || l.target === path)));
  let error = $state("");

  // Deleting: a second click confirms (and says which notes still show it).
  let confirmDelete = $state(false);
  async function deleteIt() {
    if (!confirmDelete) return (confirmDelete = true);
    error = "";
    try {
      const to = await vault.trash(path);
      onDeleted?.(to);
    } catch (e) {
      error = `Cannot delete it: ${(e as Error).message ?? e}`;
    }
  }

  async function openIt() {
    error = "";
    try {
      await vault.storage.openFile!(path);
    } catch (e) {
      error = `Cannot open it: ${(e as Error).message ?? e}`;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="dialog" role="dialog" aria-label={name}>
    <h2>{name}</h2>
    <p class="hint">In {folder}</p>
    {#if url}<img src={url} alt={name} />{/if}
    {#if usedBy.length}
      <p class="hint">Used in:
        {#each usedBy as r, i}{#if i}, {/if}<button class="link" onclick={() => onOpenNote(r.path)}>{r.name}</button>{/each}
      </p>
    {:else}
      <p class="hint">No note links to it yet.</p>
    {/if}
    {#if confirmDelete}
      <p class="warn">
        {usedBy.length
          ? `${usedBy.length} note${usedBy.length > 1 ? "s" : ""} still ${usedBy.length > 1 ? "show" : "shows"} it (${usedBy.map((r) => r.name).join(", ")}): ${usedBy.length > 1 ? "their" : "its"} link will be broken.`
          : "No note uses it."}
        It goes to the vault's .trash folder, where it can still be recovered. Click <b>Delete</b> again to confirm.
      </p>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
    <div class="actions">
      {#if onDeleted}<button class="danger" onclick={deleteIt} title="Move this file to the vault's .trash folder">🗑 {confirmDelete ? "Delete" : "Delete…"}</button>{/if}
      <span class="spacer"></span>
      {#if onInsert}
        <button onclick={() => onInsert(isImage ? `![[${link}]]` : `[[${link}]]`)} title="At the cursor in the open note">
          {isImage ? "Insert in the note" : "Link in the note"}
        </button>
      {/if}
      {#if vault.storage.openFile}<button onclick={openIt}>Open with its app</button>{/if}
      <button class="primary" onclick={onClose}>Close</button>
    </div>
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
    gap: 10px;
    width: min(640px, 100%);
    max-height: calc(100vh - 32px);
    overflow: auto;
    padding: 20px;
    border-radius: 12px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
  }
  h2 {
    margin: 0;
    font-size: 17px;
    overflow-wrap: anywhere;
  }
  img {
    max-width: 100%;
    max-height: 60vh;
    object-fit: contain;
    border-radius: 6px;
    background: var(--bg);
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }
  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent-strong);
    font: inherit;
    text-decoration: underline dotted;
    cursor: pointer;
  }
  .error {
    margin: 0;
    color: var(--danger);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions button {
    padding: 8px 12px;
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
  .actions .danger {
    border-color: var(--danger);
    color: var(--danger);
  }
  .spacer {
    flex: 1;
  }
  .warn {
    margin: 0;
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--warn-soft);
    font-size: 13.5px;
  }
</style>
