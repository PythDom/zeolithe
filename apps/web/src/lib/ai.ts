/**
 * AI helpers: embeddings (on this device with Transformers.js, or from a
 * server) for related notes and search by meaning, and a chat model on the
 * user's own server (Ollama or any OpenAI-compatible API) for summaries,
 * reviews and questions about the notes. Settings are per device.
 *
 * The on-device model is downloaded on first use (about 120 MB, from
 * huggingface.co, with the runtime from cdn.jsdelivr.net) and cached by the
 * web view: nothing is bundled in the app.
 */
import { hashBytes, nearest, noteChunks, type Chunk, type NoteRecord, type VectorEntry } from "@zeolite/core";
import type { VaultStorage } from "./storage";

export interface AiSettings {
  /** Embeddings: off, on this device, or from the server. */
  embeddings: "off" | "device" | "server";
  /** Server with a chat model (and optionally embeddings); "" = none. */
  serverUrl: string;
  serverKind: "ollama" | "openai";
  chatModel: string;
  embedModel: string;
  apiKey: string;
}

export const DEFAULT_AI: AiSettings = {
  embeddings: "off",
  serverUrl: "",
  serverKind: "ollama",
  chatModel: "llama3.2",
  embedModel: "nomic-embed-text",
  apiKey: "",
};

const KEY = "zeolite.ai";

export function loadAi(): AiSettings {
  try {
    return { ...DEFAULT_AI, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AiSettings>) };
  } catch {
    return { ...DEFAULT_AI };
  }
}

export function saveAi(s: AiSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not kept.
  }
}

export const hasServer = (s: AiSettings) => !!s.serverUrl.trim();

export class AiError extends Error {}

// ---------------------------------------------------------------------------
// Server (Ollama / OpenAI-compatible)

const base = (s: AiSettings) => s.serverUrl.trim().replace(/\/+$/, "");

async function post(s: AiSettings, path: string, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (s.apiKey.trim()) headers.Authorization = `Bearer ${s.apiKey.trim()}`;
  let res: Response;
  try {
    res = await fetch(`${base(s)}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new AiError(
      `Cannot reach the AI server at ${base(s)}. Check the address and network.${s.serverKind === "ollama" ? " Ollama must allow requests from Zeolite: start it with OLLAMA_ORIGINS=* (see the guide)." : ""}`,
    );
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const j = (await res.json()) as { error?: string | { message?: string } };
      detail = typeof j.error === "string" ? j.error : (j.error?.message ?? detail);
    } catch {
      /* keep the status */
    }
    throw new AiError(`AI server: ${detail}`);
  }
  return res.json();
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chat(s: AiSettings, messages: ChatMessage[]): Promise<string> {
  if (!hasServer(s)) throw new AiError("No AI server: set one in ⚙ Settings → AI.");
  if (s.serverKind === "ollama") {
    const r = (await post(s, "/api/chat", { model: s.chatModel, messages, stream: false })) as { message?: { content?: string } };
    return r.message?.content?.trim() ?? "";
  }
  const r = (await post(s, "/v1/chat/completions", { model: s.chatModel, messages })) as { choices?: { message?: { content?: string } }[] };
  return r.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Check the server and model with a tiny request. */
export async function testServer(s: AiSettings): Promise<string> {
  const answer = await chat(s, [{ role: "user", content: "Reply with the single word: OK" }]);
  return answer ? `Connected to ${s.chatModel}.` : "Connected, but the model gave an empty answer.";
}

// ---------------------------------------------------------------------------
// Embeddings

export interface Embedder {
  /** Identifies the model: an index built with another one is rebuilt. */
  readonly id: string;
  embed(texts: string[], kind: "query" | "passage"): Promise<number[][]>;
}

/** On this device: multilingual E5 (French and English), quantized, via Transformers.js. */
const DEVICE_MODEL = "Xenova/multilingual-e5-small";
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.web.min.js";

type Extractor = (texts: string[], opts: { pooling: string; normalize: boolean }) => Promise<{ tolist(): number[][] }>;
let extractor: Promise<Extractor> | null = null;

export function deviceEmbedder(onProgress?: (text: string) => void): Embedder {
  const load = () => {
    extractor ??= (async () => {
      onProgress?.("Loading the AI runtime…");
      let mod: {
        pipeline: (task: string, model: string, opts: Record<string, unknown>) => Promise<Extractor>;
        env: { backends: { onnx: { wasm?: { proxy?: boolean } } } };
      };
      try {
        mod = await import(/* @vite-ignore */ TRANSFORMERS_URL);
      } catch {
        extractor = null;
        throw new AiError("Cannot download the AI runtime (cdn.jsdelivr.net). Check the network, or use embeddings from your server (⚙ Settings → AI).");
      }
      // Run the model off the main thread, so the app stays responsive while indexing.
      if (mod.env.backends.onnx.wasm) mod.env.backends.onnx.wasm.proxy = true;
      try {
        return await mod.pipeline("feature-extraction", DEVICE_MODEL, {
          dtype: "q8",
          progress_callback: (p: { status?: string; progress?: number; file?: string }) => {
            if (p.status === "progress" && typeof p.progress === "number") onProgress?.(`Downloading the model (once): ${Math.round(p.progress)}%`);
          },
        });
      } catch (e) {
        extractor = null;
        throw new AiError(`Cannot load the model from huggingface.co (${(e as Error).message}). Check the network, or use embeddings from your server.`);
      }
    })();
    return extractor;
  };
  return {
    id: `device:${DEVICE_MODEL}`,
    async embed(texts, kind) {
      const ex = await load();
      // E5 models expect these prefixes.
      const out = await ex(
        texts.map((t) => `${kind === "query" ? "query" : "passage"}: ${t}`),
        { pooling: "mean", normalize: true },
      );
      return out.tolist();
    },
  };
}

export function serverEmbedder(s: AiSettings): Embedder {
  return {
    id: `server:${base(s)}:${s.embedModel}`,
    async embed(texts) {
      if (s.serverKind === "ollama") {
        const r = (await post(s, "/api/embed", { model: s.embedModel, input: texts })) as { embeddings?: number[][] };
        if (!r.embeddings?.length) throw new AiError(`The server returned no embeddings: is “${s.embedModel}” an embedding model (e.g. nomic-embed-text, bge-m3)?`);
        return r.embeddings;
      }
      const r = (await post(s, "/v1/embeddings", { model: s.embedModel, input: texts })) as { data?: { embedding: number[] }[] };
      if (!r.data?.length) throw new AiError("The server returned no embeddings.");
      return r.data.map((d) => d.embedding);
    },
  };
}

export function embedderFor(s: AiSettings, onProgress?: (t: string) => void): Embedder | null {
  if (s.embeddings === "device") return deviceEmbedder(onProgress);
  if (s.embeddings === "server" && hasServer(s)) return serverEmbedder(s);
  return null;
}

// ---------------------------------------------------------------------------
// The index: one vector per note section, kept on this device in .zeolite/

export const INDEX_PATH = ".zeolite/embeddings.json";

interface Stored {
  model: string;
  entries: Record<string, { path: string; heading: string; hash: string; v: string }>;
}

const toB64 = (v: number[]) => {
  const bytes = new Uint8Array(new Float32Array(v).buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b: string): Float32Array => {
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
};
const hashText = (t: string) => hashBytes(new TextEncoder().encode(t));

export class EmbeddingIndex {
  entries: (VectorEntry & { hash: string })[] = [];
  private model = "";

  constructor(
    private readonly storage: VaultStorage,
    private readonly embedder: Embedder,
  ) {}

  get size() {
    return this.entries.length;
  }

  async load() {
    try {
      const s = JSON.parse(await this.storage.readText(INDEX_PATH)) as Stored;
      if (s.model !== this.embedder.id) return;
      this.model = s.model;
      this.entries = Object.entries(s.entries).map(([key, e]) => ({ key, path: e.path, heading: e.heading, hash: e.hash, vector: fromB64(e.v) }));
    } catch {
      // No index yet.
    }
  }

  /**
   * Bring the index up to date with the notes: only new or changed sections
   * are embedded. Returns how many were embedded.
   */
  async update(records: NoteRecord[], onProgress?: (done: number, total: number) => void, signal?: { cancelled: boolean }): Promise<number> {
    const chunks: (Chunk & { hash: string })[] = records.filter((r) => !r.conflict && !r.path.startsWith("_system/")).flatMap((r) => noteChunks(r).map((c) => ({ ...c, hash: hashText(c.text) })));
    const known = new Map(this.entries.map((e) => [e.key, e]));
    const todo = chunks.filter((c) => known.get(c.key)?.hash !== c.hash);
    const keep = new Set(chunks.map((c) => c.key));
    let entries = this.entries.filter((e) => keep.has(e.key));
    const batch = 16;
    for (let i = 0; i < todo.length; i += batch) {
      if (signal?.cancelled) break;
      onProgress?.(i, todo.length);
      const part = todo.slice(i, i + batch);
      const vectors = await this.embedder.embed(part.map((c) => c.text), "passage");
      const fresh = new Map(part.map((c, j) => [c.key, { key: c.key, path: c.path, heading: c.heading, hash: c.hash, vector: Float32Array.from(vectors[j]!) }]));
      entries = [...entries.filter((e) => !fresh.has(e.key)), ...fresh.values()];
      this.entries = entries;
    }
    onProgress?.(todo.length, todo.length);
    this.entries = entries;
    this.model = this.embedder.id;
    if (todo.length || entries.length !== known.size) await this.save();
    return todo.length;
  }

  private async save() {
    const out: Stored = { model: this.model, entries: {} };
    for (const e of this.entries) out.entries[e.key] = { path: e.path, heading: e.heading, hash: e.hash, v: toB64(Array.from(e.vector)) };
    await this.storage.writeText(INDEX_PATH, JSON.stringify(out));
  }

  /** Sections closest in meaning to a question or search. */
  async search(query: string, limit = 10) {
    const [v] = await this.embedder.embed([query], "query");
    return nearest(v!, this.entries, limit);
  }
}

// ---------------------------------------------------------------------------
// What the server model is asked

const LANG = "Answer in the language of the note (French or English). Use Markdown. Be concise.";

export function notePrompt(action: "summary" | "review" | "actions", title: string, content: string): ChatMessage[] {
  const task = {
    summary: "Summarise this note in 3 to 6 bullet points. Keep names, dates and decisions.",
    review:
      "Review this note as a careful colleague: list what is unclear or missing, open questions, risks, and actions that seem implied but are not written down. Short bullet points.",
    actions:
      "List the actions implied by this note as Markdown tasks, one per line: `- [ ] action [owner:: Name] [due:: YYYY-MM-DD]`. Add owner and due only when the note says them. Do not repeat tasks already written as `- [ ]`.",
  }[action];
  return [
    { role: "system", content: `You help a manager with their notes. ${LANG}` },
    { role: "user", content: `${task}\n\nNote “${title}”:\n\n${content.slice(0, 12000)}` },
  ];
}

export function questionPrompt(question: string, sources: { title: string; heading: string; text: string }[]): ChatMessage[] {
  const ctx = sources.map((s, i) => `[${i + 1}] ${s.title}${s.heading ? ` — ${s.heading}` : ""}\n${s.text}`).join("\n\n");
  return [
    {
      role: "system",
      content: `You answer questions using only the user's notes below. Cite sources as [1], [2]… If the notes do not contain the answer, say so. Answer in the language of the question. Use Markdown. Be concise.`,
    },
    { role: "user", content: `Notes:\n\n${ctx.slice(0, 14000)}\n\nQuestion: ${question}` },
  ];
}
