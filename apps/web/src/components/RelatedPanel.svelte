<script lang="ts">
  import {
    addFrontmatterTags,
    buildKeywordIndex,
    keywordDocs,
    linkMention,
    mentionTargets,
    mergeRelated,
    noteChunks,
    notesWithoutLinks,
    relatedByKeywords,
    relatedByVectors,
    searchByKeywords,
    suggestTags,
    unlinkedMentions,
    type Mention,
  } from "@zeolite/core";
  import type { Vault } from "../lib/vault.svelte";
  import { ai, refreshIndex } from "../lib/ai-state.svelte";
  import { chat, hasServer, notePrompt, questionPrompt } from "../lib/ai";

  interface Props {
    vault: Vault;
    current: string | null;
    /** Text of the open note (with unsaved edits). */
    content: string;
    onOpen: (path: string) => void;
    /** Insert text at the cursor of the open note. */
    onInsert: (text: string) => void;
    /** Change the open note's text. */
    onEditCurrent: (next: string) => void;
    /** Render Markdown (AI answers). */
    render: (markdown: string) => string;
    onOpenSettings: () => void;
  }
  let { vault, current, content, onOpen, onInsert, onEditCurrent, render, onOpenSettings }: Props = $props();

  const label = (path: string) => path.split("/").pop()!.replace(/\.md$/i, "");
  const skip = (p: string) => p.startsWith("_system/") || p.startsWith(`${vault.settings.templatesFolder}/`);

  // Step 0: words, mentions, links.
  const notes = $derived(vault.notes.filter((r) => !r.conflict && !skip(r.path)));
  const keywords = $derived(buildKeywordIndex(keywordDocs(notes)));
  const targets = $derived(mentionTargets(notes, (p) => vault.linkText(p)));
  const record = $derived(current ? vault.records.get(current) : undefined);

  const linked = $derived(new Set((record?.links ?? []).map((l) => vault.resolveNote(l.target)).filter((p): p is string => !!p)));
  const mentions = $derived(current && content ? unlinkedMentions(content, current, targets, linked) : []);
  /** Other notes naming this one without a link. */
  const mentionedIn = $derived.by(() => {
    if (!current) return [];
    const self = targets.filter((t) => t.path === current);
    if (!self.length) return [];
    return notes
      .filter((r) => r.path !== current && !r.links.some((l) => vault.resolveNote(l.target) === current))
      .flatMap((r) => unlinkedMentions(vault.read(r.path), r.path, self, new Set()).map((m) => ({ path: r.path, m })))
      .slice(0, 12);
  });

  // Step 1: meaning (when enabled), merged with words.
  $effect(() => {
    void vault.records;
    if (ai.settings.embeddings !== "off") void refreshIndex(vault);
  });
  const related = $derived.by(() => {
    void ai.version;
    if (!current) return [];
    const words = relatedByKeywords(keywords, current, 15);
    const meaning = ai.index ? relatedByVectors(current, ai.index.entries, 15) : [];
    return mergeRelated(words, meaning, 10).filter((r) => !skip(r.path));
  });
  const duplicates = $derived.by(() => {
    void ai.version;
    if (!current || !ai.index) return [];
    return relatedByVectors(current, ai.index.entries, 3, 0.95);
  });
  const tags = $derived(record ? suggestTags(record.tags, related, (p) => vault.records.get(p)?.tags ?? []) : []);
  const orphans = $derived(notesWithoutLinks(notes, (t) => vault.resolveNote(t)));

  function linkHere(m: Mention) {
    onEditCurrent(linkMention(content, m, m.target.link));
  }
  async function linkThere(path: string, m: Mention) {
    await vault.save(path, linkMention(vault.read(path), m, vault.linkText(current!)));
  }

  // Search by meaning (words when no index).
  let query = $state("");
  let searching = $state(false);
  let found = $state<{ path: string; heading: string; score: number }[]>([]);
  async function search(e: SubmitEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    searching = true;
    try {
      if (ai.index) {
        await refreshIndex(vault);
        const hits = await ai.index.search(q, 20);
        const seen = new Set<string>();
        found = hits.filter((h) => !seen.has(h.path) && seen.add(h.path)).slice(0, 10).map((h) => ({ path: h.path, heading: h.heading, score: h.score }));
      } else {
        found = searchByKeywords(keywords, q, 10).map((r) => ({ path: r.path, heading: r.why.join(", "), score: r.score }));
      }
    } catch (err) {
      ai.error = (err as Error).message;
    }
    searching = false;
  }

  // Server model.
  let answer = $state("");
  let thinking = $state("");
  let question = $state("");
  async function run(action: "summary" | "review" | "actions") {
    if (!record) return;
    thinking = { summary: "Summarising…", review: "Reviewing…", actions: "Looking for actions…" }[action];
    answer = "";
    ai.error = "";
    try {
      answer = await chat(ai.settings, notePrompt(action, record.title, content));
    } catch (e) {
      ai.error = (e as Error).message;
    }
    thinking = "";
  }
  async function ask(e: SubmitEvent) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    thinking = "Searching your notes…";
    answer = "";
    ai.error = "";
    try {
      let sources: { path: string; title: string; heading: string; text: string }[];
      if (ai.index) {
        await refreshIndex(vault);
        const hits = await ai.index.search(q, 8);
        const chunks = new Map(notes.filter((r) => hits.some((h) => h.path === r.path)).flatMap((r) => noteChunks(r)).map((c) => [c.key, c]));
        sources = hits.map((h) => ({ path: h.path, title: label(h.path), heading: h.heading, text: chunks.get(h.key)?.text ?? "" })).filter((s) => s.text);
      } else {
        sources = searchByKeywords(keywords, q, 6).map((r) => ({ path: r.path, title: label(r.path), heading: "", text: (vault.records.get(r.path)?.body ?? "").slice(0, 2000) }));
      }
      if (!sources.length) {
        answer = "Nothing in your notes seems related to this question.";
      } else {
        thinking = "Asking the model…";
        const text = await chat(ai.settings, questionPrompt(q, sources));
        // Sources: [n] numbers as given to the model, grouped by note.
        const byNote = new Map<string, string[]>();
        sources.forEach((s, i) => byNote.set(s.path, [...(byNote.get(s.path) ?? []), `[${i + 1}]${s.heading ? ` ${s.heading}` : ""}`]));
        answer = `${text}\n\n---\nSources:\n${[...byNote].map(([p, refs]) => `- [[${vault.linkText(p)}]] — ${refs.join(", ")}`).join("\n")}`;
      }
    } catch (err) {
      ai.error = (err as Error).message;
    }
    thinking = "";
  }

  /** Links in AI answers open notes. */
  function clickAnswer(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const target = a.getAttribute("data-target") ?? a.getAttribute("data-href");
    if (target) {
      e.preventDefault();
      const p = vault.resolveNote(target);
      if (p) onOpen(p);
    }
  }
</script>

<div class="related">
  {#if !current}
    <p class="empty">Open a note to see its connections.</p>
  {:else}
    {#if mentions.length}
      <h4>Mentioned here, not linked ({mentions.length})</h4>
      {#each mentions as m (m.target.path)}
        <div class="row">
          <button class="name" onclick={() => onOpen(m.target.path)} title={m.target.path}>{m.text}</button>
          <button class="act" onclick={() => linkHere(m)} title="Turn this text into a link">🔗 Link</button>
        </div>
      {/each}
    {/if}

    {#if mentionedIn.length}
      <h4>Notes naming this one ({mentionedIn.length})</h4>
      {#each mentionedIn as { path, m } (path)}
        <div class="row">
          <button class="name" onclick={() => onOpen(path)} title={path}>{label(path)}</button>
          <button class="act" onclick={() => linkThere(path, m)} title="Link “{m.text}” in that note">🔗 Link</button>
        </div>
      {/each}
    {/if}

    <h4>Related notes</h4>
    {#each related as r (r.path)}
      <div class="row">
        <button class="name" onclick={() => onOpen(r.path)} title={r.path}>
          {label(r.path)}
          {#if r.why.length}<small>{r.why.join(" · ")}</small>{/if}
        </button>
        <span class="bar" title="{Math.round(r.score * 100)}%"><span style="width: {Math.round(Math.min(1, r.score) * 100)}%"></span></span>
        <button class="act" onclick={() => onInsert(`[[${vault.linkText(r.path)}]]`)} title="Insert a link at the cursor">＋</button>
      </div>
    {:else}
      <p class="empty">No related note found yet.</p>
    {/each}

    {#if duplicates.length}
      <h4>Possible duplicates</h4>
      {#each duplicates as d (d.path)}
        <div class="row"><button class="name warn" onclick={() => onOpen(d.path)}>⚠ {label(d.path)} <small>{Math.round(d.score * 100)}% alike</small></button></div>
      {/each}
    {/if}

    {#if tags.length}
      <h4>Suggested tags</h4>
      <div class="chips">
        {#each tags as t}<button onclick={() => onEditCurrent(addFrontmatterTags(content, [t]))} title="Add #{t} to this note">＋ #{t}</button>{/each}
      </div>
    {/if}
  {/if}

  <h4>Search by {ai.index ? "meaning" : "words"}</h4>
  <form class="search" onsubmit={search}>
    <input bind:value={query} placeholder={ai.index ? "e.g. supplier problems" : "Words"} />
    <button disabled={searching || !query.trim()}>🔍</button>
  </form>
  {#each found as f (f.path)}
    <button class="name hit" onclick={() => onOpen(f.path)}>{label(f.path)}{#if f.heading}<small>{f.heading}</small>{/if}</button>
  {/each}

  {#if hasServer(ai.settings)}
    <h4>AI ({ai.settings.chatModel})</h4>
    {#if current}
      <div class="chips">
        <button onclick={() => run("summary")} disabled={!!thinking}>Summarise</button>
        <button onclick={() => run("review")} disabled={!!thinking}>Review</button>
        <button onclick={() => run("actions")} disabled={!!thinking}>Find actions</button>
      </div>
    {/if}
    <form class="search" onsubmit={ask}>
      <input bind:value={question} placeholder="Ask your notes…" />
      <button disabled={!!thinking || !question.trim()}>➤</button>
    </form>
    {#if thinking}<p class="status">{thinking}</p>{/if}
    {#if answer}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="answer markdown" onclick={clickAnswer}>{@html render(answer)}</div>
      <div class="chips">
        {#if current}<button onclick={() => onInsert(`\n${answer}\n`)}>Insert in note</button>{/if}
        <button onclick={() => void navigator.clipboard?.writeText(answer)}>Copy</button>
        <button onclick={() => (answer = "")}>Clear</button>
      </div>
    {/if}
  {/if}

  {#if ai.status}<p class="status">⏳ {ai.status}</p>{/if}
  {#if ai.error}<p class="error">⚠ {ai.error}</p>{/if}
  <p class="foot">
    {#if ai.settings.embeddings === "off"}Meaning: off.{:else if ai.index}Meaning index: {(void ai.version, ai.index.size)} sections.{/if}
    {#if !hasServer(ai.settings)}No AI server.{/if}
    <button class="link" onclick={onOpenSettings}>⚙ AI settings</button>
  </p>

  <details>
    <summary>Notes with no links ({orphans.length})</summary>
    {#each orphans as p (p)}<button class="name hit" onclick={() => onOpen(p)}>{label(p)}</button>{/each}
  </details>
</div>

<style>
  .related {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  h4 {
    margin: 12px 0 4px;
    font-size: 11px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .row {
    display: flex;
    gap: 4px;
    align-items: center;
  }
  .name {
    flex: 1;
    min-width: 0;
    padding: 5px 6px;
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--fg);
    font: inherit;
    font-size: 13.5px;
    text-align: left;
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  .name:hover {
    background: var(--hover);
  }
  .name small {
    display: block;
    color: var(--muted);
    font-size: 11.5px;
  }
  .name.warn {
    color: var(--warn);
  }
  .hit {
    display: block;
    width: 100%;
  }
  .bar {
    flex: 0 0 34px;
    height: 4px;
    border-radius: 2px;
    background: var(--border);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .act,
  .chips button,
  .search button {
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--accent-strong);
    font: inherit;
    font-size: 12.5px;
    white-space: nowrap;
    cursor: pointer;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .search {
    display: flex;
    gap: 4px;
  }
  .search input {
    flex: 1;
    min-width: 0;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
  }
  .answer {
    margin: 6px 0;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg);
    font-size: 13.5px;
    overflow-wrap: anywhere;
  }
  .status,
  .empty,
  .foot {
    margin: 6px 0;
    color: var(--muted);
    font-size: 12.5px;
  }
  .error {
    margin: 6px 0;
    color: var(--danger);
    font-size: 12.5px;
  }
  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent-strong);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  details {
    margin-top: 10px;
    font-size: 13px;
  }
  summary {
    color: var(--muted);
    cursor: pointer;
  }
</style>
