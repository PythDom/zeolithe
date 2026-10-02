<script lang="ts">
  import type { Instrument, NoteRecord } from "@zeolite/core";
  import { exportPdf, type PdfNote, type PdfOptions } from "../lib/pdf";
  import type { Vault } from "../lib/vault.svelte";

  interface Props {
    vault: Vault;
    /** The open note (with unsaved edits already flushed). */
    current: string;
    /** Chord sheets as shown on screen, so the PDF matches. */
    chords?: { transpose(path: string, block: number): number; variant(symbol: string, instrument: Instrument): number; diagrams: boolean };
    onSaved: (path: string) => void;
    onClose: () => void;
  }
  let { vault, current, chords, onSaved, onClose }: Props = $props();

  const record = $derived(vault.records.get(current));
  const folder = $derived(record?.folder ?? "");
  const folderNotes = $derived(
    vault.notes
      .filter((r) => r.folder === folder)
      .sort((a, b) => (a.id ?? a.name).localeCompare(b.id ?? b.name)),
  );

  let scope = $state<"note" | "folder">("note");
  let opts = $state<PdfOptions>({ pageSize: "A4", properties: true, toc: false });
  let busy = $state(false);
  let error = $state("");
  let result = $state<{ blob: Blob; url: string; name: string } | null>(null);

  const toPdfNote = (r: NoteRecord): PdfNote => ({
    path: r.path,
    title: r.title,
    markdown: vault.read(r.path),
    id: r.id,
    tags: r.tags,
    created: r.created,
  });

  const fileName = $derived(
    (scope === "note" ? (record?.name ?? "note") : folder.split("/").pop() || "notes").replace(/[\\/:*?"<>|]/g, "-") + ".pdf",
  );

  async function build() {
    error = "";
    busy = true;
    if (result) URL.revokeObjectURL(result.url);
    result = null;
    try {
      const notes = scope === "note" ? (record ? [record] : []) : folderNotes;
      const blob = await exportPdf(notes.map(toPdfNote), {
        readAsset: (t) => vault.readAsset(t),
        runQuery: (src, path) => vault.runQuery(src, path),
        chords,
      }, $state.snapshot(opts));
      result = { blob, url: URL.createObjectURL(blob), name: fileName };
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function saveToVault() {
    if (!result) return;
    const path = await vault.writeFile(`exports/${result.name}`, result.blob);
    onSaved(path);
  }

  const size = (b: Blob) => (b.size > 1e6 ? `${(b.size / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b.size / 1e3))} KB`);
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="dialog" role="dialog" aria-label="Export to PDF">
    <header>
      <h2>Export to PDF</h2>
      <button class="ghost" aria-label="Close" onclick={onClose}>✕</button>
    </header>
    <div class="body">
      <fieldset>
        <legend>What</legend>
        <label class="radio"><input type="radio" bind:group={scope} value="note" onchange={() => (result = null)} /> This note <span>{record?.name}</span></label>
        <label class="radio"><input type="radio" bind:group={scope} value="folder" onchange={() => (result = null)} /> All notes in <b>{folder || "the vault root"}</b> <span>{folderNotes.length} notes, one per page, in ID order</span></label>
      </fieldset>
      <fieldset>
        <legend>Layout</legend>
        <div class="row">
          <label>Page size
            <select bind:value={opts.pageSize} onchange={() => (result = null)}>
              <option value="A4">A4</option>
              <option value="LETTER">US Letter</option>
            </select>
          </label>
          <label class="check"><input type="checkbox" bind:checked={opts.properties} onchange={() => (result = null)} /> ID, tags and date under the title</label>
          <label class="check"><input type="checkbox" bind:checked={opts.toc} onchange={() => (result = null)} /> Table of contents (when the note has none)</label>
        </div>
      </fieldset>
      <p class="hint">Text stays selectable; the table of contents links to its pages; Dataview blocks show their current results; chord sheets keep their chords aligned, with diagrams and the transposition shown on screen.</p>
      {#if error}<p class="error">{error}</p>{/if}
      {#if result}
        <p class="ok">✓ {result.name} · {size(result.blob)}</p>
      {/if}
    </div>
    <footer>
      {#if !result}
        <button class="primary" disabled={busy} onclick={build}>{busy ? "Creating PDF…" : "Create PDF"}</button>
      {:else}
        <button onclick={saveToVault} title="Saves into exports/ in the vault (works on every device)">Save to vault</button>
        <a class="primary" href={result.url} download={result.name}>Download</a>
      {/if}
    </footer>
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
    width: min(520px, 100%);
    max-height: 100%;
    border-radius: 12px;
    background: var(--panel);
    color: var(--fg);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.3);
    overflow: hidden;
  }
  header,
  footer {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 12px 16px;
  }
  header {
    border-bottom: 1px solid var(--border);
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
    padding: 12px 16px;
    overflow: auto;
  }
  fieldset {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    border: none;
  }
  legend {
    padding-bottom: 4px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .radio,
  .check {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    font-size: 14px;
  }
  .radio span {
    flex-basis: 100%;
    padding-left: 22px;
    color: var(--muted);
    font-size: 12.5px;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row > label:not(.check) {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 14px;
  }
  select {
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 12.5px;
  }
  .error {
    margin: 0;
    color: var(--danger);
  }
  .ok {
    margin: 0;
    color: var(--ok);
  }
  footer button,
  footer a,
  .ghost {
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 14px;
    text-decoration: none;
    cursor: pointer;
  }
  .ghost {
    padding: 4px 9px;
  }
  .primary {
    border-color: var(--accent) !important;
    background: var(--accent) !important;
    color: var(--on-accent) !important;
    font-weight: 600;
  }
  .primary:disabled {
    opacity: 0.6;
  }
</style>
