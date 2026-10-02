<script lang="ts">
  import { untrack } from "svelte";
  import type { Vault } from "../lib/vault.svelte";

  interface Props {
    vault: Vault;
    path: string;
    onDelete: () => Promise<void>;
    onClose: () => void;
  }
  let { vault, path, onDelete, onClose }: Props = $props();

  // Taken when the dialog opens.
  const linked = untrack(() => vault.backlinks(path));
  const name = untrack(() => path.split("/").pop()!.replace(/\.md$/i, ""));
  let busy = $state(false);
  let error = $state("");

  async function confirm() {
    busy = true;
    error = "";
    try {
      await onDelete();
    } catch (e) {
      error = (e as Error).message;
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="dialog" role="alertdialog" aria-labelledby="del-title">
    <h2 id="del-title">Delete “{name}”?</h2>
    <p>The note moves to the vault's <code>.trash</code> folder, like in Obsidian. You can get it back from there with your file explorer.</p>
    {#if linked.length}
      <p class="warn">
        {linked.length} note{linked.length > 1 ? "s link" : " links"} to it; those links will no longer resolve:
        {linked.slice(0, 5).map((r) => r.name).join(", ")}{linked.length > 5 ? "…" : ""}
      </p>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}
    <div class="actions">
      <button type="button" onclick={onClose}>Cancel</button>
      <!-- svelte-ignore a11y_autofocus -->
      <button type="button" class="danger" disabled={busy} onclick={confirm} autofocus>Move to trash</button>
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
    padding: 16px;
    background: rgb(0 0 0 / 0.35);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(440px, 100%);
    padding: 20px;
    border-radius: 12px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
  }
  h2 {
    margin: 0;
    font-size: 18px;
    overflow-wrap: anywhere;
  }
  p {
    margin: 0;
    font-size: 14px;
  }
  .warn {
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--warn-soft);
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
  .actions .danger {
    border-color: var(--danger);
    background: var(--danger);
    color: #fff;
  }
</style>
