<script lang="ts">
  import { sanitizeTitle } from "@zeolite/core";
  import type { Vault } from "../lib/vault.svelte";

  interface Props {
    vault: Vault;
    /** Open note: it can link to its own headings. */
    current: string | null;
    /** Selected text in the editor: it searches and becomes the displayed text. */
    selected: string;
    onInsert: (text: string) => void;
    onClose: () => void;
  }
  let { vault, current, selected, onInsert, onClose }: Props = $props();

  interface Choice {
    /** Vault path, or "" for a note that does not exist yet. */
    path: string;
    link: string;
    label: string;
    detail: string;
    kind: "note" | "self" | "image" | "file" | "new";
  }

  const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
  // svelte-ignore state_referenced_locally
  const initial = selected.trim().split("\n")[0]!.slice(0, 120);
  let query = $state(initial);
  let picked = $state<Choice | null>(null);
  let active = $state(0);
  let heading = $state("");
  // svelte-ignore state_referenced_locally
  let alias = $state(initial);
  let embed = $state(false);
  let list = $state<HTMLElement>();

  const all = $derived.by((): Choice[] => {
    const notes = vault.notes.map((r) => ({
      path: r.path,
      link: r.path === current ? "" : vault.linkText(r.path),
      label: r.path === current ? `${r.name} (this note)` : r.name,
      detail: [r.name.includes(r.title) ? "" : r.title, r.folder].filter(Boolean).join(" · "),
      kind: (r.path === current ? "self" : "note") as Choice["kind"],
    }));
    const files = vault.attachments().map((f) => ({
      path: f,
      link: vault.linkText(f),
      label: f.split("/").pop()!,
      detail: f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "attachment",
      kind: (IMAGE.test(f) ? "image" : "file") as Choice["kind"],
    }));
    return [...notes, ...files];
  });

  const matches = $derived.by((): Choice[] => {
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 60);
    const scored = all
      .map((c) => {
        const name = c.label.toLowerCase();
        const hay = `${c.path} ${c.detail}`.toLowerCase();
        const score = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : hay.includes(q) ? 3 : q.split(/\s+/).every((w) => hay.includes(w) || name.includes(w)) ? 4 : -1;
        return { c, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => a.score - b.score || a.c.label.localeCompare(b.c.label));
    const out = scored.slice(0, 60).map((x) => x.c);
    const title = sanitizeTitle(query);
    if (title && !all.some((c) => c.label.toLowerCase() === title.toLowerCase() && c.kind === "note")) {
      out.push({ path: "", link: title, label: title, detail: "new note, created when you click the link", kind: "new" });
    }
    return out;
  });

  $effect(() => {
    void query;
    active = 0;
  });

  const headings = $derived(picked && (picked.kind === "note" || picked.kind === "self") ? (vault.records.get(picked.path)?.headings ?? []) : []);
  // Characters Obsidian cannot keep in a link's heading part.
  const cleanHeading = (h: string) => h.replace(/[#|^[\]]/g, " ").replace(/\s+/g, " ").trim();
  const cleanAlias = (a: string) => a.replace(/[|\]\n]/g, " ").trim();

  const result = $derived.by(() => {
    if (!picked) return "";
    const h = heading ? `#${cleanHeading(heading)}` : "";
    const target = `${picked.link}${h}`;
    if (!target) return "";
    const a = cleanAlias(alias);
    const shown = embed || !a || a === picked.link || a === target ? "" : `|${a}`;
    return `${embed ? "!" : ""}[[${target}${shown}]]`;
  });

  const explain = $derived.by(() => {
    if (!picked) return "";
    const what = picked.kind === "new" ? `a new note “${picked.link}” (it is created when you first click the link)` : picked.kind === "self" ? "a heading of this note" : `“${picked.label}”`;
    if (embed) return picked.kind === "image" ? "Shows the image in the note." : `Shows the content of ${what}${heading ? `, section “${heading}”` : ""} inside this note.`;
    const a = cleanAlias(alias);
    return `Links to ${what}${heading ? `, at “${heading}”` : ""}${a && a !== picked.link ? `, displayed as “${a}”` : ""}.`;
  });

  function pick(c: Choice) {
    picked = c;
    heading = "";
    embed = c.kind === "image";
  }

  function keydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = matches.length;
      if (!n) return;
      active = (active + (e.key === "ArrowDown" ? 1 : n - 1)) % n;
      list?.querySelectorAll("li")[active]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = matches[active];
      if (c) pick(c);
    }
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (result) onInsert(result);
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && (picked ? (picked = null) : onClose())} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <form class="dialog" onsubmit={submit}>
    <h2>Insert a link</h2>

    {#if !picked}
      <label for="ld-q">1. Find the note, image or file to link to</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="ld-q" bind:value={query} onkeydown={keydown} autofocus autocomplete="off" placeholder="Name, title, ID or folder…" />
      <ul class="results" bind:this={list} role="listbox" aria-label="Matching notes">
        {#each matches as c, i}
          <li role="option" aria-selected={i === active}>
            <button type="button" class:active={i === active} class:new={c.kind === "new"} onclick={() => pick(c)} onmouseenter={() => (active = i)}>
              <span class="icon">{c.kind === "new" ? "＋" : c.kind === "image" ? "🖼" : c.kind === "file" ? "📎" : "📝"}</span>
              <span class="name">{c.kind === "new" ? `Link to a new note “${c.label}”` : c.label}</span>
              {#if c.detail}<span class="detail">{c.detail}</span>{/if}
            </button>
          </li>
        {:else}
          <li class="none">Type a name to search the vault.</li>
        {/each}
      </ul>
      <p class="hint">↑ ↓ to choose, Enter to select. Tip: typing <code>[[</code> in the editor suggests notes too.</p>
    {:else}
      <div class="picked">
        <span class="icon">{picked.kind === "new" ? "＋" : picked.kind === "image" ? "🖼" : picked.kind === "file" ? "📎" : "📝"}</span>
        <span class="name">{picked.label}</span>
        <button type="button" class="change" onclick={() => (picked = null)}>Change</button>
      </div>
      <p class="step">2. Options (all optional)</p>
      {#if headings.length}
        <label>Go to a heading
          <select bind:value={heading}>
            {#if picked.kind !== "self"}<option value="">(top of the note)</option>{:else}<option value="" disabled>Choose a heading…</option>{/if}
            {#each headings as h}<option value={h.text}>{"  ".repeat(h.level - 1)}{h.text}</option>{/each}
          </select>
        </label>
      {:else if picked.kind === "self"}
        <p class="error">This note has no headings to link to yet.</p>
      {/if}
      {#if picked.kind !== "self"}
        <label class="check">
          <input type="checkbox" bind:checked={embed} />
          {picked.kind === "image" ? "Show the image (embed)" : "Embed: show its content here instead of a link"}
        </label>
      {/if}
      {#if !embed}
        <label>Text shown in the note
          <input bind:value={alias} placeholder={heading || picked.link || "(the note name)"} autocomplete="off" />
        </label>
      {/if}
      <div class="result">
        <code>{result || "…"}</code>
        <span>{explain}</span>
      </div>
    {/if}

    <details class="help">
      <summary>How wiki links work</summary>
      <table>
        <tbody>
          <tr><td><code>[[Note]]</code></td><td>link to a note, by its file name (without <code>.md</code>)</td></tr>
          <tr><td><code>[[Note#Heading]]</code></td><td>link to a heading in that note</td></tr>
          <tr><td><code>[[#Heading]]</code></td><td>link to a heading in the same note</td></tr>
          <tr><td><code>[[Note|text]]</code></td><td>show “text” instead of the note name</td></tr>
          <tr><td><code>![[image.png]]</code></td><td>show an image (paste or drop an image to add one)</td></tr>
          <tr><td><code>![[Note]]</code></td><td>embed another note's content</td></tr>
          <tr><td><code>[[Folder/Note]]</code></td><td>needed only when two notes have the same name</td></tr>
        </tbody>
      </table>
      <p>
        A link to a note that does not exist yet is shown in grey; clicking it creates the note. Links follow renamed and moved
        notes automatically, and links are compatible with Obsidian. Shortcut: <kbd>Ctrl</kbd>+<kbd>K</kbd>.
      </p>
    </details>

    <div class="actions">
      <button type="button" onclick={onClose}>Cancel</button>
      <button type="submit" class="primary" disabled={!result}>Insert link</button>
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
    width: min(560px, 100%);
    max-height: calc(100vh - 32px);
    overflow: auto;
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
  label,
  .step {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    font-size: 13px;
    color: var(--muted);
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--fg);
  }
  input:not([type="checkbox"]),
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
  .results {
    max-height: 260px;
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .results button {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 14px;
    text-align: left;
    cursor: pointer;
  }
  .results button.active {
    background: var(--accent-soft);
  }
  .results button.new .name {
    color: var(--accent-strong);
  }
  .name {
    overflow-wrap: anywhere;
  }
  .detail {
    margin-left: auto;
    color: var(--muted);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 45%;
  }
  .none {
    padding: 8px 10px;
    color: var(--muted);
    font-size: 13px;
  }
  .picked {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--accent-soft);
    font-weight: 600;
  }
  .change {
    margin-left: auto;
    padding: 3px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--panel);
    color: var(--fg);
    font: inherit;
    font-size: 12.5px;
    font-weight: 400;
    cursor: pointer;
  }
  .result {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    border-radius: 6px;
    background: var(--bg);
    font-size: 13px;
  }
  .result code {
    font-family: var(--mono);
    font-size: 14px;
    color: var(--accent-strong);
    overflow-wrap: anywhere;
  }
  .result span {
    color: var(--muted);
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 12.5px;
  }
  .help {
    font-size: 13px;
  }
  .help summary {
    color: var(--accent-strong);
    cursor: pointer;
  }
  .help table {
    margin: 8px 0;
    border-collapse: collapse;
  }
  .help td {
    padding: 3px 8px 3px 0;
    vertical-align: top;
  }
  .help td:first-child {
    white-space: nowrap;
  }
  .help p {
    margin: 0;
    color: var(--muted);
  }
  .error {
    margin: 0;
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
