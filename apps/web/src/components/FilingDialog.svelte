<script lang="ts">
  /**
   * Filing many notes at once: importing .md files into the vault, or
   * numbering the vault's notes that have no ID yet. Each note gets a
   * PARA / Category / Sub-PARA suggested from its closest numbered notes
   * (shared words, and meaning when the AI index is on), the next free
   * number of that series, and its PARA folder.
   */
  import {
    allocateIds,
    assignId,
    buildKeywordIndex,
    importTitle,
    keywordDocs,
    mergeRelated,
    numberablePara,
    plainWords,
    relatedByKeywords,
    relatedByVectors,
    renameAttachmentLinks,
    sanitizeTitle,
    searchByKeywords,
    suggestFiling,
    type FilingSuggestion,
    type Related,
  } from "@zeolite/core";
  import { untrack } from "svelte";
  import { ai } from "../lib/ai-state.svelte";
  import { platform } from "../lib/native";
  import type { Vault } from "../lib/vault.svelte";

  interface Props {
    vault: Vault;
    mode: "import" | "number";
    /** A note was renamed or moved (numbering), so that open tabs follow it. */
    onMoved: (from: string, to: string) => Promise<void>;
    /** All done: what was done, and the first note filed (opened after an import). */
    onDone: (summary: string, first: string | null) => void;
    onSetupTaxonomy: () => void;
    onClose: () => void;
  }
  let { vault, mode, onMoved, onDone, onSetupTaxonomy, onClose }: Props = $props();

  type Action = "file" | "inbox" | "skip";
  interface Row {
    key: string;
    /** The note's path (numbering) or the file's name (import). */
    source: string;
    text: string;
    title: string;
    action: Action;
    para: string;
    category: string;
    sub: string;
    /** Number typed by hand ("" = next free). */
    num: string;
    selected: boolean;
    suggestion: FilingSuggestion | null;
    /** Filing changed by hand: suggestions no longer replace it. */
    touched: boolean;
  }

  /** Share of the closest notes that must agree before a note is numbered by default. */
  const STRONG = 0.5;
  const tax = $derived(vault.taxonomy);
  const paras = $derived(numberablePara(tax));
  const firstFiling = () => {
    const p = paras[0];
    return { para: p?.code ?? "", category: tax.categories[0]?.code ?? "", sub: (p && tax.subParas[p.code]?.[0]?.code) ?? "" };
  };

  let rows = $state<Row[]>([]);
  let attachments = $state<File[]>([]);
  let copyAttachments = $state(true);
  let moveToPara = $state(true);
  let picked = $state(untrack(() => mode === "number"));
  let busy = $state(false);
  let progress = $state("");
  let error = $state("");
  let refining = $state("");

  // Words index of the vault's notes (system notes and templates left out).
  const skipPath = (p: string) => p.startsWith("_system/") || p.startsWith(`${vault.settings.templatesFolder}/`);
  const indexed = untrack(() => vault.notes.filter((r) => !r.conflict && !skipPath(r.path)));
  const keywords = buildKeywordIndex(keywordDocs(indexed));
  const idOf = (path: string) => vault.records.get(path)?.id;
  const suggest = (neighbours: Related[]) => suggestFiling(neighbours, idOf, untrack(() => vault.taxonomy));

  function withSuggestion(row: Row, s: FilingSuggestion | null): Row {
    if (row.touched) return { ...row, suggestion: s };
    if (!s) return { ...row, suggestion: null };
    // A clear majority of the closest notes: numbered that way by default. A weak one is only pre-filled.
    const action: Action = row.action === "skip" && mode === "import" ? "skip" : s.confidence >= STRONG ? "file" : row.action;
    return { ...row, suggestion: s, para: s.para, category: s.category, sub: s.sub, action };
  }

  // --- Numbering: the notes without an ID (not journal, templates, saved searches, system notes).
  if (untrack(() => mode) === "number") {
    const s = untrack(() => vault.settings);
    const outside = [s.templatesFolder, s.journal.folder, s.searchesFolder, s.exportsFolder, "_system"].filter(Boolean).map((f) => `${f}/`);
    const notes = untrack(() => vault.notes.filter((r) => !r.id && !r.conflict && !outside.some((f) => r.path.startsWith(f))));
    const f = untrack(firstFiling);
    rows = notes.map((r) => {
      const words = relatedByKeywords(keywords, r.path, 12, 0.03);
      const meaning = ai.index ? relatedByVectors(r.path, ai.index.entries, 12) : [];
      const base: Row = { key: r.path, source: r.path, text: "", title: r.path.split("/").pop()!.replace(/\.md$/i, ""), action: "skip", ...f, num: "", selected: false, suggestion: null, touched: false };
      return withSuggestion(base, suggest(mergeRelated(words, meaning, 12)));
    });
  }

  // --- Import: read the chosen files.
  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (!files.length) return;
    error = "";
    const f = firstFiling();
    const fresh: Row[] = [];
    const others: File[] = [];
    for (const file of files) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      if (rel.split("/").some((p) => p.startsWith("."))) continue;
      if (!/\.(md|markdown)$/i.test(file.name)) {
        others.push(file);
        continue;
      }
      const text = (await file.text()).replace(/^﻿/, "").replace(/\r\n/g, "\n");
      const title = sanitizeTitle(importTitle(file.name, text)) || "Imported note";
      const base: Row = { key: `${rows.length + fresh.length}:${rel}`, source: rel, text, title, action: "inbox", ...f, num: "", selected: false, suggestion: null, touched: false };
      fresh.push(withSuggestion(base, suggest(searchByKeywords(keywords, `${title} ${title} ${plainWords(text)}`, 12))));
    }
    rows = [...rows, ...fresh];
    attachments = [...attachments, ...others];
    picked = true;
    if (!fresh.length) error = "No .md file among the chosen files.";
    void refineByMeaning(fresh.map((r) => r.key));
  }

  /** With the AI index on: better suggestions for imported notes, by meaning. */
  async function refineByMeaning(keys: string[]) {
    const index = ai.index;
    if (!index || !keys.length) return;
    try {
      for (const [i, key] of keys.entries()) {
        refining = `Refining suggestions by meaning: ${i + 1}/${keys.length}`;
        const row = rows.find((r) => r.key === key);
        if (!row) continue;
        const hits = await index.search(`${row.title}\n${plainWords(row.text).slice(0, 1500)}`, 20);
        const seen = new Set<string>();
        const meaning = hits.filter((h) => !seen.has(h.path) && seen.add(h.path)).map((h) => ({ path: h.path, score: h.score, why: [] }));
        const words = searchByKeywords(keywords, `${row.title} ${row.title} ${plainWords(row.text)}`, 12);
        const s = suggest(mergeRelated(words, meaning, 12));
        rows = rows.map((r) => (r.key === key ? withSuggestion(r, s) : r));
      }
    } catch {
      // Words only.
    }
    refining = "";
  }

  // --- Applying a filing to the selected rows.
  let bulk = $state({ para: "", category: "", sub: "" });
  $effect(() => {
    if (!bulk.para && paras[0]) bulk = firstFiling();
  });
  const bulkSubs = $derived(tax.subParas[bulk.para] ?? []);
  $effect(() => {
    if (bulk.para && !bulkSubs.some((s) => s.code === bulk.sub)) bulk.sub = bulkSubs[0]?.code ?? "";
  });
  const selectedCount = $derived(rows.filter((r) => r.selected).length);
  function applyToSelected() {
    rows = rows.map((r) => (r.selected ? { ...r, ...bulk, action: "file", touched: true, num: "" } : r));
  }
  function selectAll(on: boolean) {
    rows = rows.map((r) => ({ ...r, selected: on }));
  }
  function setPara(row: Row, para: string) {
    row.para = para;
    const subs = tax.subParas[para] ?? [];
    if (!subs.some((s) => s.code === row.sub)) row.sub = subs[0]?.code ?? "";
    row.touched = true;
    row.action = "file";
  }

  // --- The resulting IDs and paths, checked.
  const numbered = $derived(rows.filter((r) => r.action === "file"));
  const ids = $derived(
    allocateIds(
      numbered.map((r) => ({ key: r.key, para: r.para, category: r.category, sub: r.sub, seq: /^\d{1,3}$/.test(r.num.trim()) ? Number(r.num.trim()) : r.num.trim() ? NaN : undefined })),
      vault.existingIds,
    ),
  );
  const paraFolder = (code: string) => paras.find((p) => p.code === code)?.folder ?? "";
  const folderOf = (row: Row) => {
    if (row.action === "file" && moveToPara) return paraFolder(row.para);
    if (mode === "number") return row.source.includes("/") ? row.source.slice(0, row.source.lastIndexOf("/")) : "";
    return vault.settings.inboxFolder;
  };
  const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);
  const targets = $derived.by(() => {
    const out = new Map<string, { path?: string; id?: string; error?: string }>();
    const seen = new Map<string, string>();
    for (const r of rows) {
      if (r.action === "skip") continue;
      const res = r.action === "file" ? ids.get(r.key) : {};
      if (res?.error) {
        out.set(r.key, { error: res.error });
        continue;
      }
      if (!sanitizeTitle(r.title)) {
        out.set(r.key, { error: "Give it a title." });
        continue;
      }
      const name = res?.id ? `${res.id} ${sanitizeTitle(r.title)}.md` : `${sanitizeTitle(r.title)}.md`;
      const path = join(folderOf(r), name);
      const clash = (vault.exists(path) && path !== r.source) || seen.has(path.toLowerCase());
      seen.set(path.toLowerCase(), r.key);
      out.set(r.key, clash ? { error: `${path} already exists.` } : { path, id: res?.id });
    }
    return out;
  });
  const todo = $derived(rows.filter((r) => r.action !== "skip"));
  const problems = $derived(todo.filter((r) => targets.get(r.key)?.error).length);
  const label = (code: string, list: { code: string; tag: string }[]) => {
    const e = list.find((x) => x.code === code);
    return e ? `${e.code} #${e.tag}` : code;
  };
  const why = (s: FilingSuggestion) => s.basis.slice(0, 2).map((p) => p.split("/").pop()!.replace(/\.md$/i, "")).join(", ");

  // --- Doing it.
  async function run() {
    error = "";
    busy = true;
    let done = 0;
    let first: string | null = null;
    try {
      // Attachments first, so that renamed ones can be pointed at.
      const renames: [string, string][] = [];
      if (mode === "import" && copyAttachments) {
        for (const [i, file] of attachments.entries()) {
          progress = `Copying attachments: ${i + 1}/${attachments.length}`;
          const path = await vault.addAttachment(file, file.name);
          const name = path.split("/").pop()!;
          if (name !== file.name) renames.push([file.name, name]);
        }
      }
      for (const [i, row] of todo.entries()) {
        progress = `${mode === "import" ? "Importing" : "Numbering"}: ${i + 1}/${todo.length}`;
        const target = targets.get(row.key);
        if (!target?.path) continue;
        if (mode === "import") {
          let text = row.text;
          for (const [from, to] of renames) text = renameAttachmentLinks(text, from, to);
          if (target.id) {
            const seq = Number(target.id.slice(-3));
            const note = assignId({ taxonomy: tax, path: join(folderOf(row), `${sanitizeTitle(row.title)}.md`), content: text, para: row.para, category: row.category, sub: row.sub, existingIds: [], moveToParaFolder: moveToPara, seq });
            await vault.create({ path: note.path, content: note.content });
            first ??= note.path;
          } else {
            await vault.create({ path: target.path, content: text });
            first ??= target.path;
          }
        } else {
          const seq = Number(target.id!.slice(-3));
          // Named after the title typed here, in the note's folder (or its PARA folder).
          const renamed = join(row.source.includes("/") ? row.source.slice(0, row.source.lastIndexOf("/")) : "", `${sanitizeTitle(row.title)}.md`);
          const note = assignId({ taxonomy: tax, path: renamed, content: vault.read(row.source), para: row.para, category: row.category, sub: row.sub, existingIds: [], moveToParaFolder: moveToPara, seq });
          const to = await vault.move(row.source, note.path, note.content);
          await onMoved(row.source, to);
          first ??= to;
        }
        done++;
      }
      const what = mode === "import" ? `Imported ${done} note${done === 1 ? "" : "s"}` : `Numbered ${done} note${done === 1 ? "" : "s"}`;
      const extra = mode === "import" && copyAttachments && attachments.length ? ` and ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}` : "";
      onDone(`${what}${extra}`, first);
    } catch (e) {
      error = `${(e as Error).message}${done ? ` (${done} done before this one)` : ""}`;
      busy = false;
      progress = "";
      // Rows already handled are not done twice.
      const handled = new Set(todo.slice(0, done).map((r) => r.key));
      rows = rows.filter((r) => !handled.has(r.key));
    }
  }

  const canPickFolder = platform() !== "android";
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && !busy && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && !busy && onClose()}>
  <div class="dialog" role="dialog" aria-label={mode === "import" ? "Import notes" : "Number notes"}>
    <header>
      <h2>{mode === "import" ? "📥 Import notes" : "🔢 Number notes without ID"}</h2>
      <button class="ghost" aria-label="Close" onclick={onClose} disabled={busy}>✕</button>
    </header>

    {#if paras.length === 0}
      <p>The vault has no taxonomy with Sub-PARAs yet, so notes cannot be numbered{mode === "import" ? " (they can still be imported into the Inbox)" : ""}.</p>
      <div class="actions">
        <button onclick={onSetupTaxonomy}>Set up the taxonomy</button>
      </div>
    {/if}

    {#if mode === "import"}
      <div class="pickers">
        <label class="pick">📄 Choose .md files…<input type="file" multiple accept=".md,.markdown,text/markdown,image/*,.pdf" onchange={pick} disabled={busy} /></label>
        {#if canPickFolder}
          <label class="pick">📁 Choose a folder…<input type="file" webkitdirectory multiple onchange={pick} disabled={busy} /></label>
        {/if}
      </div>
      {#if !picked}
        <p class="hint">
          The files are copied into the vault (the originals are not touched). Each note gets a suggested PARA, Category and Sub-PARA from your numbered notes
          closest to it; check them before importing. Images and PDFs chosen with the notes go to the attachments folder.
        </p>
      {/if}
    {:else if rows.length === 0}
      <p class="hint">Every note already has an ID (journal, templates, saved searches and system notes are left out).</p>
    {:else}
      <p class="hint">Notes without ID, outside the journal, templates and system folders. Suggestions come from your numbered notes closest to each one; nothing changes until you click Number.</p>
    {/if}

    {#if rows.length}
      {#if paras.length}
        <div class="bulk">
          <label class="check"><input type="checkbox" checked={selectedCount === rows.length} onchange={(e) => selectAll(e.currentTarget.checked)} /> All</label>
          <select bind:value={bulk.para} aria-label="PARA">{#each paras as p (p.code)}<option value={p.code}>{label(p.code, paras)}</option>{/each}</select>
          <select bind:value={bulk.category} aria-label="Category">{#each tax.categories as c (c.code)}<option value={c.code}>{label(c.code, tax.categories)}</option>{/each}</select>
          <select bind:value={bulk.sub} aria-label="Sub-PARA">{#each bulkSubs as s (s.code)}<option value={s.code}>{label(s.code, bulkSubs)}</option>{/each}</select>
          <button onclick={applyToSelected} disabled={!selectedCount || busy}>Apply to {selectedCount || "selected"}</button>
        </div>
      {/if}
      {#if refining}<p class="hint">✨ {refining}</p>{/if}

      <ul class="rows">
        {#each rows as row (row.key)}
          {@const t = targets.get(row.key)}
          {@const subs = tax.subParas[row.para] ?? []}
          <li class:skip={row.action === "skip"} class:bad={!!t?.error}>
            <div class="line">
              <input type="checkbox" bind:checked={row.selected} aria-label="Select" />
              <input class="title" bind:value={row.title} aria-label="Title" spellcheck="false" disabled={row.action === "skip"} />
              <select class="action" bind:value={row.action} aria-label="What to do">
                {#if paras.length}<option value="file">Number it</option>{/if}
                {#if mode === "import"}<option value="inbox">Inbox, no ID</option><option value="skip">Don't import</option>{:else}<option value="skip">Leave as is</option>{/if}
              </select>
            </div>
            {#if row.action === "file"}
              <div class="line filing">
                <select value={row.para} onchange={(e) => setPara(row, e.currentTarget.value)} aria-label="PARA">{#each paras as p (p.code)}<option value={p.code}>{label(p.code, paras)}</option>{/each}</select>
                <select bind:value={row.category} onchange={() => (row.touched = true)} aria-label="Category">{#each tax.categories as c (c.code)}<option value={c.code}>{label(c.code, tax.categories)}</option>{/each}</select>
                <select bind:value={row.sub} onchange={() => (row.touched = true)} aria-label="Sub-PARA">{#each subs as s (s.code)}<option value={s.code}>{label(s.code, subs)}</option>{/each}</select>
                <input class="num" bind:value={row.num} placeholder={t?.id?.slice(-3) ?? "auto"} inputmode="numeric" maxlength="3" aria-label="Number" />
              </div>
            {/if}
            <div class="meta">
              {#if row.action !== "skip"}
                {#if t?.error}<span class="error">⚠ {t.error}</span>{:else if t?.path}<span>→ <code>{t.path}</code></span>{/if}
              {/if}
              {#if row.suggestion}
                <span class="why" title={row.suggestion.basis.join("\n")}>
                  ✨ {row.touched ? "suggested" : "like"} {label(row.suggestion.para, paras)} · {label(row.suggestion.category, tax.categories)} · {label(row.suggestion.sub, tax.subParas[row.suggestion.para] ?? [])}
                  ({Math.round(row.suggestion.confidence * 100)}%{row.suggestion.confidence < STRONG ? ", weak: check it" : ""}, from {why(row.suggestion)})
                </span>
              {:else if !row.suggestion && row.action !== "skip" && paras.length}
                <span class="why">no close numbered note: choose by hand</span>
              {/if}
              {#if mode === "import" && row.source !== `${row.title}.md`}<span class="src">from {row.source}</span>{/if}
            </div>
          </li>
        {/each}
      </ul>

      <div class="options">
        {#if paras.length}<label class="check"><input type="checkbox" bind:checked={moveToPara} /> Put numbered notes in their PARA folder</label>{/if}
        {#if mode === "import" && attachments.length}
          <label class="check"><input type="checkbox" bind:checked={copyAttachments} /> Copy {attachments.length} attachment{attachments.length === 1 ? "" : "s"} (images, PDFs…) to <code>{vault.settings.attachments || "the vault root"}</code></label>
        {/if}
      </div>
    {/if}

    {#if error}<p class="error">⚠ {error}</p>{/if}
    {#if progress}<p class="hint">⏳ {progress}</p>{/if}
    <div class="actions">
      <button onclick={onClose} disabled={busy}>Cancel</button>
      <button class="primary" onclick={run} disabled={busy || !todo.length || problems > 0}>
        {mode === "import" ? `Import ${todo.length || ""}` : `Number ${todo.length || ""}`}
      </button>
    </div>
    {#if problems}<p class="hint right">{problems} note{problems === 1 ? "" : "s"} to fix first.</p>{/if}
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
    width: min(820px, 100%);
    max-height: 100%;
    padding: 18px;
    border-radius: 12px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 18px;
  }
  p {
    margin: 0;
    font-size: 13.5px;
  }
  .hint {
    color: var(--muted);
    font-size: 12.5px;
  }
  .right {
    text-align: right;
  }
  .error {
    color: var(--danger);
  }
  .ghost {
    border: none;
    background: none;
    color: var(--muted);
    font-size: 16px;
    cursor: pointer;
  }
  .pickers {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .pick {
    position: relative;
    padding: 8px 12px;
    border: 1px dashed var(--accent);
    border-radius: 6px;
    color: var(--accent-strong);
    font-size: 13.5px;
    cursor: pointer;
  }
  .pick input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .bulk,
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .bulk {
    padding: 8px;
    border-radius: 8px;
    background: var(--bg);
  }
  .bulk select,
  .filing select {
    flex: 1 1 120px;
    min-width: 0;
  }
  select,
  input.title,
  input.num,
  .bulk button,
  .actions button {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
  }
  .bulk button {
    border-color: var(--accent);
    color: var(--accent-strong);
    cursor: pointer;
  }
  .bulk button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  input.title {
    flex: 1 1 200px;
    min-width: 0;
    font-weight: 600;
  }
  select.action {
    flex: 0 0 auto;
  }
  input.num {
    width: 4.5em;
    font-family: var(--mono);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
    min-height: 0;
  }
  .rows li {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .rows li.skip {
    opacity: 0.6;
  }
  .rows li.bad {
    border-color: var(--danger);
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 12px;
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .meta code {
    color: var(--fg);
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  label.check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions button {
    padding: 8px 14px;
    background: transparent;
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
