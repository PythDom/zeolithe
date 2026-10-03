<script lang="ts">
  import { isArchived, TAXONOMY_PATH, toIsoDate } from "@zeolite/core";
  import type { Vault } from "../lib/vault.svelte";

  interface Props {
    vault: Vault;
    current: string | null;
    tab: "files" | "tags" | "tasks" | "search";
    query: string;
    onOpen: (path: string, line?: number) => void;
    onQuery: () => void;
    onTaxonomy: () => void;
    /** A note was dropped on a folder ("" = vault root). */
    onMoveNote: (path: string, folder: string) => void;
    onDeleteFolder: (folder: string) => void;
    /** Create a folder inside `parent` ("" = vault root). */
    onNewFolder: (parent: string) => void;
    /** An attachment (image, PDF…) was clicked in the Files list. */
    onOpenAttachment: (path: string) => void;
  }
  let { vault, current, tab = $bindable(), query = $bindable(), onOpen, onQuery, onTaxonomy, onMoveNote, onDeleteFolder, onNewFolder, onOpenAttachment }: Props = $props();

  // Drag & drop of notes onto folders.
  const DRAG_TYPE = "application/x-zeolite-note";
  let dragging = $state<string | null>(null);
  let dropTarget = $state<string | null>(null);
  const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

  function dragStart(e: DragEvent, path: string) {
    dragging = path;
    e.dataTransfer?.setData(DRAG_TYPE, path);
    e.dataTransfer?.setData("text/plain", path);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  }
  function dragOver(e: DragEvent, folder: string) {
    if (!dragging || folderOf(dragging) === folder) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    dropTarget = folder;
  }
  function drop(e: DragEvent, folder: string) {
    e.preventDefault();
    const path = e.dataTransfer?.getData(DRAG_TYPE) || dragging;
    dragging = null;
    dropTarget = null;
    if (path && folderOf(path) !== folder) onMoveNote(path, folder);
  }
  function dragEnd() {
    dragging = null;
    dropTarget = null;
  }

  const today = toIsoDate(new Date());

  // Files grouped by folder: notes first, then attachments (images, PDFs…).
  const folders = $derived.by(() => {
    const map = new Map<string, { notes: string[]; others: string[] }>();
    const entry = (dir: string) => map.get(dir) ?? map.set(dir, { notes: [], others: [] }).get(dir)!;
    for (const d of vault.dirs) entry(d);
    for (const f of vault.files) {
      const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
      if (f.toLowerCase().endsWith(".md")) entry(dir).notes.push(f);
      else entry(dir).others.push(f);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)));
  });
  const fileName = (path: string) => path.split("/").pop()!;
  const fileIcon = (path: string) =>
    /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(path) ? "🖼" : /\.pdf$/i.test(path) ? "📕" : /\.(docx?|odt|rtf|txt)$/i.test(path) ? "📄" : /\.(xlsx?|ods|csv)$/i.test(path) ? "📊" : /\.(pptx?|odp)$/i.test(path) ? "📽" : "📎";
  let collapsed = $state<Record<string, boolean>>({});

  // Tags grouped by taxonomy role.
  const tagGroups = $derived.by(() => {
    const counts = vault.tagCounts();
    const tax = vault.taxonomy;
    const known = new Set<string>();
    const group = (title: string, tags: string[]) => {
      tags.forEach((t) => known.add(t));
      return { title, tags: tags.map((t) => ({ tag: t, count: counts.get(t) ?? 0 })) };
    };
    const groups = [
      group("PARA", tax.paras.map((p) => p.tag)),
      ...tax.paras
        .filter((p) => (tax.subParas[p.code]?.length ?? 0) > 0)
        .map((p) => group(`Sub-PARA · ${p.tag}`, tax.subParas[p.code]!.map((s) => s.tag))),
      group("Categories", tax.categories.map((c) => c.tag)),
    ];
    const other = [...counts.keys()].filter((t) => !known.has(t)).sort();
    groups.push({ title: "Other tags (not in taxonomy)", tags: other.map((t) => ({ tag: t, count: counts.get(t)! })) });
    return groups;
  });
  let showUnused = $state(false);

  // Open tasks and unresolved Attn points across the vault.
  const openTasks = $derived(
    vault.notes
      .filter((r) => !isArchived(vault.taxonomy, r.path))
      .flatMap((r) => r.tasks.filter((t) => t.status === "open").map((t) => ({ r, t })))
      .sort((a, b) => (a.t.due ?? "9999") .localeCompare(b.t.due ?? "9999")),
  );
  const openAttn = $derived(vault.notes.flatMap((r) => r.attn.filter((a) => !a.resolved).map((a) => ({ r, a }))));

  const hits = $derived(vault.search(query));
  const savedSearches = $derived(vault.notes.filter((r) => r.folder === vault.settings.searchesFolder));
  const label = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");
</script>

<nav class="tabs">
  {#each [["files", "Files"], ["tags", "Tags"], ["tasks", "Tasks"], ["search", "Search"]] as [k, l]}
    <button class:active={tab === k} onclick={() => (tab = k as Props["tab"])}>{l}</button>
  {/each}
</nav>

<div class="panel">
  {#if vault.collisions.length || vault.conflicts.length || vault.taxonomy.warnings.length || !vault.exists(TAXONOMY_PATH)}
    <div class="alerts">
      {#each vault.collisions as c}
        <div class="alert">⚠ ID {c.id} used twice. Renumber
          {#each c.renumber as n}<button class="link" onclick={() => onOpen(n.path)}>{label(n.path)}</button>{/each}
        </div>
      {/each}
      {#each vault.conflicts as c}
        {@const original = vault.conflictOf(c.path)}
        <div class="alert">
          ⇄ {original ? "Conflict copy of" : "Conflict copy"}
          {#if original}<button class="link" onclick={() => onOpen(original)}>{label(original)}</button>{/if}:
          <button class="link" onclick={() => onOpen(c.path)}>{label(c.path)}</button>
          <span class="hint">Merge what you need into the note, then delete the copy.</span>
        </div>
      {/each}
      {#if !vault.exists(TAXONOMY_PATH)}
        <div class="alert">No taxonomy in this vault yet, so notes are not numbered. <button class="link" onclick={onTaxonomy}>Set it up</button></div>
      {/if}
      {#each vault.taxonomy.warnings.filter((w) => !w.startsWith("No _system/Taxonomy.md")) as w}<div class="alert">⚠ {w}</div>{/each}
    </div>
  {/if}

  {#if tab === "files"}
    <button class="build" onclick={() => onNewFolder("")}>📁＋ New folder…</button>
    {#each folders as [dir, { notes: files, others }]}
      {#if dir}
        <div
          class="folder-row"
          class:over={dropTarget === dir}
          role="group"
          ondragover={(e) => dragOver(e, dir)}
          ondragleave={() => dropTarget === dir && (dropTarget = null)}
          ondrop={(e) => drop(e, dir)}
        >
          <button class="folder" onclick={() => (collapsed[dir] = !collapsed[dir])}>{collapsed[dir] ? "▸" : "▾"} {dir}</button>
          <button class="folder-add" title="New folder inside “{dir}”" aria-label="New folder inside {dir}" onclick={() => onNewFolder(dir)}>＋</button>
          <button class="folder-del" title="Delete folder “{dir}” (moves it to .trash)" aria-label="Delete folder {dir}" onclick={() => onDeleteFolder(dir)}>🗑</button>
        </div>
      {/if}
      {#if !collapsed[dir]}
        {#each files as f}
          <button
            class="file"
            class:indent={!!dir}
            class:active={f === current}
            class:dragged={f === dragging}
            draggable="true"
            ondragstart={(e) => dragStart(e, f)}
            ondragend={dragEnd}
            onclick={() => onOpen(f)}
            title="{f} (drag onto a folder to move it)"
          >
            {label(f)}
          </button>
        {:else}
          {#if dir && !others.length && !vault.dirs.some((d) => d.startsWith(`${dir}/`)) && !vault.filesIn(dir).length}<p class="folder-empty">Empty. Drag notes here, or create one in this folder.</p>{/if}
        {/each}
        {#each others as f}
          <button class="file attachment" class:indent={!!dir} onclick={() => onOpenAttachment(f)} title="{f}: click to view, link or open it">
            <span class="ficon">{fileIcon(f)}</span>{fileName(f)}
          </button>
        {/each}
      {/if}
    {/each}
    {#if dragging}
      <div
        class="root-drop"
        class:over={dropTarget === ""}
        role="region"
        aria-label="Move to the vault root"
        ondragover={(e) => dragOver(e, "")}
        ondragleave={() => (dropTarget = null)}
        ondrop={(e) => drop(e, "")}
      >
        ⤒ Drop here to move to the vault root
      </div>
    {/if}
  {:else if tab === "tags"}
    <button class="build" onclick={onTaxonomy}>⚙ Manage taxonomy…</button>
    <label class="toggle"><input type="checkbox" bind:checked={showUnused} /> Show unused taxonomy tags</label>
    {#each tagGroups as g}
      {#if g.tags.some((t) => t.count > 0 || showUnused)}
        <h4>{g.title}</h4>
        <div class="chips">
          {#each g.tags.filter((t) => t.count > 0 || showUnused) as t}
            <button class="chip" class:unused={t.count === 0} onclick={() => ((query = `#${t.tag}`), (tab = "search"))}>
              #{t.tag} <span>{t.count}</span>
            </button>
          {/each}
        </div>
      {/if}
    {/each}
  {:else if tab === "tasks"}
    <h4>Open tasks ({openTasks.length})</h4>
    {#each openTasks as { r, t }}
      <button class="item" onclick={() => onOpen(r.path, t.line)}>
        <span class="text">☐ {t.text}</span>
        <span class="meta">
          {#if t.due}<span class="due" class:overdue={t.due < today} class:today={t.due === today}>📅 {t.due}</span>{/if}
          {label(r.path)}
        </span>
      </button>
    {:else}
      <p class="empty">No open tasks.</p>
    {/each}
    <h4>Open Attn points ({openAttn.length})</h4>
    {#each openAttn as { r, a }}
      <button class="item" onclick={() => onOpen(r.path, a.line)}>
        <span class="text attn">⚠ {a.text}</span>
        <span class="meta">{label(r.path)}</span>
      </button>
    {:else}
      <p class="empty">No open Attn points.</p>
    {/each}
  {:else}
    <input class="search" type="search" placeholder="Words or #tag" bind:value={query} />
    <button class="build" onclick={onQuery}>🔍 Build a Dataview query…</button>
    {#if !query && savedSearches.length}
      <h4>Saved searches</h4>
      {#each savedSearches as s}
        <button class="item" onclick={() => onOpen(s.path)}><span class="text">🔍 {s.name}</span></button>
      {/each}
    {/if}
    {#each hits as h}
      <button class="item" onclick={() => onOpen(h.record.path)}>
        <span class="text">{h.record.name}</span>
        {#if h.snippet}<span class="meta">…{h.snippet}…</span>{/if}
      </button>
    {:else}
      {#if query}<p class="empty">No results.</p>{/if}
    {/each}
  {/if}
</div>

<style>
  .tabs {
    display: flex;
    gap: 2px;
    padding: 0 8px 6px;
  }
  .tabs button {
    flex: 1;
    padding: 6px 0;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .tabs button.active {
    border-bottom-color: var(--accent);
    color: var(--fg);
    font-weight: 600;
  }
  .panel {
    flex: 1;
    overflow: auto;
    padding: 4px 8px 20px;
  }
  button {
    font: inherit;
    color: inherit;
  }
  .folder,
  .file,
  .item {
    display: block;
    width: 100%;
    padding: 4px 8px;
    border: none;
    border-radius: 6px;
    background: none;
    text-align: left;
    cursor: pointer;
    font-size: 13.5px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder {
    margin-top: 6px;
    color: var(--muted);
    font-weight: 600;
  }
  .folder-row {
    display: flex;
    align-items: center;
    margin-top: 6px;
    border-radius: 6px;
  }
  .folder-row .folder {
    flex: 1;
    min-width: 0;
    margin-top: 0;
  }
  .folder-row.over,
  .root-drop.over {
    outline: 2px dashed var(--accent);
    background: var(--accent-soft);
  }
  .folder-add,
  .folder-del {
    padding: 2px 6px;
    border: none;
    border-radius: 6px;
    background: none;
    font-size: 12px;
    opacity: 0;
    cursor: pointer;
  }
  .folder-add {
    color: var(--accent-strong);
    font-size: 14px;
    font-weight: 700;
  }
  .folder-row:hover .folder-add,
  .folder-add:focus-visible,
  .folder-row:hover .folder-del,
  .folder-del:focus-visible {
    opacity: 0.7;
  }
  .folder-add:hover,
  .folder-del:hover {
    opacity: 1;
    background: var(--hover);
  }
  /* Touch screens have no hover: keep the button visible. */
  @media (hover: none) {
    .folder-add,
    .folder-del {
      opacity: 0.6;
    }
  }
  .folder-empty {
    margin: 2px 0 4px 22px;
    color: var(--muted);
    font-size: 12px;
    font-style: italic;
  }
  .root-drop {
    margin: 4px 0 8px;
    padding: 8px;
    border: 1px dashed var(--border);
    border-radius: 6px;
    color: var(--muted);
    font-size: 12.5px;
    text-align: center;
  }
  .file.attachment {
    color: var(--muted);
    font-size: 12.5px;
  }
  .file.attachment .ficon {
    margin-right: 5px;
  }
  .file.dragged {
    opacity: 0.5;
  }
  .file.indent {
    padding-left: 22px;
  }
  .file:hover,
  .item:hover,
  .folder:hover {
    background: var(--hover);
  }
  .file.active {
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .item {
    white-space: normal;
    padding: 6px 8px;
  }
  .item .text {
    display: block;
  }
  .item .meta {
    display: block;
    color: var(--muted);
    font-size: 12px;
  }
  .attn {
    color: var(--warn);
  }
  .due {
    margin-right: 6px;
  }
  .due.overdue {
    color: var(--danger);
    font-weight: 600;
  }
  .due.today {
    color: var(--warn);
    font-weight: 600;
  }
  h4 {
    margin: 14px 4px 6px;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--accent-soft);
    font-size: 12.5px;
    cursor: pointer;
  }
  .chip span {
    color: var(--muted);
  }
  .chip.unused {
    opacity: 0.5;
    background: none;
  }
  .toggle {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 4px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .search {
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 8px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .build {
    width: 100%;
    margin-bottom: 8px;
    padding: 7px 8px;
    border: 1px dashed var(--accent);
    border-radius: 6px;
    background: none;
    color: var(--accent-strong);
    font-size: 13px;
    cursor: pointer;
  }
  .empty {
    padding: 4px 8px;
    color: var(--muted);
    font-size: 13px;
  }
  .alert .hint {
    display: block;
    color: var(--muted);
    font-size: 11.5px;
  }
  .alerts {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
  }
  .alert {
    padding: 6px 8px;
    border-radius: 6px;
    background: var(--warn-soft);
    font-size: 12.5px;
  }
  .link {
    padding: 0 4px;
    border: none;
    background: none;
    color: var(--accent-strong);
    text-decoration: underline;
    cursor: pointer;
  }
</style>
