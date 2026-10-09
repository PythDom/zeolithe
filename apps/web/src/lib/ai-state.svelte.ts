/**
 * State of the AI features for the open vault: settings (per device), the
 * meaning index and its progress. The index is brought up to date when the
 * Related panel or a search by meaning needs it, not in the background.
 */
import { embedderFor, EmbeddingIndex, loadAi, saveAi, type AiSettings } from "./ai";
import type { Vault } from "./vault.svelte";

export const ai = $state({
  settings: loadAi(),
  index: null as EmbeddingIndex | null,
  /** "Downloading the model…", "Indexing 40/310", "" when idle. */
  status: "",
  error: "",
  /** Bumped when the index changes, so views recompute. */
  version: 0,
});

let indexedVault: Vault | null = null;
let indexedRecords: unknown = null;
let running: Promise<void> | null = null;
let cancel = { cancelled: false };

export function setAiSettings(s: AiSettings) {
  saveAi(s);
  ai.settings = s;
  // Another model or source: start a new index.
  cancel.cancelled = true;
  ai.index = null;
  indexedVault = null;
  ai.version++;
}

/** Make sure the index matches the vault's notes (only changed sections are embedded). */
export function refreshIndex(vault: Vault): Promise<void> {
  if (running) return running;
  if (ai.settings.embeddings === "off") return Promise.resolve();
  if (indexedVault === vault && indexedRecords === vault.records) return Promise.resolve();
  running = (async () => {
    const records = vault.records;
    cancel = { cancelled: false };
    ai.error = "";
    try {
      if (indexedVault !== vault || !ai.index) {
        const embedder = embedderFor(ai.settings, (t) => (ai.status = t));
        if (!embedder) return;
        const index = new EmbeddingIndex(vault.storage, embedder);
        await index.load();
        ai.index = index;
        indexedVault = vault;
        ai.version++;
      }
      const n = await ai.index!.update(vault.notes, (done, total) => total && (ai.status = `Indexing by meaning: ${done}/${total} sections`), cancel);
      indexedRecords = records;
      if (n) ai.version++;
    } catch (e) {
      ai.error = (e as Error).message;
    } finally {
      ai.status = "";
      running = null;
    }
  })();
  return running;
}
