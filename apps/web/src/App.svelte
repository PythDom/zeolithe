<script lang="ts">
  import {
    archiveNote,
    headingLinkText,
    isArchived,
    nextId,
    parseId,
    renumberNote,
    taxonomyTags,
    toggleTaskDone,
    upsertStaticToc,
    createFreeNote,
    createJournalNote,
    type NewNote,
  } from "@zeolithe/core";
  import { EditorView } from "@codemirror/view";
  import Editor from "./components/Editor.svelte";
  import NewNoteDialog from "./components/NewNoteDialog.svelte";
  import Preview from "./components/Preview.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import { demoVault } from "./lib/demo-vault";
  import { createRenderer } from "./lib/render";
  import { FsAccessStorage, fsAccessSupported, MemoryStorage } from "./lib/storage";
  import { Vault } from "./lib/vault.svelte";
  import logo from "../../../assets/logo/zeolithe-icon.svg";

  type Mode = "edit" | "split" | "view";
  const narrow = () => window.matchMedia("(max-width: 800px)").matches;

  const demo = new Vault(new MemoryStorage("Demo vault", demoVault()));
  let vault = $state<Vault>(demo);
  let current = $state<string | null>(null);
  let content = $state("");
  let mode = $state<Mode>(narrow() ? "edit" : "split");
  let tab = $state<"files" | "tags" | "tasks" | "search">("files");
  let query = $state("");
  let showNew = $state(false);
  let drawer = $state(false);
  let status = $state("");
  let editor = $state<ReturnType<typeof Editor>>();

  const render = $derived(createRenderer({ resolveAsset: (t) => vault.resolveAsset(t), resolveNote: (t) => vault.resolveNote(t) }));
  const html = $derived(current ? render(content) : "");
  const record = $derived(current ? vault.records.get(current) : undefined);
  const collision = $derived(current ? vault.collisions.find((c) => c.renumber.some((n) => n.path === current)) : undefined);

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave() {
    clearTimeout(saveTimer);
    const path = current;
    const text = content;
    saveTimer = setTimeout(() => path && vault.save(path, text).catch(fail), 400);
  }
  async function flush() {
    clearTimeout(saveTimer);
    if (current) await vault.save(current, content);
  }
  function fail(e: unknown) {
    status = `⚠ ${(e as Error).message ?? e}`;
  }

  async function loadVault(v: Vault) {
    await v.load();
    vault = v;
    current = null;
    content = "";
    const start = ["Welcome.md"].find((p) => v.exists(p)) ?? v.notes[0]?.path;
    if (start) await open(start);
  }

  async function open(path: string, line?: number) {
    await flush();
    current = path;
    content = vault.read(path);
    editor?.setContent(content);
    drawer = false;
    if (line !== undefined) queueMicrotask(() => goToLine(line));
  }

  function goToLine(line: number) {
    const view = editor?.getView();
    if (!view) return;
    const l = view.state.doc.line(Math.min(line + 1, view.state.doc.lines));
    view.dispatch({ selection: { anchor: l.to }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
    view.focus();
  }

  function onChange(text: string) {
    content = text;
    scheduleSave();
  }

  /** Apply a whole-document change coming from outside the editor. */
  async function replaceContent(text: string) {
    content = text;
    editor?.setContent(text);
    await flush();
  }

  async function create(note: NewNote) {
    showNew = false;
    try {
      const path = vault.exists(note.path) ? note.path : await vault.create(note);
      await open(path);
      if (mode === "view") mode = "edit";
    } catch (e) {
      fail(e);
    }
  }

  async function openLink(target: string, heading: string) {
    let path = target ? vault.resolveNote(target) : current ?? undefined;
    if (!path) {
      if (!confirm(`"${target}" does not exist. Create it?`)) return;
      path = await vault.create(createFreeNote("", target));
    }
    const rec = vault.records.get(path);
    const h = heading ? rec?.headings.find((x) => headingLinkText(x.text) === headingLinkText(heading)) : undefined;
    await open(path, h?.line);
  }

  async function toggleTask(line: number) {
    const lines = content.split("\n");
    if (lines[line] === undefined) return;
    lines[line] = toggleTaskDone(lines[line]!);
    await replaceContent(lines.join("\n"));
  }

  async function staticToc() {
    const view = editor?.getView();
    const line = view ? view.state.doc.lineAt(view.state.selection.main.head).number - 1 : undefined;
    await replaceContent(upsertStaticToc(content, content.includes("<!-- toc -->") ? undefined : line, { minLevel: 2 }));
  }

  /** Move the open note. The pending save must not recreate the old file. */
  async function moveCurrent(to: string, text: string) {
    await flush();
    const from = current!;
    current = null;
    try {
      await open(await vault.move(from, to, text));
    } catch (e) {
      await open(from);
      throw e;
    }
  }

  async function archive() {
    if (!current) return;
    try {
      const a = archiveNote(vault.taxonomy, current, content);
      await moveCurrent(a.path, a.content);
      status = `Archived to ${a.path}`;
    } catch (e) {
      fail(e);
    }
  }

  async function renumber() {
    if (!current || !record?.id) return;
    const id = parseId(record.id)!;
    const newId = nextId(id.para, id.category, id.sub, vault.existingIds);
    if (!confirm(`Renumber ${record.id} → ${newId}? Links to this note are updated.`)) return;
    const r = renumberNote(current, content, newId);
    try {
      await moveCurrent(r.path, r.content);
      status = `Renumbered to ${newId}`;
    } catch (e) {
      fail(e);
    }
  }

  async function journal() {
    await create(createJournalNote());
  }

  async function openFolder() {
    try {
      await flush();
      await loadVault(new Vault(await FsAccessStorage.pick()));
    } catch (e) {
      if ((e as Error).name !== "AbortError") fail(e);
    }
  }

  async function onFile(file: File) {
    const name = file.name && file.name !== "image.png" ? file.name : `Pasted image ${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    const path = await vault.addAttachment(file, name);
    return `![[${path.split("/").pop()}]]`;
  }

  function onTag(tag: string) {
    query = `#${tag}`;
    tab = "search";
    drawer = true;
  }

  const allTags = () => [...new Set([...taxonomyTags(vault.taxonomy), ...vault.tagCounts().keys()])].sort();

  loadVault(demo);
</script>

<svelte:window onkeydown={(e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); showNew = true; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") { e.preventDefault(); mode = mode === "view" ? "edit" : "view"; }
}} />

<div class="app" class:drawer>
  <aside class="sidebar">
    <header class="brand">
      <img src={logo} alt="" width="28" height="28" />
      <div>
        <div class="title">Zeolithe</div>
        <div class="vault" title={vault.name}>{vault.name}</div>
      </div>
    </header>
    <div class="actions">
      <button class="primary" onclick={() => (showNew = true)} title="Ctrl+N">＋ New note</button>
      <button onclick={journal} title="Today's journal">📓</button>
      <button onclick={openFolder} disabled={!fsAccessSupported()} title={fsAccessSupported() ? "Open a vault folder" : "Folder access needs Chrome/Edge desktop here; native apps come next"}>📂</button>
    </div>
    <Sidebar {vault} {current} bind:tab bind:query onOpen={open} />
  </aside>
  <button class="scrim" aria-label="Close menu" onclick={() => (drawer = false)}></button>

  <main>
    <header class="notebar">
      <button class="menu" aria-label="Menu" onclick={() => (drawer = !drawer)}>☰</button>
      <div class="crumbs">
        {#if record?.id}<span class="id">{record.id}</span>{/if}
        <span class="path">{current ?? "No note open"}</span>
      </div>
      {#if collision}<button class="warnbtn" onclick={renumber}>Renumber</button>{/if}
      {#if record?.id && !isArchived(vault.taxonomy, record.path)}
        <button class="ghost" onclick={archive} title="Move to 04 Archives and tag #Archives">Archive</button>
      {/if}
      <div class="modes" role="radiogroup" aria-label="Mode">
        <button class:active={mode === "edit"} onclick={() => (mode = "edit")}>Edit</button>
        <button class="split" class:active={mode === "split"} onclick={() => (mode = "split")}>Split</button>
        <button class:active={mode === "view"} onclick={() => (mode = "view")}>View</button>
      </div>
    </header>

    {#if current}
      {#if mode !== "view"}
        <Toolbar view={() => editor?.getView()} onStaticToc={staticToc} />
      {/if}
      <div class="panes mode-{mode}">
        {#if mode !== "view"}
          <section class="pane">
            <Editor bind:this={editor} {content} {onChange} {onFile} tags={allTags} people={() => vault.people()} />
          </section>
        {/if}
        {#if mode !== "edit"}
          <section class="pane">
            <Preview {html} onOpenLink={openLink} onToggleTask={toggleTask} {onTag} />
          </section>
        {/if}
      </div>
    {:else}
      <div class="empty">
        <img src={logo} alt="" width="96" height="96" />
        <p>Open a note from the sidebar or create a new one.</p>
      </div>
    {/if}
    {#if status}<button class="status" onclick={() => (status = "")}>{status}</button>{/if}
  </main>
</div>

{#if showNew}
  <NewNoteDialog taxonomy={vault.taxonomy} existingIds={vault.existingIds} onCreate={create} onClose={() => (showNew = false)} />
{/if}

<style>
  .app {
    display: grid;
    grid-template-columns: 290px 1fr;
    height: 100dvh;
  }
  .sidebar {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--border);
    background: var(--panel);
  }
  .brand {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 14px 14px 10px;
  }
  .brand .title {
    font-weight: 700;
    font-size: 16px;
    color: var(--accent-strong);
  }
  .brand .vault {
    max-width: 210px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--muted);
  }
  .actions {
    display: flex;
    gap: 6px;
    padding: 0 12px 10px;
  }
  .actions button,
  .notebar button {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .actions button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .actions .primary {
    flex: 1;
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  main {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .notebar {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  .notebar .menu {
    display: none;
  }
  .crumbs {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .crumbs .id {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-family: var(--mono);
    font-size: 12.5px;
    font-weight: 700;
    white-space: nowrap;
  }
  .crumbs .path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 13px;
  }
  .notebar .warnbtn {
    border-color: var(--warn);
    color: var(--warn);
  }
  .modes {
    display: flex;
  }
  .modes button {
    border-radius: 0;
  }
  .modes button:first-child {
    border-radius: 6px 0 0 6px;
  }
  .modes button:last-child {
    border-radius: 0 6px 6px 0;
  }
  .modes button + button {
    border-left: none;
  }
  .modes button.active {
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .panes {
    flex: 1;
    display: grid;
    min-height: 0;
  }
  .panes.mode-split {
    grid-template-columns: 1fr 1fr;
  }
  .panes.mode-split .pane + .pane {
    border-left: 1px solid var(--border);
  }
  .pane {
    min-width: 0;
    min-height: 0;
  }
  .empty {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    color: var(--muted);
  }
  .status {
    position: absolute;
    right: 16px;
    bottom: 16px;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--panel);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
    box-shadow: 0 6px 20px rgb(0 0 0 / 0.15);
  }
  .scrim {
    display: none;
  }

  @media (max-width: 800px) {
    .app {
      grid-template-columns: 1fr;
    }
    .sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 40;
      width: min(86vw, 320px);
      transform: translateX(-100%);
      transition: transform 0.2s ease;
    }
    .app.drawer .sidebar {
      transform: none;
    }
    .app.drawer .scrim {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 30;
      border: none;
      background: rgb(0 0 0 / 0.35);
    }
    .notebar .menu {
      display: block;
    }
    .modes .split,
    .notebar .ghost {
      display: none;
    }
    .panes.mode-split {
      grid-template-columns: 1fr;
    }
  }
</style>
