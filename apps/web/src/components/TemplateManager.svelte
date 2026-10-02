<script lang="ts">
  import { sanitizeTitle, templateName, templateStarter } from "@zeolite/core";
  import type { Vault } from "../lib/vault.svelte";

  interface Props {
    vault: Vault;
    onEdit: (path: string) => void;
    onClose: () => void;
  }
  let { vault, onEdit, onClose }: Props = $props();

  let newName = $state("");
  let renaming = $state<string | null>(null);
  let renameTo = $state("");
  let confirmDelete = $state<string | null>(null);
  let error = $state("");

  const templates = $derived(vault.templates());
  // The vault's templates folder (Obsidian's Templates setting, else _system/Templates).
  const TEMPLATES_FOLDER = $derived(vault.settings.templatesFolder);
  const pathFor = (name: string) => `${TEMPLATES_FOLDER}/${sanitizeTitle(name)}.md`;

  async function create(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    const name = sanitizeTitle(newName);
    if (!name) return;
    try {
      await vault.create({ path: pathFor(name), content: templateStarter() });
      newName = "";
      onEdit(pathFor(name));
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function duplicate(path: string) {
    error = "";
    let n = 2;
    while (vault.exists(pathFor(`${templateName(path)} ${n}`))) n++;
    await vault.create({ path: pathFor(`${templateName(path)} ${n}`), content: vault.read(path) });
  }

  async function rename(path: string) {
    error = "";
    const name = sanitizeTitle(renameTo);
    if (!name || name === templateName(path)) return (renaming = null);
    try {
      await vault.move(path, pathFor(name));
      renaming = null;
    } catch (err) {
      error = (err as Error).message;
    }
  }

  async function remove(path: string) {
    await vault.remove(path);
    confirmDelete = null;
  }

  const firstLine = (path: string) =>
    vault
      .read(path)
      .replace(/^---[\s\S]*?\n---\n?/, "")
      .split("\n")
      .find((l) => l.trim())
      ?.slice(0, 70) ?? "";
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="dialog" role="dialog" aria-label="Templates">
    <header>
      <h2>Templates</h2>
      <button class="ghost" aria-label="Close" onclick={onClose}>✕</button>
    </header>
    <div class="body">
      <p class="hint">
        Templates are notes in <code>{TEMPLATES_FOLDER}/</code>, compatible with Obsidian's Templates plugin. Pick one in
        <b>New note</b>, or insert it with <b>📄 Template</b> in the toolbar. A template named like a Sub-PARA, a PARA,
        "Journal" or "Inbox" is preselected for those notes.
      </p>

      <ul class="list">
        {#each templates as t (t)}
          <li>
            {#if renaming === t}
              <!-- svelte-ignore a11y_autofocus -->
              <input bind:value={renameTo} autofocus onkeydown={(e) => { if (e.key === "Enter") rename(t); if (e.key === "Escape") { e.stopPropagation(); renaming = null; } }} />
              <button onclick={() => rename(t)}>Save</button>
              <button onclick={() => (renaming = null)}>Cancel</button>
            {:else if confirmDelete === t}
              <span class="name">Delete “{templateName(t)}”?</span>
              <button class="danger" onclick={() => remove(t)}>Delete</button>
              <button onclick={() => (confirmDelete = null)}>Keep</button>
            {:else}
              <div class="info">
                <span class="name">📄 {templateName(t)}</span>
                <span class="first">{firstLine(t)}</span>
              </div>
              <button onclick={() => onEdit(t)}>Edit</button>
              <button onclick={() => duplicate(t)}>Duplicate</button>
              <button onclick={() => ((renaming = t), (renameTo = templateName(t)))}>Rename</button>
              <button onclick={() => (confirmDelete = t)}>Delete</button>
            {/if}
          </li>
        {:else}
          <li class="empty">No templates yet. Create one below.</li>
        {/each}
      </ul>

      <form class="add" onsubmit={create}>
        <input bind:value={newName} placeholder="New template name, e.g. Meeting" aria-label="New template name" />
        <button class="primary" type="submit" disabled={!newName.trim()}>Create and edit</button>
      </form>
      {#if error}<p class="error">{error}</p>{/if}

      <details>
        <summary>Variables</summary>
        <table>
          <tbody>
            <tr><td><code>{"{{title}}"}</code></td><td>Note title</td></tr>
            <tr><td><code>{"{{date}}"}</code> · <code>{"{{time}}"}</code></td><td>2026-10-02 · 14:31</td></tr>
            <tr><td><code>{"{{date:dddd D MMMM YYYY}}"}</code></td><td>Friday 2 October 2026 (YYYY MM DD dddd ddd MMMM MMM WW HH mm…)</td></tr>
            <tr><td><code>{"{{id}}"}</code></td><td>Note ID (PARA notes)</td></tr>
            <tr><td><code>{"{{para}}"}</code> <code>{"{{category}}"}</code> <code>{"{{subpara}}"}</code></td><td>Taxonomy tags of the ID</td></tr>
            <tr><td><code>{"{{cursor}}"}</code></td><td>Where the cursor goes</td></tr>
          </tbody>
        </table>
        <p class="hint">Properties (frontmatter) in a template are added to the note; its tags are merged.</p>
      </details>
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
    width: min(680px, 100%);
    max-height: 100%;
    border-radius: 12px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 17px;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px 16px;
    overflow: auto;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
  }
  .list li {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .list li:last-child {
    border-bottom: none;
  }
  .info {
    flex: 1 1 200px;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name {
    font-weight: 600;
  }
  .first {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 12.5px;
  }
  .empty {
    color: var(--muted);
  }
  button,
  input {
    font: inherit;
    font-size: 13px;
  }
  .list button,
  .ghost {
    padding: 4px 9px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    cursor: pointer;
  }
  .list .danger {
    border-color: var(--danger);
    color: var(--danger);
  }
  input {
    flex: 1 1 200px;
    min-width: 0;
    padding: 7px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
  }
  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
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
  .error {
    margin: 0;
    color: var(--danger);
  }
  details {
    font-size: 13px;
  }
  summary {
    cursor: pointer;
    color: var(--accent-strong);
  }
  details table {
    margin: 8px 0;
    border-collapse: collapse;
  }
  details td {
    padding: 3px 10px 3px 0;
    vertical-align: top;
  }
</style>
