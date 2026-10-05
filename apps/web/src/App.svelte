<script lang="ts">
  import {
    archiveNote,
    type Heading,
    conflictPath,
    headingLinkText,
    isArchived,
    nextId,
    parseId,
    renumberNote,
    taxonomyTags,
    toggleTaskDone,
    insertTemplate,
    createFromTemplate,
    templateName,
    isTemplatePath,
    findCategory,
    findPara,
    findSubPara,
    upsertStaticToc,
    createFreeNote,
    createJournalNote,
    transposeChordBlock,
    splitFrontmatter,
    withFrontmatter,
    type Instrument,
    type NewNote,
  } from "@zeolite/core";
  import { EditorView } from "@codemirror/view";
  import Editor from "./components/Editor.svelte";
  import NewNoteDialog from "./components/NewNoteDialog.svelte";
  import QueryBuilder from "./components/QueryBuilder.svelte";
  import TaxonomyManager from "./components/TaxonomyManager.svelte";
  import TemplateManager from "./components/TemplateManager.svelte";
  import ExportDialog from "./components/ExportDialog.svelte";
  import RenameDialog from "./components/RenameDialog.svelte";
  import DeleteDialog from "./components/DeleteDialog.svelte";
  import ChangeIdDialog from "./components/ChangeIdDialog.svelte";
  import Preview from "./components/Preview.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Toolbar from "./components/Toolbar.svelte";
  import NewFolderDialog from "./components/NewFolderDialog.svelte";
  import LinkDialog from "./components/LinkDialog.svelte";
  import AttachmentDialog from "./components/AttachmentDialog.svelte";
  import SyncDialog from "./components/SyncDialog.svelte";
  import { applyPrefs, DEFAULT_LAYOUT, multiUserChecks, prefs, savePrefs } from "./lib/features.svelte";
  import SettingsDialog from "./components/SettingsDialog.svelte";
  import { describeReport, loadSyncSettings, makeRemote, runSync, saveSyncSettings, syncTarget, type SyncSettings } from "./lib/sync";
  import { demoVault, starterVault } from "./lib/demo-vault";
  import userGuide from "../../../docs/user-guide.md?raw";
  import { insertBlock } from "./lib/editor-commands";
  import { chordDiagram, createRenderer, slug } from "./lib/render";
  import { folderAccessProblem, FsAccessStorage, fsAccessSupported, memoryCopyFromFiles, MemoryStorage } from "./lib/storage";
  import { Vault } from "./lib/vault.svelte";
  import { loadLastVault, regainAccess, saveLastVault } from "./lib/last-vault";
  import { androidExit, CapacitorStorage, lastVaultPath, onAndroidBack, platform, rememberVaultPath, TauriStorage } from "./lib/native";
  import AndroidFolderDialog from "./components/AndroidFolderDialog.svelte";
  import logo from "../../../assets/logo/zeolite-icon.svg";

  type Mode = "edit" | "split" | "view";
  const narrow = () => window.matchMedia("(max-width: 800px)").matches;
  /** ☰: the drawer on phones, show/hide the left panel on wide screens. */
  const toggleSidebar = () => (narrow() ? (drawer = !drawer) : savePrefs({ ...prefs, sidebarHidden: !prefs.sidebarHidden }));

  const demo = new Vault(new MemoryStorage("Demo vault", demoVault()));
  let offerSetup = $state(false);
  let vault = $state<Vault>(demo);
  let current = $state<string | null>(null);
  let content = $state("");
  applyPrefs();
  let mode = $state<Mode>(prefs.startMode === "auto" ? (narrow() ? "edit" : "split") : prefs.startMode);
  let tab = $state<"files" | "tags" | "tasks" | "search">("files");
  let query = $state("");
  let showNew = $state(false);
  let showQuery = $state(false);
  let showTaxonomy = $state(false);
  let showTemplates = $state(false);
  let showExport = $state(false);
  let showRename = $state(false);
  let folderHelp = $state<string | null>(null);
  let readOnlyCopy = $state(false);
  let folderInput = $state<HTMLInputElement>();
  let showDelete = $state(false);
  let showChangeId = $state(false);
  let deleteFolder = $state<string | null>(null);
  /** Parent of the folder being created ("" = vault root), null when the dialog is closed. */
  let newFolderIn = $state<string | null>(null);
  /** Wiki link dialog: the selected text when it opened, null when closed. */
  let linkFrom = $state<string | null>(null);
  /** Attachment shown from the Files list. */
  let attachment = $state<string | null>(null);
  let showSettings = $state(false);
  let lastVault = $state<FileSystemDirectoryHandle | undefined>();
  let androidPicker = $state(false);
  const shell = platform();
  if (shell === "web" && fsAccessSupported()) loadLastVault().then((h) => (lastVault = h));
  let drawer = $state(false);
  let status = $state("");
  let editor = $state<ReturnType<typeof Editor>>();
  // Chord sheets: view-only transposition per note block, chosen fingerings.
  let transposed = $state<Record<string, number>>({});
  let fingerings = $state<Record<string, number>>({});
  let showDiagrams = $state(true);
  let scrolling = $state(false);
  /** Autoscroll speed of the open note: its `autoscroll` property, else 3. */
  const scrollSpeed = $derived.by(() => {
    const v = Number(record?.frontmatter.autoscroll);
    return Number.isFinite(v) && v >= 1 ? Math.min(10, Math.round(v)) : 3;
  });

  const render = $derived(
    createRenderer({
      resolveAsset: (t) => vault.resolveAsset(t),
      resolveNote: (t) => vault.resolveNote(t),
      readNote: (p) => (p === current ? content : vault.read(p)),
      currentPath: () => current,
      runQuery: (src) => vault.runQuery(src, current ?? undefined),
      chords: {
        transpose: (block) => transposed[`${current}#${block}`] ?? 0,
        variant: (sym, instrument) => fingerings[`${instrument}:${sym}`] ?? 0,
        get diagrams() {
          return showDiagrams;
        },
        get autoscroll() {
          return { on: scrolling, speed: scrollSpeed };
        },
      },
    }),
  );
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

  // --- Sync with a WebDAV server -------------------------------------------
  let showSync = $state(false);
  let syncSettings = $state<SyncSettings | null>(null);
  let syncing = $state(false);
  let syncProgress = $state("");
  let syncInfo = $state("");
  let syncError = $state(false);
  /** Question asked before deleting many files during a sync. */
  let syncAsk = $state<{ text: string; sample: string[]; answer: (yes: boolean) => void } | null>(null);

  async function syncNow() {
    if (!syncSettings || syncing || readOnlyCopy) return;
    syncing = true;
    syncProgress = "";
    syncError = false;
    const v = vault;
    try {
      await flush();
      const path = current;
      const before = content;
      const client = makeRemote(syncSettings);
      const report = await runSync(v.storage, client, {
        confirmDeletes: (count, side, sample) =>
          new Promise((resolve) => {
            syncAsk = {
              text: side === "server" ? `Delete ${count} files on the server? They were deleted on this device.` : `Delete ${count} files on this device? They were deleted on the server (they go to .trash).`,
              sample,
              answer: (yes) => ((syncAsk = null), resolve(yes)),
            };
          }),
        onProgress: (done, total) => (syncProgress = total ? `${done}/${total}` : ""),
      });
      if (report.localChanged && vault === v) {
        await v.load();
        if (path && v.exists(path)) {
          const typed = content !== before;
          if (typed && report.downloaded.includes(path)) {
            // Typed during a sync that brought a new version: keep both.
            await v.save(conflictPath(path, new Date(), "THIS-DEVICE"), content);
          }
          if (!typed || report.downloaded.includes(path)) {
            content = v.read(path);
            editor?.setContent(content);
          } else scheduleSave();
        } else if (path) {
          current = null;
          content = "";
        }
      }
      const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      syncInfo = `${time}: ${describeReport(report)}`;
      syncError = report.errors.length > 0;
      if (report.errors.length) status = `⚠ Sync: ${report.errors[0]}${report.errors.length > 1 ? ` (+${report.errors.length - 1} more)` : ""}`;
      else if (report.conflicts.length) status = `Sync: ${report.conflicts.length} note(s) changed on both sides; the server's version is kept as a conflict copy`;
    } catch (e) {
      syncError = true;
      syncInfo = `failed: ${(e as Error).message}`;
      status = `⚠ Sync failed: ${(e as Error).message}`;
    } finally {
      syncing = false;
      syncProgress = "";
    }
  }

  // Automatic sync: every N minutes, and when leaving the app (phone: switching apps).
  $effect(() => {
    const every = syncSettings?.every ?? 0;
    if (!every) return;
    const id = setInterval(() => void syncNow(), every * 60_000);
    return () => clearInterval(id);
  });
  $effect(() => {
    if (!syncSettings) return;
    const onHide = () => document.visibilityState === "hidden" && void syncNow();
    const onOnline = () => void syncNow();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("online", onOnline);
    };
  });

  // --- Files changed by other apps (OneDrive, Syncthing, colleagues) --------
  let checking = false;
  const noteName = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");

  async function diskCheck() {
    if (checking || syncing || vault === demo || readOnlyCopy) return;
    checking = true;
    const started = performance.now();
    try {
      const path = current;
      const base = path ? vault.read(path) : "";
      const r = await vault.checkDisk();
      checkEvery = Math.min(30_000, Math.max(3000, (performance.now() - started) * 10));
      if (!path || path !== current) return;
      if (r.changed.includes(path)) {
        if (content === base) {
          // No edits of ours: show the new version.
          content = vault.read(path);
          editor?.replaceDoc(content);
          status = `“${noteName(path)}” was updated by another app or person`;
        } else {
          // Edited on both sides: keep theirs as a conflict copy, ours stays the note.
          clearTimeout(saveTimer);
          const copy = conflictPath(path, new Date(), "OTHER");
          await vault.save(copy, vault.read(path));
          await vault.save(path, content);
          status = `“${noteName(path)}” was also changed elsewhere: the other version is kept as a conflict copy`;
        }
      } else if (r.removed.includes(path)) {
        if (content === base) {
          clearTimeout(saveTimer);
          current = null;
          content = "";
          status = `“${noteName(path)}” was deleted or moved outside Zeolite`;
        } else {
          await vault.save(path, content);
          status = `“${noteName(path)}” was deleted elsewhere while you were editing it: your version is kept`;
        }
      }
    } catch {
      // Folder temporarily unavailable (network drive, OneDrive busy): try again at the next check.
    } finally {
      checking = false;
    }
  }

  /** Drag the sidebar edge or the editor/preview separator (sizes kept on this device). */
  function startResize(e: PointerEvent, kind: "sidebar" | "split") {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const box = kind === "split" ? handle.parentElement!.getBoundingClientRect() : null;
    const move = (ev: PointerEvent) => {
      if (kind === "sidebar") prefs.sidebarWidth = Math.round(Math.min(640, Math.max(200, ev.clientX)));
      else prefs.split = Math.min(0.85, Math.max(0.15, (ev.clientX - box!.left) / box!.width));
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      savePrefs({ ...prefs });
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  // Android back key: closes an open dialog or the menu; otherwise a second press within 2 s closes the app.
  let exitArmed = false;
  $effect(() => {
    if (shell !== "android") return;
    let stop: (() => void) | undefined;
    let disposed = false;
    void onAndroidBack(() => {
      if (document.querySelector(".backdrop")) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return;
      }
      if (drawer) {
        drawer = false;
        return;
      }
      if (exitArmed) {
        void flush().finally(() => void androidExit());
        return;
      }
      exitArmed = true;
      status = "Press back again to close Zeolite";
      setTimeout(() => {
        exitArmed = false;
        if (status === "Press back again to close Zeolite") status = "";
      }, 2000);
    }).then((s) => (disposed ? s() : (stop = s)));
    return () => {
      disposed = true;
      stop?.();
    };
  });

  // Every 3 s; less often when checking the folder is slow (big vault, network or OneDrive folder).
  let checkEvery = 3000;
  $effect(() => {
    if (!multiUserChecks() || vault === demo || readOnlyCopy) return;
    let last = 0;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible" || Date.now() - last < checkEvery) return;
      last = Date.now();
      void diskCheck();
    }, 1000);
    const onVisible = () => document.visibilityState === "visible" && void diskCheck();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  });

  async function loadVault(v: Vault) {
    v.onConflict = (path, copy) => {
      status = `“${noteName(path)}” was changed elsewhere at the same time: the other version is kept as “${noteName(copy)}”`;
    };
    await v.load();
    vault = v;
    // Never for the demo vault: its notes must not end up in a real vault's server folder.
    syncSettings = readOnlyCopy || v === demo ? null : loadSyncSettings(v.name);
    syncInfo = "";
    syncError = false;
    // An empty real folder: offer to set it up as a new vault.
    offerSetup = v !== demo && !readOnlyCopy && !v.files.some((f) => f.toLowerCase().endsWith(".md"));
    current = null;
    content = "";
    back = [];
    forward = [];
    const saved = v === demo || readOnlyCopy ? null : savedTabs(v);
    if (saved) {
      tabs = saved.paths.map((p) => blankTab(p));
      await showTab(saved.active);
    } else {
      tabs = [blankTab()];
      active = 0;
      const start = ["Welcome.md"].find((p) => v.exists(p)) ?? v.notes[0]?.path;
      if (start) await open(start);
    }
    if (syncSettings) void syncNow();
  }

  // Back/forward through opened notes, like a web browser. Each entry keeps
  // where the note was scrolled to and the cursor, restored when coming back.
  interface Visit {
    path: string;
    cursor: number;
    scroll: number[];
  }
  let back = $state<Visit[]>([]);
  let forward = $state<Visit[]>([]);
  const HISTORY_MAX = 50;

  function here(): Visit | null {
    if (!current) return null;
    const scroll = [...document.querySelectorAll(".panes .cm-scroller, .panes .preview")].map((el) => el.scrollTop);
    return { path: current, cursor: editor?.getView()?.state.selection.main.head ?? 0, scroll };
  }

  function restore(v: Visit) {
    queueMicrotask(() => {
      const view = editor?.getView();
      if (view) view.dispatch({ selection: { anchor: Math.min(v.cursor, view.state.doc.length) } });
      // The preview renders over a few frames (images, queries): retry until the position is reached.
      let frames = 0;
      const apply = () => {
        let done = true;
        document.querySelectorAll(".panes .cm-scroller, .panes .preview").forEach((el, i) => {
          const want = v.scroll[i];
          if (want === undefined || Math.abs(el.scrollTop - want) < 2) return;
          el.scrollTop = want;
          if (Math.abs(el.scrollTop - want) >= 2) done = false;
        });
        if (!done && ++frames < 40) requestAnimationFrame(apply);
      };
      requestAnimationFrame(apply);
    });
  }

  /** Go back (-1) or forward (+1); notes deleted since are skipped. */
  async function navigate(dir: -1 | 1) {
    const from = dir < 0 ? back : forward;
    const to = dir < 0 ? forward : back;
    const stack = [...from];
    let target: Visit | undefined;
    while ((target = stack.pop()) && !vault.exists(target.path));
    const cur = here();
    if (dir < 0) back = stack;
    else forward = stack;
    if (!target) return;
    if (cur) {
      if (dir < 0) forward = [...to, cur];
      else back = [...to, cur];
    }
    await open(target.path, undefined, false);
    restore(target);
  }

  /** Paths in the history (and in tabs) follow renamed and moved notes. */
  function renameInHistory(from: string, to: string) {
    const fix = (list: Visit[]) => list.map((v) => (v.path === from ? { ...v, path: to } : v));
    back = fix(back);
    forward = fix(forward);
    for (const t of tabs) {
      if (t.path === from) t.path = to;
      t.back = fix(t.back);
      t.forward = fix(t.forward);
    }
  }

  // --- Tabs, like Obsidian: opening a note replaces the one in the current tab;
  // ＋ (or Ctrl+click in the Files list) opens a new tab. Each tab has its own ← → history.
  interface Tab {
    id: number;
    path: string | null;
    back: Visit[];
    forward: Visit[];
    /** Scroll and cursor when the tab was left. */
    pos: Visit | null;
  }
  let tabSeq = 0;
  const blankTab = (path: string | null = null): Tab => ({ id: ++tabSeq, path, back: [], forward: [], pos: null });
  let tabs = $state<Tab[]>([blankTab()]);
  let active = $state(0);

  /** Keep the leaving tab's place (history, scroll, cursor). */
  function stashTab() {
    const t = tabs[active];
    if (!t) return;
    t.pos = here();
    t.back = back;
    t.forward = forward;
  }

  async function showTab(i: number) {
    active = i;
    const t = tabs[i]!;
    back = t.back;
    forward = t.forward;
    if (t.path && vault.exists(t.path)) {
      await open(t.path, undefined, false);
      if (t.pos) restore(t.pos);
    } else {
      t.path = null;
      current = null;
      content = "";
    }
  }

  async function switchTab(i: number) {
    if (i === active || !tabs[i]) return;
    await flush();
    stashTab();
    await showTab(i);
  }

  /** A new empty tab: then pick a note in the Files list. */
  async function newTab(path: string | null = null) {
    await flush();
    stashTab();
    tabs.push(blankTab());
    active = tabs.length - 1;
    back = [];
    forward = [];
    current = null;
    content = "";
    drawer = false;
    if (path) await open(path, undefined, false);
  }

  async function closeTab(i: number) {
    await flush();
    if (i !== active) {
      tabs.splice(i, 1);
      if (i < active) active--;
      return;
    }
    clearTimeout(saveTimer);
    tabs.splice(i, 1);
    if (!tabs.length) tabs.push(blankTab());
    await showTab(Math.min(i, tabs.length - 1));
  }

  // Open tabs are remembered per vault (on this device).
  const tabsKey = () => `zeolite.tabs.${vault.name}`;
  $effect(() => {
    const paths = tabs.map((t) => t.path);
    const a = active;
    if (vault === demo || readOnlyCopy) return;
    try {
      localStorage.setItem(tabsKey(), JSON.stringify({ paths, active: a }));
    } catch {
      // Not remembered.
    }
  });
  function savedTabs(v: Vault): { paths: string[]; active: number } | null {
    try {
      const s = JSON.parse(localStorage.getItem(`zeolite.tabs.${v.name}`) ?? "null") as { paths: (string | null)[]; active: number } | null;
      const paths = (s?.paths ?? []).filter((p): p is string => !!p && v.exists(p));
      return paths.length ? { paths, active: Math.min(Math.max(0, s!.active), paths.length - 1) } : null;
    } catch {
      return null;
    }
  }

  /** Open a note. `remember`: the note left can be returned to with Back. */
  async function open(path: string, line?: number, remember = true) {
    await flush();
    scrolling = false;
    if (remember && current && current !== path) {
      const cur = here();
      if (cur) back = [...back, cur].slice(-HISTORY_MAX);
      forward = [];
    }
    current = path;
    if (tabs[active]) tabs[active]!.path = path;
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

  function goToOffset(offset: number) {
    const view = editor?.getView();
    if (!view) return;
    const pos = Math.min(offset, view.state.doc.length);
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    view.focus();
  }

  /** Insert a template at the cursor (after the frontmatter if the cursor is in it). */
  async function applyTemplate(path: string) {
    const view = editor?.getView();
    if (!view || !current) return;
    const id = record?.id ? parseId(record.id) : null;
    const tax = vault.taxonomy;
    const head = view.state.selection.main.head;
    const fmEnd = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content)?.[0].length ?? 0;
    const at = head < fmEnd ? content.length : head;
    const r = insertTemplate(content, at, vault.read(path), {
      title: record?.title ?? "",
      id: record?.id,
      para: id ? findPara(tax, id.para)?.tag : undefined,
      category: id ? findCategory(tax, id.category)?.tag : undefined,
      subpara: id ? findSubPara(tax, id.para, id.sub)?.tag : undefined,
    });
    await replaceContent(r.text);
    goToOffset(r.cursor);
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

  async function create(note: NewNote, cursor: number | null = null) {
    showNew = false;
    try {
      const existed = vault.exists(note.path);
      const path = existed ? note.path : await vault.create(note);
      await open(path);
      if (mode === "view") mode = "edit";
      if (!existed && cursor !== null) queueMicrotask(() => goToOffset(cursor));
    } catch (e) {
      fail(e);
    }
  }

  /** Heading text compared loosely, so that "#my-heading" style anchors match too. */
  const headingKey = (t: string) =>
    headingLinkText(t).toLowerCase().replace(/^h-/, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");

  async function openLink(target: string, heading: string) {
    await flush();
    let path = target ? vault.resolveNote(target) : current ?? undefined;
    if (!path) {
      // Like Obsidian: following a link to a missing note creates it.
      path = await vault.create(createFreeNote("", target));
      status = `Created ${path}`;
    }
    const rec = vault.records.get(path);
    const h = heading
      ? (rec?.headings.find((x) => headingLinkText(x.text) === headingLinkText(heading)) ??
        rec?.headings.find((x) => headingKey(x.text) === headingKey(heading)))
      : undefined;
    if (path === current) {
      // A heading of this note (table of contents, [[#Heading]]): jump, and remember where we were for ←.
      if (!h) return;
      const cur = here();
      if (cur) {
        back = [...back, cur].slice(-HISTORY_MAX);
        forward = [];
      }
      jumpToHeading(h, rec!.headings, true);
      return;
    }
    await open(path, h?.line);
    if (h) jumpToHeading(h, rec!.headings, false);
  }

  /** Scroll the preview (and the editor) to a heading of the open note. */
  function jumpToHeading(h: Heading, all: Heading[], inEditor: boolean) {
    const view = editor?.getView();
    if (inEditor && view) {
      const l = view.state.doc.line(Math.min(h.line + 1, view.state.doc.lines));
      view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "start", yMargin: 12 }) });
    }
    // Same text twice: the n-th heading with that anchor.
    const id = slug(h.text);
    const nth = all.filter((x) => x.line < h.line && slug(x.text) === id).length;
    let frames = 0;
    const go = () => {
      const pane = document.querySelector<HTMLElement>(".panes .preview");
      const el = pane?.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`)[nth];
      if (pane && el) pane.scrollTop += el.getBoundingClientRect().top - pane.getBoundingClientRect().top - 8;
      else if (pane && ++frames < 30) requestAnimationFrame(go);
    };
    requestAnimationFrame(go);
  }

  async function toggleTask(line: number, path?: string) {
    if (path && path !== current) {
      // A task shown in query results from another note.
      const other = vault.read(path).split("\n");
      if (other[line] === undefined) return;
      other[line] = toggleTaskDone(other[line]!);
      await vault.save(path, other.join("\n"));
      return;
    }
    const lines = content.split("\n");
    if (lines[line] === undefined) return;
    lines[line] = toggleTaskDone(lines[line]!);
    await replaceContent(lines.join("\n"));
  }

  async function chordAction(action: string, block: number, chord: string, instrument: string) {
    const key = `${current}#${block}`;
    const shift = transposed[key] ?? 0;
    if (action === "up" || action === "down") {
      // One semitone per click; a full octave brings it back to the original.
      const next = shift + (action === "up" ? 1 : -1);
      transposed[key] = Math.abs(next) >= 12 ? 0 : next;
    }
    if (action === "reset") transposed[key] = 0;
    if (action === "variant") fingerings[`${instrument}:${chord}`] = (fingerings[`${instrument}:${chord}`] ?? 0) + 1;
    if (action === "diagrams") showDiagrams = !showDiagrams;
    if (action === "scroll") scrolling = !scrolling;
    if (action === "slower" || action === "faster") {
      // Saved in the note, like the Chord Sheets plugin, so each song keeps its speed.
      const speed = Math.max(1, Math.min(10, scrollSpeed + (action === "faster" ? 1 : -1)));
      if (speed !== scrollSpeed) await replaceContent(withFrontmatter(content, { ...splitFrontmatter(content).data, autoscroll: speed }));
    }
    if (action === "apply" && shift) {
      transposed[key] = 0;
      await replaceContent(transposeChordBlock(content, block, shift));
      status = `Chords transposed ${shift > 0 ? "+" : ""}${shift} and written to the note`;
    }
  }

  const chordTip = (chord: string, instrument: string) =>
    chordDiagram(chord, instrument as Instrument, fingerings[`${instrument}:${chord}`] ?? 0, 96).svg;

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
      const moved = await vault.move(from, to, text);
      renameInHistory(from, moved);
      await open(moved, undefined, false);
    } catch (e) {
      await open(from, undefined, false);
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
    const r = renumberNote(current, content, newId);
    try {
      await moveCurrent(r.path, r.content);
      status = `Renumbered ${record.id} → ${newId}; links updated`;
    } catch (e) {
      fail(e);
    }
  }

  function insertQuery(block: string) {
    const view = editor?.getView();
    if (!view) return;
    showQuery = false;
    insertBlock(view, block);
  }

  async function saveSearch(title: string, block: string) {
    showQuery = false;
    const note = createFreeNote(vault.settings.searchesFolder, title);
    await create({ ...note, content: `${note.content}${block}\n` });
    mode = mode === "edit" ? "split" : mode;
  }

  /** The user guide, written into the vault (refreshed each time, so it matches this version) and opened. */
  const GUIDE_PATH = "_system/Zeolite User Guide.md";
  async function help() {
    try {
      await flush();
      await vault.save(GUIDE_PATH, userGuide);
      mode = "view";
      await open(GUIDE_PATH);
      drawer = false;
    } catch (e) {
      fail(e);
    }
  }

  async function journal() {
    const settings = vault.settings.journal;
    const note = createJournalNote(new Date(), settings);
    // Obsidian's Daily Notes template if set, else a template named "Journal".
    const tpl =
      (settings.template && vault.exists(settings.template) ? settings.template : undefined) ??
      vault.templates().find((t) => templateName(t).toLowerCase() === "journal");
    if (!tpl || vault.exists(note.path)) return create(note);
    const applied = createFromTemplate(note, vault.read(tpl), { title: note.path.split("/").pop()!.replace(/\.md$/, "") });
    await create(applied, applied.cursor);
  }


  /** Close the open note (unsaved edits are saved first). */
  /** Close the open note: its tab closes. */
  async function closeNote() {
    scrolling = false;
    await closeTab(active);
  }

  /** Drag & drop: move a note into another folder ("" = vault root); links are updated. */
  async function moveNote(path: string, folder: string) {
    const name = path.split("/").pop()!;
    const to = folder ? `${folder}/${name}` : name;
    if (to === path) return;
    if (vault.exists(to)) return fail(new Error(`A note named “${name}” already exists in ${folder || "the vault root"}.`));
    try {
      if (path === current) await moveCurrent(to, content);
      else {
        await flush();
        await vault.move(path, to);
        renameInHistory(path, to);
      }
      status = `Moved to ${folder || "the vault root"}`;
    } catch (e) {
      fail(e);
    }
  }

  async function createFolder(folder: string) {
    await vault.createFolder(folder);
    newFolderIn = null;
    tab = "files";
    status = `Folder “${folder}” created. Drag notes onto it to move them there.`;
  }

  /** Move a folder and everything in it to .trash. */
  async function trashFolder(folder: string) {
    await flush();
    const closeIt = !!current && current.startsWith(`${folder}/`);
    if (closeIt) clearTimeout(saveTimer);
    try {
      const to = await vault.trashFolder(folder);
      if (closeIt) {
        current = null;
        content = "";
      }
      status = `Moved “${folder}” to ${to}`;
    } catch (e) {
      fail(e);
    }
    deleteFolder = null;
  }

  /** Write the starter files (taxonomy, templates, first note) into an empty vault. */
  async function setUpVault() {
    offerSetup = false;
    try {
      for (const [path, content] of Object.entries(starterVault())) await vault.save(path, content);
      await open("Start here.md");
      status = "Vault set up: taxonomy, templates and a first note";
    } catch (e) {
      fail(e);
    }
  }

  /** Native shells: open a vault folder by path and remember it. */
  async function openNative(storage: TauriStorage | CapacitorStorage) {
    await flush();
    readOnlyCopy = false;
    await loadVault(new Vault(storage));
    rememberVaultPath(storage.root);
  }

  async function openFolder() {
    if (shell === "tauri") {
      try {
        const storage = await TauriStorage.pick();
        if (storage) await openNative(storage);
      } catch (e) {
        fail(e);
      }
      return;
    }
    if (shell === "android") return (androidPicker = true);
    const problem = folderAccessProblem();
    if (problem) return (folderHelp = problem);
    try {
      await flush();
      const storage = await FsAccessStorage.pick();
      readOnlyCopy = false;
      await loadVault(new Vault(storage));
      await saveLastVault(storage.handle);
      lastVault = storage.handle;
    } catch (e) {
      if ((e as Error).name !== "AbortError") fail(e);
    }
  }

  /** Fallback without folder access: load a copy of the folder; edits stay in memory. */
  async function openReadOnlyCopy(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = input.files;
    if (!files?.length) return;
    folderHelp = null;
    try {
      await flush();
      readOnlyCopy = true;
      await loadVault(new Vault(await memoryCopyFromFiles(files)));
    } catch (err) {
      fail(err);
    }
    input.value = "";
  }

  /** Reopen the remembered vault folder (one click to confirm access). */
  async function reopenVault() {
    if (!lastVault) return;
    try {
      if (!(await regainAccess(lastVault))) return fail(new Error("Access to the folder was not granted."));
      await flush();
      await loadVault(new Vault(FsAccessStorage.fromHandle(lastVault)));
    } catch (e) {
      fail(e);
    }
  }

  async function onFile(file: File) {
    const name = file.name && file.name !== "image.png" ? file.name : `Pasted image ${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
    const path = await vault.addAttachment(file, name, current);
    return `![[${path.split("/").pop()}]]`;
  }

  function onTag(tag: string) {
    query = `#${tag}`;
    tab = "search";
    drawer = true;
  }

  /** Link targets offered when typing [[ in the editor. */
  const linkTargets = () => [
    ...vault.notes.filter((r) => r.path !== current).map((r) => ({ link: vault.linkText(r.path), detail: r.folder, headings: r.headings.map((h) => h.text) })),
    ...vault.attachments().map((f) => ({ link: vault.linkText(f), detail: "attachment", headings: [] })),
  ];
  const allTags = () => [...new Set([...taxonomyTags(vault.taxonomy), ...vault.tagCounts().keys()])].sort();

  /** Start on the last vault in the native apps, else on the demo vault. */
  async function start() {
    const last = shell !== "web" ? lastVaultPath() : null;
    if (last) {
      const storage = shell === "tauri" ? await TauriStorage.reopen(last) : await CapacitorStorage.reopen(last);
      if (storage) {
        try {
          return await openNative(storage);
        } catch {
          // Fall back to the demo vault below.
        }
      }
    }
    await loadVault(demo);
  }
  start();
</script>

<svelte:window
  onmouseup={(e) => {
    // Mouse side buttons.
    if (e.button === 3 && back.length) { e.preventDefault(); navigate(-1); }
    if (e.button === 4 && forward.length) { e.preventDefault(); navigate(1); }
  }}
  onkeydown={(e) => {
  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
    e.preventDefault();
    navigate(e.key === "ArrowLeft" ? -1 : 1);
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "k" && current && mode !== "view") {
    e.preventDefault();
    const v = editor?.getView();
    linkFrom = v ? v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to) : "";
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); showNew = true; }
  if (e.key === "F1") { e.preventDefault(); help(); }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "t") { e.preventDefault(); newTab(); }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "w") { e.preventDefault(); closeTab(active); }
  if (e.ctrlKey && e.key === "Tab") { e.preventDefault(); switchTab((active + (e.shiftKey ? tabs.length - 1 : 1)) % tabs.length); }
  if (e.key === "F2" && current) { e.preventDefault(); flush().then(() => (showRename = true)); }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "p" && current) { e.preventDefault(); flush().then(() => (showExport = true)); }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "q") { e.preventDefault(); showQuery = true; }
  if ((e.ctrlKey || e.metaKey) && e.key === "\\") { e.preventDefault(); toggleSidebar(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") { e.preventDefault(); mode = mode === "view" ? "edit" : "view"; }
}} />

<div class="app" class:drawer class:side-hidden={prefs.sidebarHidden} style="--sidebar-w: {prefs.sidebarWidth}px">
  <aside class="sidebar">
    <div
      class="resizer side-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      title="Drag to resize (double-click: default width)"
      onpointerdown={(e) => startResize(e, "sidebar")}
      ondblclick={() => savePrefs({ ...prefs, sidebarWidth: DEFAULT_LAYOUT.sidebarWidth })}
    ></div>
    <header class="brand">
      <img src={logo} alt="" width="28" height="28" />
      <div>
        <div class="title">Zeolite</div>
        <div class="vault" title={vault.name}>{vault.name}</div>
      </div>
      <button class="settings" onclick={() => (showSettings = true)} title="Settings: folders, journal, attachments, theme…" aria-label="Settings">⚙</button>
      <button class="settings hide-side" onclick={toggleSidebar} title="Hide this panel (Ctrl+\); ☰ brings it back" aria-label="Hide the left panel">«</button>
    </header>
    <div class="actions">
      <button class="primary" onclick={() => (showNew = true)} title="Ctrl+N">＋ New note</button>
      <button onclick={journal} title="Today's journal">📓</button>
      <button onclick={() => (showTemplates = true)} title="Templates">📄</button>
      <button onclick={openFolder} title="Open a vault folder">📂</button>
      <button onclick={help} title="User guide (F1): adds it to this vault and opens it" aria-label="Help">❓</button>
    </div>
    {#if !readOnlyCopy && vault !== demo}
      <div class="syncbar">
        {#if syncSettings}
          <button class="sync" onclick={syncNow} disabled={syncing} title="Sync now with {syncTarget(syncSettings)}">
            <span class:spin={syncing}>⇅</span> {syncing ? `Syncing… ${syncProgress}` : "Sync"}
          </button>
          <button class="sync-info" class:err={syncError} onclick={() => (showSync = true)} title={syncInfo || "Sync settings"}>
            {syncInfo || "Sync settings"}
          </button>
        {:else}
          <button class="sync-setup" onclick={() => (showSync = true)} title="Sync this vault with a WebDAV server (e.g. on your Docker server) or OneDrive">⇅ Set up sync…</button>
        {/if}
      </div>
    {/if}
    {#if lastVault && vault.name !== lastVault.name}
      <button class="reopen" onclick={reopenVault} title="Reopen your last vault folder">📂 Reopen “{lastVault.name}”</button>
    {/if}
    <Sidebar
      {vault}
      {current}
      bind:tab
      bind:query
      onOpen={open}
      onOpenNewTab={(p) => newTab(p)}
      onQuery={() => (showQuery = true)}
      onTaxonomy={() => (showTaxonomy = true)}
      onMoveNote={moveNote}
      onDeleteFolder={(f) => (deleteFolder = f)}
      onNewFolder={(parent) => (newFolderIn = parent)}
      onOpenAttachment={(p) => (attachment = p)}
    />
  </aside>
  <button class="scrim" aria-label="Close menu" onclick={() => (drawer = false)}></button>

  <main>
    {#if vault === demo}
      <div class="demo" role="status">
        Demo vault: nothing here is saved.
        <button onclick={openFolder}>📂 Open or create your vault</button>
      </div>
    {/if}
    {#if readOnlyCopy}
      <div class="readonly" role="status">Read-only copy of “{vault.name.replace(" (read-only copy)", "")}”: changes stay in this window and are not saved to your files.</div>
    {/if}
    <nav class="tabbar" aria-label="Open notes">
      {#each tabs as t, i (t.id)}
        <div class="tab" class:active={i === active}>
          <button class="tab-name" onclick={() => switchTab(i)} onauxclick={(e) => e.button === 1 && closeTab(i)} title={t.path ?? "Empty tab: pick a note in the Files list"}>
            {t.path ? t.path.split("/").pop()!.replace(/\.md$/i, "") : "New tab"}
          </button>
          <button class="tab-x" onclick={() => closeTab(i)} aria-label="Close tab" title="Close tab">✕</button>
        </div>
      {/each}
      <button class="tab-new" onclick={() => newTab()} title="New tab, then pick a note in the Files list (Ctrl+click a note opens it in a new tab)" aria-label="New tab">＋</button>
    </nav>
    <header class="notebar">
      <button class="menu" aria-label="Show or hide the left panel" title="Show or hide the left panel (Ctrl+\)" onclick={toggleSidebar}>☰</button>
      <div class="nav">
        <button
          disabled={!back.length}
          onclick={() => navigate(-1)}
          aria-label="Back"
          title={back.length ? `Back to “${back.at(-1)!.path.split("/").pop()!.replace(/\.md$/i, "")}” (Alt+←)` : "Back (Alt+←): returns to the previous note after following a link"}
        >←</button>
        <button
          disabled={!forward.length}
          onclick={() => navigate(1)}
          aria-label="Forward"
          title={forward.length ? `Forward to “${forward.at(-1)!.path.split("/").pop()!.replace(/\.md$/i, "")}” (Alt+→)` : "Forward (Alt+→)"}
        >→</button>
      </div>
      <div class="crumbs">
        {#if record?.id}
          <button class="id" onclick={async () => { await flush(); showChangeId = true; }} title="Change this note's ID">{record.id}</button>
        {:else if current && !isTemplatePath(current, vault.settings.templatesFolder) && !current.startsWith("_system/")}
          <button class="id add" onclick={async () => { await flush(); showChangeId = true; }} title="Give this note an ID">＋ Assign ID</button>
        {/if}
        {#if current}
          <button class="path" onclick={async () => { await flush(); showRename = true; }} title="Rename or move this note (F2)">{current}</button>
        {:else}
          <span class="path">No note open</span>
        {/if}
      </div>
      {#if collision}<button class="warnbtn" onclick={renumber}>Renumber</button>{/if}
      {#if record?.id && !isArchived(vault.taxonomy, record.path)}
        <button class="ghost" onclick={archive} title="Move to 04 Archives and tag #Archives">Archive</button>
      {/if}
      {#if current}<button class="pdf" onclick={async () => { await flush(); showExport = true; }} title="Export to PDF (Ctrl+P)">PDF</button>{/if}
      {#if current}<button class="trash" onclick={async () => { await flush(); showDelete = true; }} title="Delete note (moves it to .trash)" aria-label="Delete note">🗑</button>{/if}
      {#if current}<button class="close" onclick={closeNote} title="Close this note (and its tab)" aria-label="Close note">✕</button>{/if}
      <div class="modes" role="radiogroup" aria-label="Mode">
        <button class:active={mode === "edit"} onclick={() => (mode = "edit")}>Edit</button>
        <button class="split" class:active={mode === "split"} onclick={() => (mode = "split")}>Split</button>
        <button class:active={mode === "view"} onclick={() => (mode = "view")}>View</button>
      </div>
    </header>

    {#if current}
      {#if mode !== "view"}
        <Toolbar
          view={() => editor?.getView()}
          onStaticToc={staticToc}
          onQuery={() => (showQuery = true)}
          templates={() => vault.templates()}
          onTemplate={applyTemplate}
          onManageTemplates={() => (showTemplates = true)}
          onLink={(selected) => (linkFrom = selected)}
        />
      {/if}
      <div class="panes mode-{mode}" style="--split-a: {prefs.split}fr; --split-b: {1 - prefs.split}fr">
        {#if mode === "split"}
          <div
            class="resizer split-resizer"
            style="left: calc({prefs.split * 100}% - 3px)"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the editor and the preview"
            title="Drag to resize (double-click: half and half)"
            onpointerdown={(e) => startResize(e, "split")}
            ondblclick={() => savePrefs({ ...prefs, split: DEFAULT_LAYOUT.split })}
          ></div>
        {/if}
        {#if mode !== "view"}
          <section class="pane">
            <Editor bind:this={editor} {content} {onChange} {onFile} tags={allTags} people={() => vault.people()} links={linkTargets} onOpenLink={openLink} />
          </section>
        {/if}
        {#if mode !== "edit"}
          <section class="pane">
            <Preview {html} onOpenLink={openLink} onToggleTask={toggleTask} {onTag} onChordAction={chordAction} {chordTip} autoscroll={scrolling ? scrollSpeed : null} onAutoscrollEnd={() => (scrolling = false)} />
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

<input bind:this={folderInput} type="file" webkitdirectory multiple hidden onchange={openReadOnlyCopy} />

{#if deleteFolder}
  {@const inside = vault.filesIn(deleteFolder)}
  {@const notes = inside.filter((f) => f.toLowerCase().endsWith(".md")).length}
  {@const linked = vault.linksIntoFolder(deleteFolder)}
  <div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (deleteFolder = null)}>
    <div class="help" role="alertdialog" aria-labelledby="df-title">
      <h2 id="df-title">Delete the folder “{deleteFolder}”?</h2>
      <p>
        It holds {notes} note{notes === 1 ? "" : "s"}{inside.length > notes ? ` and ${inside.length - notes} other file${inside.length - notes === 1 ? "" : "s"}` : ""}
        (sub-folders included). Everything moves to the vault's <code>.trash</code> folder, like in Obsidian, and can be recovered from there with your file explorer.
      </p>
      {#if linked.length}
        <p class="warn">{linked.length} note{linked.length > 1 ? "s" : ""} outside the folder link{linked.length > 1 ? "" : "s"} into it: {linked.slice(0, 5).map((r) => r.name).join(", ")}{linked.length > 5 ? "…" : ""}</p>
      {/if}
      {#if deleteFolder.startsWith("_system")}
        <p class="warn">This folder holds Zeolite's settings (taxonomy, templates).</p>
      {/if}
      <div class="help-actions">
        <button onclick={() => (deleteFolder = null)}>Cancel</button>
        <button class="danger" onclick={() => trashFolder(deleteFolder!)}>Move folder to trash</button>
      </div>
    </div>
  </div>
{/if}

{#if offerSetup}
  <div class="backdrop" role="presentation">
    <div class="help" role="alertdialog" aria-labelledby="setup-title">
      <h2 id="setup-title">“{vault.name}” is empty</h2>
      <p>Set it up as a new Zeolite vault? This adds your taxonomy (<code>_system/Taxonomy.md</code>), three starter templates and a “Start here” note. Everything stays plain Markdown files.</p>
      <div class="help-actions">
        <button onclick={() => (offerSetup = false)}>Keep it empty</button>
        <button class="primary" onclick={setUpVault}>Set up the vault</button>
      </div>
    </div>
  </div>
{/if}

{#if androidPicker}
  <AndroidFolderDialog
    onChoose={async (path) => {
      androidPicker = false;
      try {
        await openNative(new CapacitorStorage(path));
      } catch (e) {
        fail(e);
      }
    }}
    onClose={() => (androidPicker = false)}
  />
{/if}

{#if folderHelp}
  <div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (folderHelp = null)}>
    <div class="help" role="alertdialog" aria-labelledby="fh-title">
      <h2 id="fh-title">This page can't open your vault for editing</h2>
      <p>{folderHelp}</p>
      <p class="muted">Meanwhile you can open a <b>read-only copy</b>: browse, search, run queries and export PDFs. Changes will not be saved to your files.</p>
      <div class="help-actions">
        <button onclick={() => (folderHelp = null)}>Close</button>
        <button class="primary" onclick={() => folderInput?.click()}>Open a read-only copy…</button>
      </div>
    </div>
  </div>
{/if}

{#if showChangeId && current}
  <ChangeIdDialog
    {vault}
    path={current}
    {content}
    onApply={async (note) => {
      await moveCurrent(note.path, note.content);
      showChangeId = false;
      status = `ID is now ${note.id}`;
    }}
    onSetupTaxonomy={() => ((showChangeId = false), (showTaxonomy = true))}
    onClose={() => (showChangeId = false)}
  />
{/if}

{#if showDelete && current}
  <DeleteDialog
    {vault}
    path={current}
    onDelete={async () => {
      const path = current!;
      clearTimeout(saveTimer);
      // Errors are shown in the dialog; the note stays open until it is moved.
      const to = await vault.trash(path);
      current = null;
      showDelete = false;
      status = `Moved to ${to}`;
      const next = vault.notes[0]?.path;
      if (next) await open(next);
    }}
    onClose={() => (showDelete = false)}
  />
{/if}

{#if showRename && current}
  <RenameDialog
    {vault}
    path={current}
    {content}
    onRename={async (to, text) => {
      const from = current!;
      await moveCurrent(to, text);
      showRename = false;
      status = to === from ? "Heading updated" : `Renamed to ${to}`;
    }}
    onClose={() => (showRename = false)}
  />
{/if}

{#if showExport && current}
  <ExportDialog
    {vault}
    {current}
    chords={{
      transpose: (path, block) => transposed[`${path}#${block}`] ?? 0,
      variant: (sym, instrument) => fingerings[`${instrument}:${sym}`] ?? 0,
      diagrams: showDiagrams,
    }}
    onSaved={(p) => ((showExport = false), (status = `Saved ${p}`))} onClose={() => (showExport = false)} />
{/if}

{#if showTemplates}
  <TemplateManager {vault} onEdit={(p) => ((showTemplates = false), open(p), mode === "view" && (mode = "split"))} onClose={() => (showTemplates = false)} />
{/if}

{#if showTaxonomy}
  <TaxonomyManager {vault} onOpenNote={(p) => ((showTaxonomy = false), open(p))} onClose={() => (showTaxonomy = false)} />
{/if}

{#if showQuery}
  <QueryBuilder
    taxonomy={vault.taxonomy}
    tags={allTags()}
    people={vault.people()}
    folders={vault.folders()}
    {render}
    onInsert={current && mode !== "view" ? insertQuery : undefined}
    onSave={saveSearch}
    onOpenLink={(t, h) => ((showQuery = false), openLink(t, h))}
    onToggleTask={toggleTask}
    onClose={() => (showQuery = false)}
  />
{/if}

{#if showSync}
  <SyncDialog
    vaultName={vault.name}
    settings={syncSettings}
    last={syncInfo}
    onSave={(s) => {
      saveSyncSettings(vault.name, s);
      syncSettings = s;
      showSync = false;
      void syncNow();
    }}
    onRemove={() => {
      saveSyncSettings(vault.name, null);
      syncSettings = null;
      syncInfo = "";
      showSync = false;
      status = "Sync stopped on this device. Your files stay where they are.";
    }}
    onClose={() => (showSync = false)}
  />
{/if}

{#if syncAsk}
  <div class="backdrop" role="presentation">
    <div class="dialog" role="alertdialog" aria-labelledby="sa-title">
      <h2 id="sa-title">{syncAsk.text}</h2>
      <p>That is a lot at once. If you did not delete them on purpose (for example, a different folder was opened), choose “Keep them”: they are copied back instead.</p>
      <ul>{#each syncAsk.sample as f}<li><code>{f}</code></li>{/each}{#if syncAsk.sample.length >= 5}<li>…</li>{/if}</ul>
      <div class="actions">
        <button onclick={() => syncAsk?.answer(false)}>Keep them</button>
        <button class="danger" onclick={() => syncAsk?.answer(true)}>Delete</button>
      </div>
    </div>
  </div>
{/if}

{#if showSettings}
  <SettingsDialog
    {vault}
    onOpenSync={vault !== demo && !readOnlyCopy ? () => ((showSettings = false), (showSync = true)) : undefined}
    onSetupTaxonomy={() => ((showSettings = false), (showTaxonomy = true))}
    onSaved={(m) => ((showSettings = false), (status = m))}
    onClose={() => (showSettings = false)}
  />
{/if}

{#if attachment}
  <AttachmentDialog
    {vault}
    path={attachment}
    onInsert={current && mode !== "view" ? (text) => ((attachment = null), editor?.insert(text)) : undefined}
    onOpenNote={(p) => ((attachment = null), open(p))}
    onClose={() => (attachment = null)}
  />
{/if}

{#if newFolderIn !== null}
  <NewFolderDialog {vault} parent={newFolderIn} onCreate={createFolder} onClose={() => (newFolderIn = null)} />
{/if}

{#if linkFrom !== null}
  <LinkDialog
    {vault}
    {current}
    selected={linkFrom}
    onInsert={(text) => {
      linkFrom = null;
      editor?.insert(text);
    }}
    onClose={() => {
      linkFrom = null;
      editor?.getView()?.focus();
    }}
  />
{/if}

{#if showNew}
  <NewNoteDialog
    folders={vault.folders()}
    taxonomy={vault.taxonomy}
    existingIds={vault.existingIds}
    templates={vault.templates()}
    readTemplate={(p) => vault.read(p)}
    journal={vault.settings.journal}
    inboxFolder={vault.settings.inboxFolder}
    onCreate={create}
    onClose={() => (showNew = false)}
  />
{/if}

<style>
  .app {
    display: grid;
    grid-template-columns: var(--sidebar-w, 290px) 1fr;
    height: 100%;
  }
  .resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    z-index: 5;
    width: 6px;
    cursor: col-resize;
    touch-action: none;
  }
  .resizer:hover,
  .resizer:active {
    background: var(--accent-soft);
  }
  .side-resizer {
    right: -3px;
  }
  .sidebar {
    position: relative;
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
  .brand .settings {
    margin-left: auto;
    padding: 4px 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    font-size: 17px;
    cursor: pointer;
  }
  .brand .hide-side {
    margin-left: 0;
  }
  .brand .settings:hover {
    border-color: var(--border);
    color: var(--fg);
  }
  .brand .title {
    font-weight: 700;
    font-size: 16px;
    color: var(--accent-strong);
  }
  .brand .vault {
    max-width: calc(var(--sidebar-w, 290px) - 80px);
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
  .actions button:not(.primary) {
    padding: 6px 8px;
  }
  .actions .primary {
    flex: 1;
    white-space: nowrap;
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
  }
  .syncbar {
    display: flex;
    gap: 6px;
    margin: 0 12px 10px;
    font-size: 12.5px;
  }
  .syncbar button {
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .syncbar .sync {
    flex-shrink: 0;
    font-weight: 600;
  }
  .syncbar .sync:disabled {
    cursor: progress;
  }
  .syncbar .sync-info {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    border-color: transparent;
    background: none;
    color: var(--muted);
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .syncbar .sync-info.err {
    color: var(--danger);
  }
  .syncbar .sync-setup {
    flex: 1;
    border-style: dashed;
    color: var(--muted);
    text-align: left;
  }
  .spin {
    display: inline-block;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .reopen {
    margin: 0 12px 10px;
    padding: 7px 10px;
    border: 1px dashed var(--accent);
    border-radius: 6px;
    background: var(--accent-soft);
    color: var(--accent-strong);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  main {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .tabbar {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    padding: 6px 8px 0;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
    scrollbar-width: thin;
  }
  .tab {
    display: flex;
    align-items: center;
    flex: 0 1 180px;
    min-width: 90px;
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: 7px 7px 0 0;
    background: var(--bg);
    opacity: 0.75;
  }
  .tab.active {
    margin-bottom: -1px;
    border-color: var(--accent);
    border-bottom: 1px solid var(--bg);
    opacity: 1;
  }
  .tab-name {
    flex: 1;
    min-width: 0;
    padding: 6px 4px 6px 10px;
    overflow: hidden;
    border: none;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .tab.active .tab-name {
    font-weight: 600;
  }
  .tab-x {
    padding: 2px 6px;
    margin-right: 3px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--muted);
    font-size: 11px;
    cursor: pointer;
  }
  .tab-x:hover {
    background: var(--hover);
    color: var(--fg);
  }
  .tab-new {
    flex-shrink: 0;
    margin: 0 0 4px 4px;
    padding: 3px 9px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    font-size: 15px;
    cursor: pointer;
  }
  .tab-new:hover {
    border-color: var(--border);
    color: var(--fg);
  }
  .notebar {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  @media (min-width: 801px) {
    .app.side-hidden {
      grid-template-columns: 1fr;
    }
    .app.side-hidden .sidebar {
      display: none;
    }
  }
  .crumbs {
    flex: 1;
    min-width: 0;
    display: flex;
    gap: 8px;
    align-items: center;
    overflow: hidden;
  }
  /* Phones: no room for "+ Assign ID" (still available on wider screens). */
  @media (max-width: 560px) {
    .crumbs button.id.add {
      display: none;
    }
    .notebar {
      gap: 4px;
      padding: 6px 8px;
    }
    .notebar button {
      padding: 6px 7px;
    }
    .notebar .modes button {
      padding: 6px 8px;
    }
  }
  .crumbs button.id {
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
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
  .crumbs button.id {
    border: 1px solid transparent;
    cursor: pointer;
  }
  .crumbs button.id:hover {
    border-color: var(--accent);
  }
  .crumbs button.id.add {
    background: none;
    border: 1px dashed var(--accent);
    font-family: inherit;
    font-weight: 600;
  }
  .crumbs .path {
    min-width: 0;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: none;
    font: inherit;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 13px;
  }
  .crumbs button.path:hover {
    border-color: var(--border);
    color: var(--fg);
  }
  .notebar .trash {
    padding: 6px 8px;
  }
  .nav {
    display: flex;
    flex-shrink: 0;
  }
  .nav button {
    padding: 6px 9px;
    font-size: 15px;
    line-height: 1;
  }
  .nav button:first-child {
    border-radius: 6px 0 0 6px;
  }
  .nav button:last-child {
    border-left: none;
    border-radius: 0 6px 6px 0;
  }
  .nav button:disabled {
    opacity: 0.35;
    cursor: default;
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
  .panes {
    position: relative;
  }
  .panes.mode-split {
    grid-template-columns: var(--split-a, 1fr) var(--split-b, 1fr);
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
  .demo {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 6px 12px;
    background: var(--accent-soft);
    color: var(--fg);
    font-size: 13px;
  }
  .demo button {
    padding: 3px 10px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--accent);
    color: var(--on-accent);
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .readonly {
    padding: 6px 12px;
    background: var(--warn-soft);
    color: var(--fg);
    font-size: 13px;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgb(0 0 0 / 0.35);
  }
  .help {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(500px, 100%);
    padding: 20px;
    border-radius: 12px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
  }
  .help h2 {
    margin: 0;
    font-size: 18px;
  }
  .help p {
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
  }
  .help .muted {
    color: var(--muted);
  }
  .help-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
  }
  .help-actions button {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .help .warn {
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--warn-soft);
  }
  .help-actions .danger {
    border-color: var(--danger);
    background: var(--danger);
    color: #fff;
  }
  .help-actions .primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }

  @media (max-width: 800px) {
    .app {
      grid-template-columns: 1fr;
    }
    .sidebar {
      position: fixed;
      inset: 0 auto 0 0;
      z-index: 40;
      box-sizing: border-box;
      width: min(86vw, 320px);
      padding: var(--safe-top) 0 var(--safe-bottom) var(--safe-left);
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
    .modes .split,
    .notebar .ghost {
      display: none;
    }
    .panes.mode-split {
      grid-template-columns: 1fr;
    }
    .resizer {
      display: none;
    }
  }
</style>
