<script lang="ts">
  import {
    createFreeNote,
    createInboxNote,
    createJournalNote,
    createFromTemplate,
    createParaNote,
    findCategory,
    findPara,
    findSubPara,
    idPrefix,
    parseId,
    templateName,
    nextId,
    numberablePara,
    type JournalSettings,
    type NewNote,
    type Taxonomy,
  } from "@zeolite/core";

  interface Props {
    taxonomy: Taxonomy;
    /** Folder of Inbox notes (vault setting). */
    inboxFolder?: string;
    /** Existing folders, suggested for free notes. */
    folders?: string[];
    existingIds: string[];
    templates: string[];
    /** Daily notes folder and format (from Obsidian's settings). */
    journal?: JournalSettings;
    readTemplate: (path: string) => string;
    onCreate: (note: NewNote, cursor: number | null) => void;
    onClose: () => void;
  }
  let { taxonomy, existingIds, templates, readTemplate, journal, folders = [], inboxFolder = "Inbox", onCreate, onClose }: Props = $props();
  let template = $state("");
  let templateTouched = $state(false);

  type Kind = "para" | "journal" | "inbox" | "free";
  let kind = $state<Kind>("para");
  let title = $state("");
  let folder = $state("");
  const paras = $derived(numberablePara(taxonomy));
  let para = $state("");
  let sub = $state("");
  let category = $state("");
  let error = $state("");

  $effect(() => {
    if (!para && paras[0]) para = paras[0].code;
  });
  const subs = $derived(taxonomy.subParas[para] ?? []);
  $effect(() => {
    if (!subs.some((s) => s.code === sub)) sub = subs[0]?.code ?? "";
  });
  $effect(() => {
    if (!category && taxonomy.categories[0]) category = taxonomy.categories[0].code;
  });

  // Last template used per note type (per device).
  const LAST_KEY = "zeolite.lastTemplate";
  function lastTemplates(): Record<string, string> {
    try {
      return JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}");
    } catch {
      return {};
    }
  }
  function rememberTemplate(k: Kind, path: string) {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ ...lastTemplates(), [k]: path }));
    } catch {
      // Not remembered (storage blocked); the suggestion still works.
    }
  }

  /**
   * Proposed template: one named after the Sub-PARA or PARA (PARA notes),
   * else the last one used for this note type, else one named after the type.
   */
  const suggested = $derived.by(() => {
    const byName = (names: (string | undefined)[]) => {
      const wanted = names.filter((x): x is string => !!x).map((x) => x.toLowerCase());
      return templates.find((t) => wanted.includes(templateName(t).toLowerCase()));
    };
    const taxonomyMatch = kind === "para" ? byName([findSubPara(taxonomy, para, sub)?.tag, findPara(taxonomy, para)?.tag]) : undefined;
    const last = lastTemplates()[kind];
    const typeNames: Record<Kind, string[]> = {
      para: ["PARA", "PARA note"],
      journal: ["Journal", "Daily", "Daily note"],
      inbox: ["Inbox"],
      free: ["Free", "Free note", "Note", "Default"],
    };
    return taxonomyMatch ?? (last && templates.includes(last) ? last : undefined) ?? byName(typeNames[kind]) ?? "";
  });
  $effect(() => {
    if (!templateTouched) template = suggested;
  });

  const previewId = $derived.by(() => {
    if (kind !== "para" || !para || !sub || !category) return "";
    try {
      return nextId(para, category, sub, existingIds);
    } catch (e) {
      return `⚠ ${(e as Error).message}`;
    }
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    error = "";
    try {
      let note: NewNote;
      if (kind === "para") note = createParaNote({ taxonomy, para, category, sub, title, existingIds });
      else if (kind === "journal") note = createJournalNote(new Date(), journal);
      else if (kind === "inbox") note = createInboxNote(title, new Date(), inboxFolder);
      else note = createFreeNote(folder, title);
      let cursor: number | null = null;
      if (template) {
        const id = note.id ? parseId(note.id) : null;
        const applied = createFromTemplate(note, readTemplate(template), {
          title: note.path.split("/").pop()!.replace(/\.md$/, "").replace(/^\d{2}\.\d{2}\.\d{2}\.\d{3} /, ""),
          id: note.id,
          para: id ? findPara(taxonomy, id.para)?.tag : undefined,
          category: id ? findCategory(taxonomy, id.category)?.tag : undefined,
          subpara: id ? findSubPara(taxonomy, id.para, id.sub)?.tag : undefined,
        });
        note = applied;
        cursor = applied.cursor;
      }
      rememberTemplate(kind, template);
      onCreate(note, cursor);
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <form class="dialog" onsubmit={submit}>
    <h2>New note</h2>
    <div class="kinds" role="radiogroup">
      {#each [["para", "PARA note"], ["journal", "Journal"], ["inbox", "Inbox"], ["free", "Free note"]] as [k, label]}
        <label class:active={kind === k}><input type="radio" bind:group={kind} value={k} onchange={() => (templateTouched = false)} />{label}</label>
      {/each}
    </div>

    {#if templates.length}
      <div class="tpl" role="radiogroup" aria-label="Template">
        <span class="lbl">Template</span>
        <div class="tpl-list">
          {#each ["", ...templates] as t}
            <button
              type="button"
              role="radio"
              aria-checked={template === t}
              class:active={template === t}
              onclick={() => ((template = t), (templateTouched = true))}
            >
              {t ? templateName(t) : "None"}{#if t && t === suggested}<small>suggested</small>{/if}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#if kind === "para"}
      {#if paras.length === 0}
        <p class="warn">The taxonomy note (_system/Taxonomy.md) defines no PARA with Sub-PARAs.</p>
      {:else}
        <label>PARA
          <select bind:value={para}>
            {#each paras as p}<option value={p.code}>{p.code} · #{p.tag}</option>{/each}
          </select>
        </label>
        <label>Category
          <select bind:value={category}>
            {#each taxonomy.categories as c}<option value={c.code}>{c.code} · #{c.tag}</option>{/each}
          </select>
        </label>
        <label>Sub-PARA
          <select bind:value={sub}>
            {#each subs as s}<option value={s.code}>{s.code} · #{s.tag}</option>{/each}
          </select>
        </label>
        <div class="id">ID <code>{previewId}</code> <small>prefix {idPrefix(para, category, sub)}</small></div>
      {/if}
    {/if}

    {#if kind === "free"}
      <label>Folder <input bind:value={folder} placeholder="(vault root)" list="nn-folders" /></label>
      <datalist id="nn-folders">{#each folders as f}<option value={f}></option>{/each}</datalist>
    {/if}

    {#if kind !== "journal"}
      <!-- svelte-ignore a11y_autofocus -->
      <label>Title <input bind:value={title} autofocus placeholder="Note title" /></label>
    {:else}
      <p class="hint">Opens or creates today's journal note{journal ? ` in ${journal.folder || "the vault root"}` : ""}.</p>
    {/if}


    {#if error}<p class="warn">{error}</p>{/if}
    <div class="actions">
      <button type="button" onclick={onClose}>Cancel</button>
      <button type="submit" class="primary">Create</button>
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
    gap: 12px;
    width: min(460px, 100%);
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
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13px;
    color: var(--muted);
  }
  input:not([type="radio"]),
  select {
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 14px;
  }
  .kinds {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .kinds label {
    align-items: center;
    padding: 8px 4px;
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--fg);
    cursor: pointer;
    text-align: center;
  }
  .kinds label.active {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .kinds input {
    display: none;
  }
  .tpl {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .lbl {
    font-size: 13px;
    color: var(--muted);
  }
  .tpl-list {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tpl-list button {
    display: inline-flex;
    gap: 6px;
    align-items: baseline;
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }
  .tpl-list button.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .tpl-list small {
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 400;
  }
  .id code {
    font-size: 16px;
    font-weight: 700;
    color: var(--accent-strong);
  }
  .id small,
  .hint {
    color: var(--muted);
  }
  .warn {
    color: var(--danger);
    margin: 0;
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
</style>
