<script lang="ts">
  /**
   * Sync conflict copies, sorted out in one place: the copies that only differ
   * from their note invisibly (line endings, spaces at line ends…) can all be
   * deleted at once; for the others, the differences are shown and one click
   * keeps the note or the copy, or the most recent of the two. Deleted copies
   * go to .trash.
   */
  import { lineDiff, normaliseText, type DiffLine } from "@zeolite/core";
  import { untrack } from "svelte";
  import { CONFLICT_INFO_PATH, readConflictInfo } from "../lib/sync";
  import type { Vault } from "../lib/vault.svelte";

  interface Props {
    vault: Vault;
    onOpen: (path: string) => void;
    /** After changes: what was done (the app refreshes the open note). */
    onDone: (summary: string) => void;
    onClose: () => void;
  }
  let { vault, onOpen, onDone, onClose }: Props = $props();

  interface Item {
    copy: string;
    original: string | null;
    /** The note exists and has the same text apart from invisible differences. */
    same: boolean;
  }

  const label = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");
  /** When the copy was made, from its name (…sync-conflict-20261014-174501-…). */
  const when = (p: string) => {
    const m = /sync-conflict-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(p);
    return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : "";
  };

  function scan(): Item[] {
    return vault.conflicts.map((c) => {
      const original = vault.conflictOf(c.path);
      const exists = !!original && vault.exists(original);
      const same = exists && normaliseText(vault.read(c.path)) === normaliseText(vault.read(original!));
      return { copy: c.path, original: exists ? original : original ?? null, same };
    });
  }
  let items = $state<Item[]>(untrack(scan));
  const identical = $derived(items.filter((i) => i.same));
  const real = $derived(items.filter((i) => !i.same));

  /**
   * When each version was last modified: the note from the file, the copy from
   * what the sync recorded on the other device (Zeolite's copies), else from
   * the copy's file (Syncthing keeps the other version's date on it).
   */
  let times = $state<Record<string, { note?: number; copy?: number }>>({});
  async function loadTimes() {
    const info = await readConflictInfo(vault.storage);
    const stat = async (p: string) => {
      try {
        return (await vault.storage.stat?.(p))?.mtime || undefined;
      } catch {
        return undefined;
      }
    };
    const next: typeof times = {};
    for (const i of items) {
      if (i.same || !i.original || !vault.exists(i.original)) continue;
      next[i.copy] = { note: await stat(i.original), copy: info[i.copy] ?? (await stat(i.copy)) };
    }
    times = next;
  }
  void loadTimes();
  /** Which version is newer, when both dates are known and differ by more than a minute. */
  const newer = (i: Item): "note" | "copy" | null => {
    const t = times[i.copy];
    if (!t?.note || !t.copy || Math.abs(t.note - t.copy) < 60_000) return null;
    return t.note > t.copy ? "note" : "copy";
  };
  const withNewer = $derived(real.filter((i) => newer(i)));
  const fmt = (ms?: number) => {
    if (!ms) return "?";
    const d = new Date(ms);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  let open = $state<string | null>(null);
  let busy = $state(false);
  let error = $state("");
  let done = 0;

  /** Differences note → copy, with long unchanged stretches folded. */
  function diffOf(item: Item): (DiffLine | { kind: "fold"; text: string })[] {
    const lines = lineDiff(item.original && vault.exists(item.original) ? vault.read(item.original) : "", vault.read(item.copy));
    const out: (DiffLine | { kind: "fold"; text: string })[] = [];
    const near = (i: number) => lines.slice(Math.max(0, i - 2), i + 3).some((l) => l.kind !== "same");
    let folded = 0;
    lines.forEach((l, i) => {
      if (l.kind !== "same" || near(i)) {
        if (folded) out.push({ kind: "fold", text: `… ${folded} unchanged line${folded > 1 ? "s" : ""}` });
        folded = 0;
        out.push(l);
      } else folded++;
    });
    if (folded) out.push({ kind: "fold", text: `… ${folded} unchanged line${folded > 1 ? "s" : ""}` });
    return out;
  }

  async function run(fn: () => Promise<void>) {
    busy = true;
    error = "";
    try {
      await fn();
    } catch (e) {
      error = (e as Error).message;
    }
    busy = false;
    items = scan();
    // Forget the dates of copies that are gone.
    try {
      const info = await readConflictInfo(vault.storage);
      const kept = Object.fromEntries(Object.entries(info).filter(([p]) => vault.exists(p)));
      if (Object.keys(kept).length !== Object.keys(info).length) await vault.storage.writeText(CONFLICT_INFO_PATH, JSON.stringify(kept, null, 1));
    } catch {
      // Kept as it was.
    }
  }

  const deleteIdentical = () =>
    run(async () => {
      for (const i of identical) {
        await vault.trash(i.copy);
        done++;
      }
    });

  /** Keep the note as it is: the copy goes to .trash. */
  async function doKeepNote(i: Item) {
    await vault.trash(i.copy);
    done++;
  }
  /** Keep the copy: the note goes to .trash (nothing is lost) and the copy takes its place. */
  async function doKeepCopy(i: Item) {
    if (!i.original) return;
    const text = vault.read(i.copy);
    if (vault.exists(i.original)) await vault.trash(i.original);
    await vault.move(i.copy, i.original, text);
    done++;
  }
  const keepNote = (i: Item) => run(() => doKeepNote(i));
  const keepCopy = (i: Item) => run(() => doKeepCopy(i));
  const keepNewer = (i: Item) => run(() => (newer(i) === "copy" ? doKeepCopy(i) : doKeepNote(i)));
  /** For every conflict whose dates are known: keep the most recent version. */
  const keepAllNewer = () =>
    run(async () => {
      for (const i of withNewer) await (newer(i) === "copy" ? doKeepCopy(i) : doKeepNote(i));
    });

  function close() {
    if (done) onDone(`${done} conflict cop${done > 1 ? "ies" : "y"} sorted out (deleted copies are in .trash)`);
    else onClose();
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && !busy && close()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && !busy && close()}>
  <div class="dialog" role="dialog" aria-label="Sync conflicts">
    <header>
      <h2>⇄ Sync conflicts</h2>
      <button class="ghost" aria-label="Close" onclick={close} disabled={busy}>✕</button>
    </header>

    {#if !items.length}
      <p>No conflict copies left.</p>
    {/if}

    {#if identical.length}
      <section class="same">
        <p>
          <b>{identical.length} cop{identical.length > 1 ? "ies are" : "y is"} the same as {identical.length > 1 ? "their notes" : "its note"}</b>, apart from invisible
          differences (line endings, spaces at line ends, a last empty line). Nothing would be lost.
        </p>
        <button class="primary" onclick={deleteIdentical} disabled={busy}>Delete these {identical.length} copies</button>
      </section>
    {/if}

    {#if real.length}
      <p class="hint">
        {real.length} cop{real.length > 1 ? "ies differ" : "y differs"} from {real.length > 1 ? "their notes" : "its note"}. <b>Keep the note</b> deletes the copy;
        <b>Keep the copy</b> puts it in the note's place (the note goes to .trash); <b>Keep the most recent</b> does whichever was modified last.
        To combine both, open them and merge by hand.
      </p>
      {#if withNewer.length > 1}
        <section class="same">
          <p>For {withNewer.length} of them the dates tell which version was modified last.</p>
          <button class="primary" onclick={keepAllNewer} disabled={busy}>Keep the most recent of each ({withNewer.length})</button>
        </section>
      {/if}
      <ul>
        {#each real as i (i.copy)}
          <li>
            <div class="line">
              <span class="name">{i.original ? label(i.original) : label(i.copy)}</span>
              <span class="when">{i.original && vault.exists(i.original) ? `copy of ${when(i.copy)}` : "the note itself is gone"}</span>
            </div>
            {#if times[i.copy]}
              {@const n = newer(i)}
              <div class="dates">
                Note modified <b class:newer={n === "note"}>{fmt(times[i.copy]?.note)}</b>{n === "note" ? " (newer)" : ""} · other version modified
                <b class:newer={n === "copy"}>{fmt(times[i.copy]?.copy)}</b>{n === "copy" ? " (newer)" : ""}
              </div>
            {/if}
            <div class="buttons">
              <button onclick={() => (open = open === i.copy ? null : i.copy)}>{open === i.copy ? "Hide" : "Show"} differences</button>
              {#if i.original && vault.exists(i.original)}
                {#if newer(i)}<button class="primary" onclick={() => keepNewer(i)} disabled={busy} title="Keep the version modified last">Keep the most recent ({newer(i) === "copy" ? "the copy" : "the note"})</button>{/if}
                <button onclick={() => keepNote(i)} disabled={busy}>Keep the note</button>
                <button onclick={() => keepCopy(i)} disabled={busy}>Keep the copy</button>
                <button class="link" onclick={() => onOpen(i.original!)}>Open note</button>
              {:else if i.original}
                <button onclick={() => keepCopy(i)} disabled={busy}>Make it the note again</button>
              {/if}
              <button class="link" onclick={() => onOpen(i.copy)}>Open copy</button>
            </div>
            {#if open === i.copy}
              <pre class="diff">{#each diffOf(i) as l}<span class="d-{l.kind}">{l.kind === "removed" ? "− " : l.kind === "added" ? "+ " : "  "}{l.text}
</span>{/each}</pre>
              <p class="hint">− only in the note · + only in the copy</p>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if error}<p class="error">⚠ {error}</p>{/if}
    <div class="actions">
      <button onclick={close} disabled={busy}>Close</button>
    </div>
  </div>
</div>

<style>
  .dates {
    color: var(--muted);
    font-size: 12.5px;
  }
  .dates b {
    font-weight: 500;
  }
  .dates b.newer {
    color: var(--accent-strong);
    font-weight: 700;
  }
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
    width: min(760px, 100%);
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
  .same {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border-radius: 8px;
    background: var(--accent-soft);
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
    min-height: 0;
  }
  li {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    align-items: baseline;
  }
  .name {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .when {
    color: var(--muted);
    font-size: 12px;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  button {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--on-accent);
  }
  button.link {
    border: none;
    background: none;
    color: var(--accent-strong);
  }
  .diff {
    max-height: 320px;
    margin: 0;
    padding: 8px;
    overflow: auto;
    border-radius: 6px;
    background: var(--bg);
    font-family: var(--mono);
    font-size: 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .diff .d-removed {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
  }
  .diff .d-added {
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .diff .d-fold {
    color: var(--muted);
    font-style: italic;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
  }
</style>
