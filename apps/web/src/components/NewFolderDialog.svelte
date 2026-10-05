<script lang="ts">
  import type { Vault } from "../lib/vault.svelte";

  interface Props {
    vault: Vault;
    /** Pre-selected parent folder ("" = vault root). */
    parent: string;
    onCreate: (folder: string) => Promise<void>;
    onClose: () => void;
  }
  let { vault, parent: initialParent, onCreate, onClose }: Props = $props();

  let name = $state("");
  // svelte-ignore state_referenced_locally
  let parent = $state(initialParent);
  let error = $state("");
  let busy = $state(false);

  const parents = $derived(["", ...vault.folders()]);
  // "/" in the name creates nested folders ("Projects/2026").
  const segments = $derived(
    name
      .split(/[\\/]/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const invalid = $derived(segments.find((s) => /[:*?"<>|#^[\]]/.test(s) || s.startsWith(".") || /\.$/.test(s)));
  const target = $derived([parent, ...segments].filter(Boolean).join("/"));
  const exists = $derived(!!target && vault.folderExists(target));

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    if (!segments.length) return (error = "Type a folder name.");
    if (invalid) return (error = `“${invalid}” cannot be used: folder names cannot start with a dot, end with a dot, or contain : * ? " < > | # ^ [ ].`);
    if (exists) return (error = `The folder “${target}” already exists.`);
    busy = true;
    try {
      await onCreate(target);
    } catch (err) {
      error = (err as Error).message;
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <form class="dialog" onsubmit={submit}>
    <h2>New folder</h2>
    <label for="nf-name">Name</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input id="nf-name" bind:value={name} autofocus placeholder="e.g. Meetings" autocomplete="off" />
    <label>Inside
      <select bind:value={parent}>
        {#each parents as f}<option value={f}>{f || "(vault root)"}</option>{/each}
      </select>
    </label>
    <p class="hint">
      {#if target}New folder: <code>{target}</code>{#if exists} <span class="warn">already exists</span>{/if}.{/if}
      Use <code>/</code> to create sub-folders at once (<code>Projects/2026</code>). Then drag notes onto it in the Files list,
      or choose it as the folder when you create or rename a note.
    </p>
    {#if error}<p class="error">{error}</p>{/if}
    <div class="actions">
      <button type="button" onclick={onClose}>Cancel</button>
      <button type="submit" class="primary" disabled={busy || !segments.length || exists}>Create</button>
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
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  input,
  select {
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
  .warn,
  .error {
    color: var(--danger);
  }
  .error {
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
  .actions .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
