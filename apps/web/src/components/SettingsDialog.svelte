<script lang="ts">
  import { editTaxonomyNote, formatDate, setParaFolder, TAXONOMY_PATH, type VaultSettings } from "@zeolite/core";
  import { untrack } from "svelte";
  import { prefs, savePrefs, type Prefs } from "../lib/features.svelte";
  import type { Vault } from "../lib/vault.svelte";
  import { ai as aiState, setAiSettings } from "../lib/ai-state.svelte";
  import { DEFAULT_DEVICE_MODEL, DEVICE_MODELS, testServer, type AiSettings } from "../lib/ai";

  interface Props {
    vault: Vault;
    /** Sync settings can be opened from here (not for the demo vault). */
    onOpenSync?: () => void;
    onSetupTaxonomy: () => void;
    onSaved: (message: string) => void;
    onClose: () => void;
  }
  let { vault, onOpenSync, onSetupTaxonomy, onSaved, onClose }: Props = $props();

  // --- This vault -----------------------------------------------------------
  const start: VaultSettings = untrack(() => structuredClone($state.snapshot(vault.settings)) as VaultSettings);
  type AttachMode = "folder" | "root" | "same" | "sub";
  const a0 = start.attachments;
  let attachMode = $state<AttachMode>(a0 === "" ? "root" : a0 === "./" ? "same" : a0.startsWith("./") ? "sub" : "folder");
  let attachFolder = $state(a0.startsWith("./") ? a0.slice(2) || "attachments" : a0 || "attachments");
  let templatesFolder = $state(start.templatesFolder);
  let journalFolder = $state(start.journal.folder);
  let journalFormat = $state(start.journal.format);
  let journalTemplate = $state(start.journal.template ?? "");
  let inboxFolder = $state(start.inboxFolder);
  let searchesFolder = $state(start.searchesFolder);
  let exportsFolder = $state(start.exportsFolder);
  let oneOnOneCode = $state(start.oneOnOneCode);
  let people = $state(start.people.map((p) => ({ name: p.name, email: p.email ?? "" })));

  const paras = untrack(() => vault.taxonomy.paras.map((p) => ({ code: p.code, tag: p.tag, folder: p.folder ?? "" })));
  let paraFolders = $state<Record<string, string>>(Object.fromEntries(paras.map((p) => [p.code, p.folder])));
  let renameExisting = $state(true);
  const hasTaxonomy = untrack(() => vault.exists(TAXONOMY_PATH));

  // --- This device ----------------------------------------------------------
  let device = $state<Prefs>({ ...prefs });
  let aiSettings = $state<AiSettings>(untrack(() => ({ ...aiState.settings })));
  let aiTest = $state<{ ok: boolean; text: string } | null>(null);
  /** The on-device model: one of the list, or "other" with its ID typed in. */
  const listed = (id: string) => DEVICE_MODELS.some((m) => m.id === id);
  let modelChoice = $state(untrack(() => (listed(aiSettings.deviceModel) ? aiSettings.deviceModel : "other")));
  let otherModel = $state(untrack(() => (listed(aiSettings.deviceModel) ? "" : aiSettings.deviceModel)));
  let aiTesting = $state(false);
  async function testAi() {
    aiTesting = true;
    aiTest = null;
    try {
      aiTest = { ok: true, text: await testServer($state.snapshot(aiSettings) as AiSettings) };
    } catch (e) {
      aiTest = { ok: false, text: (e as Error).message };
    }
    aiTesting = false;
  }

  let error = $state("");
  let busy = $state(false);

  const templates = $derived(vault.templates());
  const journalPreview = $derived.by(() => {
    try {
      return `${journalFolder.trim().replace(/^\/+|\/+$/g, "") || "(vault root)"}/${formatDate(new Date(), journalFormat || "YYYY-MM-DD")}.md`;
    } catch {
      return "";
    }
  });

  /** A folder path typed by the user: "" allowed only where `optional`. */
  function folder(label: string, value: string, optional = false): string {
    const v = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (!v && !optional) throw new Error(`${label}: type a folder name.`);
    if (/[:*?"<>|#^[\]]/.test(v) || v.split("/").some((p) => v && (!p.trim() || p.startsWith(".")))) {
      throw new Error(`${label}: “${v}” cannot be used as a folder name.`);
    }
    return v;
  }

  async function save() {
    error = "";
    busy = true;
    const done: string[] = [];
    try {
      // Vault settings.
      const att = folder("Attachments folder", attachFolder, attachMode !== "folder" && attachMode !== "sub");
      const next: VaultSettings = {
        ...start,
        attachments: attachMode === "root" ? "" : attachMode === "same" ? "./" : attachMode === "sub" ? `./${att}` : att,
        templatesFolder: folder("Templates folder", templatesFolder),
        journal: { folder: folder("Journal folder", journalFolder, true), format: journalFormat.trim() || "YYYY-MM-DD", template: journalTemplate || undefined },
        inboxFolder: folder("Inbox folder", inboxFolder, true),
        searchesFolder: folder("Saved searches folder", searchesFolder, true),
        exportsFolder: folder("PDF exports folder", exportsFolder, true),
        oneOnOneCode: (() => {
          const c = oneOnOneCode.trim();
          if (!/^\d{2}\.\d{2}\.\d{2}$/.test(c)) throw new Error(`One-on-one code: “${c}” must look like 02.02.01 (PARA.Category.Sub-PARA).`);
          return c;
        })(),
        people: people
          .map((p) => ({ name: p.name.trim(), email: p.email.trim() || undefined }))
          .filter((p) => p.name)
          .map((p) => (p.email ? p : { name: p.name })),
      };
      const changed = JSON.stringify({ ...next, fromObsidian: 0 }) !== JSON.stringify({ ...start, fromObsidian: 0 });

      // PARA folders: validate them all before changing anything.
      const paraChanges = paras.filter((p) => paraFolders[p.code]!.trim().replace(/^\/+|\/+$/g, "") !== p.folder);
      let tax = vault.taxonomy;
      for (const p of paraChanges) tax = setParaFolder(tax, p.code, paraFolders[p.code]!);

      if (changed) {
        await vault.saveSettings(next);
        done.push("vault settings saved");
      }
      if (paraChanges.length) {
        await vault.save(TAXONOMY_PATH, editTaxonomyNote(vault.read(TAXONOMY_PATH), () => tax));
        for (const p of paraChanges) {
          const to = tax.paras.find((e) => e.code === p.code)!.folder!;
          if (renameExisting && p.folder && vault.folderExists(p.folder)) await vault.renameFolder(p.folder, to);
        }
        done.push(`PARA folder${paraChanges.length > 1 ? "s" : ""} changed${renameExisting ? " and renamed in the vault" : ""}`);
      }

      // Device preferences.
      if (JSON.stringify(device) !== JSON.stringify({ ...prefs })) {
        savePrefs({ ...device });
        done.push("device preferences saved");
      }
      const deviceModel = modelChoice === "other" ? otherModel.trim() || DEFAULT_DEVICE_MODEL : modelChoice;
      const nextAi = { ...$state.snapshot(aiSettings), serverUrl: aiSettings.serverUrl.trim(), deviceModel } as AiSettings;
      if (JSON.stringify(nextAi) !== JSON.stringify(aiState.settings)) {
        if (nextAi.embeddings === "server" && !nextAi.serverUrl) throw new Error("AI: meaning “from the server” needs a server address.");
        setAiSettings(nextAi);
        done.push("AI settings saved");
      }
      onSaved(done.length ? `Settings: ${done.join(", ")}` : "Settings: nothing changed");
    } catch (e) {
      error = (e as Error).message;
      busy = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && onClose()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
  <div class="dialog" role="dialog" aria-labelledby="st-title">
    <h2 id="st-title">Settings</h2>

    <section>
      <h3>This vault <span class="where">saved in “{vault.name}”, the same on every device</span></h3>

      <h4>PARA folders</h4>
      {#if !hasTaxonomy}
        <p class="hint">This vault has no taxonomy yet, so notes are not numbered. <button class="link" onclick={onSetupTaxonomy}>Set it up</button></p>
      {:else}
        <p class="hint">Where the numbered notes of each PARA go.</p>
        <div class="paras">
          {#each paras as p}
            <label class="para"><span class="code">{p.code} · #{p.tag}</span><input bind:value={paraFolders[p.code]} /></label>
          {/each}
        </div>
        <label class="check"><input type="checkbox" bind:checked={renameExisting} /> Also rename the existing folders (with their notes and attachments)</label>
      {/if}

      <h4>Attachments</h4>
      <label>Pasted and dropped images and files go
        <select bind:value={attachMode}>
          <option value="folder">into a folder of the vault</option>
          <option value="sub">into a sub-folder of the note's folder</option>
          <option value="same">next to the note</option>
          <option value="root">into the vault root</option>
        </select>
      </label>
      {#if attachMode === "folder" || attachMode === "sub"}
        <label>{attachMode === "folder" ? "Folder" : "Sub-folder name"} <input bind:value={attachFolder} placeholder="attachments" /></label>
      {/if}

      <h4>Journal</h4>
      <div class="row">
        <label>Folder <input bind:value={journalFolder} placeholder="(vault root)" /></label>
        <label>Date format <input bind:value={journalFormat} placeholder="YYYY-MM-DD" /></label>
      </div>
      <p class="hint">Today's note: <code>{journalPreview}</code>. Tokens: YYYY, MM, DD, ddd (day name)…</p>
      <label>Template
        <select bind:value={journalTemplate}>
          <option value="">(the template named “Journal”, if any)</option>
          {#each templates as t}<option value={t}>{t}</option>{/each}
        </select>
      </label>

      <h4>One-on-one meetings</h4>
      {#if vault.settingsProblem()}<p class="error">⚠ {vault.settingsProblem()} Open that note and fix its properties before saving settings here.</p>{/if}
      <label>ID prefix (PARA.Category.Sub-PARA) <input bind:value={oneOnOneCode} placeholder="02.02.01" /></label>
      <p class="hint">Template: <code>One-on-One</code> in the templates folder (created with the first meeting note; edit it to change the title or sections).</p>
      {#each people as p, i}
        <div class="row person">
          <input bind:value={p.name} aria-label="Name" placeholder="Name" />
          <input bind:value={p.email} aria-label="E-mail" type="email" placeholder="E-mail (for ✉)" />
          <button type="button" class="remove" aria-label="Remove {p.name}" onclick={() => (people = people.filter((_, j) => j !== i))}>✕</button>
        </div>
      {/each}
      <button type="button" class="add" onclick={() => (people = [...people, { name: "", email: "" }])}>＋ Add a person</button>

      <h4>Other folders</h4>
      <div class="row">
        <label>Templates <input bind:value={templatesFolder} /></label>
        <label>Inbox notes <input bind:value={inboxFolder} placeholder="(vault root)" /></label>
      </div>
      <div class="row">
        <label>Saved searches <input bind:value={searchesFolder} placeholder="(vault root)" /></label>
        <label>PDF exports <input bind:value={exportsFolder} placeholder="(vault root)" /></label>
      </div>
      <p class="hint">
        Attachments, templates and journal settings are shared with Obsidian (<code>.obsidian/</code>); the other folders are kept in
        <code>_system/Settings.md</code>. Changing a folder here does not move existing notes, except PARA folders when ticked above.
      </p>
    </section>

    <section>
      <h3>This device <span class="where">only on this computer or phone</span></h3>
      <div class="row">
        <label>Theme
          <select bind:value={device.theme}>
            <option value="auto">Same as the system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>Text size
          <select bind:value={device.textSize}>
            <option value={13}>Small</option>
            <option value={15}>Normal</option>
            <option value={17}>Large</option>
            <option value={19}>Extra large</option>
          </select>
        </label>
      </div>
      <label>Notes open in
        <select bind:value={device.startMode}>
          <option value="auto">Split view on wide screens, Edit on phones</option>
          <option value="edit">Edit</option>
          <option value="split">Split (editor and preview)</option>
          <option value="view">View</option>
        </select>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={device.multiUser} />
        Notice changes made by other apps or people (shared OneDrive / SharePoint / Syncthing folders)
      </label>
      <p class="hint">Checks the vault folder every few seconds and never overwrites a note changed elsewhere. Off: reopen the vault (📂) to see changes made elsewhere.</p>
      {#if onOpenSync}<button class="secondary" onclick={onOpenSync}>⇅ Sync with a server…</button>{/if}

      <h4>AI</h4>
      <label>Related notes and search by meaning
        <select bind:value={aiSettings.embeddings}>
          <option value="off">Off (related notes by shared words only)</option>
          <option value="device">On this device (downloads a model once)</option>
          <option value="server">From the AI server below</option>
        </select>
      </label>
      {#if aiSettings.embeddings === "device"}
        <label>Model on this device
          <select bind:value={modelChoice}>
            {#each DEVICE_MODELS as m (m.id)}<option value={m.id}>{m.label}</option>{/each}
            <option value="other">Other Hugging Face model…</option>
          </select>
        </label>
        {#if modelChoice === "other"}
          <label>Model ID <input bind:value={otherModel} placeholder="Xenova/bge-small-en-v1.5" spellcheck="false" autocomplete="off" /></label>
          <p class="hint">A feature-extraction model with ONNX weights, made for Transformers.js (the “Xenova/” and “onnx-community/” models on huggingface.co).</p>
        {/if}
        <p class="hint">Downloaded once, then kept on this device. Changing the model re-indexes the vault.</p>
      {/if}
      <div class="row">
        <label>AI server (optional) <input bind:value={aiSettings.serverUrl} placeholder="http://192.168.1.20:11434" inputmode="url" /></label>
        <label>Type
          <select bind:value={aiSettings.serverKind}>
            <option value="ollama">Ollama</option>
            <option value="openai">OpenAI-compatible</option>
          </select>
        </label>
      </div>
      {#if aiSettings.serverUrl.trim()}
        <div class="row">
          <label>Chat model <input bind:value={aiSettings.chatModel} placeholder="llama3.2" /></label>
          <label>Embedding model <input bind:value={aiSettings.embedModel} placeholder="nomic-embed-text" /></label>
        </div>
        <label>API key (if the server needs one) <input bind:value={aiSettings.apiKey} type="password" autocomplete="off" /></label>
        <div class="row ai-test">
          <button type="button" onclick={testAi} disabled={aiTesting}>{aiTesting ? "Testing…" : "Test the server"}</button>
          {#if aiTest}<span class={aiTest.ok ? "ok" : "error"}>{aiTest.ok ? "✓" : "⚠"} {aiTest.text}</span>{/if}
        </div>
      {/if}
      <p class="hint">
        The server (e.g. Ollama on your Docker server) summarises and reviews notes and answers questions about them, in the
        <b>Related</b> tab. Notes are sent only to that server. Ollama must allow Zeolite: start it with
        <code>OLLAMA_ORIGINS=*</code>.
      </p>
    </section>

    {#if error}<p class="error">⚠ {error}</p>{/if}
    <div class="actions">
      <button onclick={onClose}>Cancel</button>
      <button class="primary" onclick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
    </div>
  </div>
</div>

<style>
  .ai-test {
    align-items: center;
  }
  .ai-test button {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .ok {
    color: var(--ok);
    font-size: 13px;
  }
  .person input {
    flex: 1;
    min-width: 0;
  }
  .remove,
  .add {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }
  .add {
    align-self: flex-start;
    color: var(--accent-strong);
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
    gap: 12px;
    width: min(620px, 100%);
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
  section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  h3 {
    margin: 0;
    font-size: 15px;
  }
  .where {
    margin-left: 6px;
    color: var(--muted);
    font-size: 12px;
    font-weight: 400;
  }
  h4 {
    margin: 6px 0 0;
    font-size: 13px;
    color: var(--accent-strong);
  }
  label {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    font-size: 13px;
    color: var(--muted);
  }
  label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: var(--fg);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .row label {
    min-width: 180px;
  }
  .paras {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 8px;
  }
  .para .code {
    font-family: var(--mono);
    font-size: 12px;
  }
  input:not([type="checkbox"]),
  select {
    min-width: 0;
    padding: 7px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    font-size: 14px;
  }
  .hint {
    margin: 0;
    color: var(--muted);
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
  .error {
    margin: 0;
    color: var(--danger);
  }
  .secondary {
    align-self: flex-start;
    padding: 7px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
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
  }
</style>
