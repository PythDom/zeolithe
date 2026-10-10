<script lang="ts">
  import { onDestroy } from "svelte";
  import { ANDROID_ROOT, androidHasAccess, androidListFolders, androidMakeFolder, androidRequestAccess, onAndroidResume } from "../lib/native";

  interface Props {
    onChoose: (path: string) => void;
    onClose: () => void;
    title?: string;
  }
  let { onChoose, onClose, title = "Choose your vault folder" }: Props = $props();

  let access = $state<boolean | null>(null);
  let path = $state(ANDROID_ROOT);
  let folders = $state<string[]>([]);
  let error = $state("");
  let newName = $state<string | null>(null);
  let stop: (() => void) | undefined;

  async function refreshAccess() {
    access = await androidHasAccess();
    if (access) await load(path);
  }

  async function load(p: string) {
    error = "";
    try {
      folders = await androidListFolders(p);
      path = p;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  refreshAccess();
  onAndroidResume(refreshAccess).then((s) => (stop = s));
  onDestroy(() => stop?.());

  const shown = $derived(path === ANDROID_ROOT ? "Internal storage" : `Internal storage${path.slice(ANDROID_ROOT.length)}`);
  async function makeFolder(e: SubmitEvent) {
    e.preventDefault();
    const name = (newName ?? "").trim();
    if (!name) return;
    if (/[\\/:*?"<>|]/.test(name) || name.startsWith(".")) return (error = "A folder name cannot start with a dot or contain / \\ : * ? \" < > |.");
    try {
      await androidMakeFolder(`${path}/${name}`);
      newName = null;
      await load(`${path}/${name}`);
    } catch (err) {
      error = (err as Error).message;
    }
  }

  const up = () => load(path.slice(0, path.lastIndexOf("/")) || ANDROID_ROOT);
</script>

<div class="backdrop" role="presentation">
  <div class="dialog" role="dialog" aria-label={title}>
    <header>
      <h2>{title}</h2>
      <button class="ghost" aria-label="Close" onclick={onClose}>✕</button>
    </header>

    {#if access === null}
      <p class="body">Checking access…</p>
    {:else if !access}
      <div class="body">
        <p>To edit notes in an ordinary folder (the one Syncthing keeps in sync), Zeolite needs Android's <b>All files access</b>, like Obsidian and Syncthing-Fork.</p>
        <p class="muted">The next screen opens Android settings: turn on <b>Allow access to manage all files</b> for Zeolite, then come back.</p>
        <button class="primary" onclick={androidRequestAccess}>Open Android settings</button>
        <details>
          <summary>The setting is not under “Permissions”</summary>
          <p class="muted">All files access is a <i>special</i> access, so the app's Permissions page says no permissions are requested. Look instead in <b>Settings → Apps → Special app access → All files access → Zeolite</b> (Samsung: <b>Settings → Apps → ⋮ → Special access → All files access</b>). You can also search Settings for “All files access”.</p>
        </details>
        <button class="ghost" onclick={refreshAccess}>I've allowed it: check again</button>
      </div>
    {:else}
      <div class="crumbs">
        <button class="ghost" disabled={path === ANDROID_ROOT} onclick={up} aria-label="Up one folder">↑</button>
        <span>{shown}</span>
      </div>
      <ul class="list">
        {#each folders as f}
          <li><button onclick={() => load(`${path}/${f}`)}>📁 {f}</button></li>
        {:else}
          <li class="muted">No sub-folders.</li>
        {/each}
      </ul>
      {#if error}<p class="error">{error}</p>{/if}
      {#if newName !== null}
        <form class="new" onsubmit={makeFolder}>
          <!-- svelte-ignore a11y_autofocus -->
          <input bind:value={newName} placeholder="New folder name, e.g. Zeolite" autofocus />
          <button class="primary" type="submit" disabled={!newName.trim()}>Create</button>
          <button class="ghost" type="button" onclick={() => (newName = null)}>Cancel</button>
        </form>
      {/if}
      <footer>
        <button class="ghost new-btn" onclick={() => (newName = "")} disabled={newName !== null}>＋ New folder</button>
        <button class="primary" disabled={path === ANDROID_ROOT} onclick={() => onChoose(path)}>Use “{path.split("/").pop()}”</button>
      </footer>
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
    padding: calc(16px + var(--safe-top)) calc(16px + var(--safe-right)) calc(16px + var(--safe-bottom)) calc(16px + var(--safe-left));
    background: rgb(0 0 0 / 0.35);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    width: min(480px, 100%);
    max-height: 100%;
    border-radius: 12px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
    overflow: hidden;
  }
  header,
  footer,
  .crumbs {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 16px;
  }
  header {
    border-bottom: 1px solid var(--border);
  }
  .new {
    display: flex;
    gap: 6px;
    padding: 8px 16px;
  }
  .new input {
    flex: 1;
    min-width: 0;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .new-btn {
    margin-right: auto;
  }
  footer {
    justify-content: flex-end;
    border-top: 1px solid var(--border);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 17px;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px 16px;
  }
  p {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
  }
  .muted {
    color: var(--muted);
  }
  details summary {
    cursor: pointer;
    font-size: 14px;
    color: var(--accent-strong);
  }
  details p {
    margin-top: 6px;
  }
  .crumbs span {
    overflow-wrap: anywhere;
    font-weight: 600;
  }
  .list {
    flex: 1;
    min-height: 120px;
    margin: 0;
    padding: 0 8px 8px;
    list-style: none;
    overflow: auto;
  }
  .list button {
    width: 100%;
    padding: 10px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 15px;
    text-align: left;
    cursor: pointer;
  }
  .list button:hover {
    background: var(--hover);
  }
  .list .muted {
    padding: 10px;
  }
  .error {
    padding: 0 16px 8px;
    color: var(--danger);
  }
  button.ghost,
  .primary {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
