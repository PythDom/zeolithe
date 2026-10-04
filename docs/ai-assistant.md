# Zeolite: local AI assistant (design)

Status: design only, no code written yet. To be picked up on request.

Goal: help review notes, infer connections, propose links and make
suggestions, with everything running on the user's own devices (or their own
server). No note content goes to a cloud service.

## 1. Principles

- **Proposals only.** The assistant never edits a note on its own. Every
  suggestion has an accept button (insert `[[link]]`, add tag, …) or a dismiss
  button.
- **Optional and off by default.** Zeolite works exactly as today without it.
  Models are downloaded on first use, never bundled: the exe stays ~4.5 MB.
- **Same code everywhere where possible.** Steps 0 and 1 run in the webview,
  so the exe, the apk and the portable HTML get them together.
- **Per-device data.** Indexes and vectors live in `.zeolite/` (already
  skipped by WebDAV sync) and are rebuilt per device. Models live in
  `Zeolite-data/models/` next to the portable exe, in the app data folder on
  Android. A model file can also be copied there by hand (work PC without
  downloads).
- **Bilingual.** Notes are in French and English, so all models must be
  multilingual.

## 2. Steps at a glance

| Step | What | Download | Platforms | Effort (one developer) |
|---|---|---|---|---|
| 0 | No AI: unlinked mentions, keyword similarity | none | all | 3–5 days |
| 1 | Embeddings: related notes, link/tag suggestions, semantic search | ~120–300 MB, once | all | 1.5–2.5 weeks |
| 2a | Generative, via the user's own Ollama server | none on the device | all | 1 week |
| 2b | Generative, embedded in the exe (llama.cpp) | ~1–2.5 GB | Windows | 2–3 weeks |
| 2c | Generative, embedded in the apk | ~0.7–1.5 GB | Android | 2–4 weeks, device-dependent |

Recommended order: 0 → 1 → 2a → 2b, with 2c only if 2a is not enough on the
phone.

## 3. Step 0: connections without AI

Features:

- **Unlinked mentions.** A note's title (or alias) appears as plain text in
  another note: propose turning it into `[[link]]`. Shown in a "Suggestions"
  section under the backlinks, and as a vault-wide review list.
- **Related notes (keyword-based).** BM25/TF-IDF scoring over note text, plus
  shared tags, @people and PARA codes. Rare shared words weigh more.
- **Orphans.** Notes with no links in or out, listed for review.

Technique: an inverted index built from the notes already in memory. French
and English stop words, accent folding, simple stemming. Instant on 600+
notes.

Size: 0 MB. Effort: 3–5 days including the UI panel and tests.

## 4. Step 1: embeddings

An embedding model turns each note (or each section) into a vector. Notes
with close vectors are about related things, even with different words.

Features:

- **Related notes panel** on the open note, merged with Step 0 scores.
- **Suggested links:** "this paragraph talks about *Typhoon status review*",
  with an insert button.
- **Semantic search:** a "meaning" mode in the search box.
- **Possible duplicates:** pairs of very similar notes, with a side-by-side
  view.
- **Tag suggestions:** tags used by the nearest notes but missing here.
- **Inbox triage:** for an inbox note, propose the PARA folder and code most
  common among its nearest notes.

Runtime: **Transformers.js** (ONNX Runtime Web), in a Web Worker so the UI
stays responsive. WebGPU when available, WASM otherwise.

Model choices (multilingual, quantized):

| Model | Size | Notes |
|---|---|---|
| `multilingual-e5-small` | ~120 MB | Default: good French/English, fast on CPU |
| EmbeddingGemma-300M | ~200–300 MB | Better quality, a bit slower |
| `paraphrase-multilingual-MiniLM-L12-v2` | ~120 MB | Fallback, very well tested |
| `bge-m3` | ~600 MB | Best quality, too heavy for phones |

Check the current versions before starting; this field moves quickly.

Indexing:

- Split notes by heading (sections of ~200–500 words) and embed each section,
  so links can point to `[[Note#Heading]]`.
- First indexing: about 1–3 minutes for 600 notes on a laptop CPU, longer on
  a phone (run on request or while charging). After that, only changed notes,
  using the existing mtime:size stamps.
- Storage: ~1.5 KB per section (384 floats), so ~2–5 MB for a large vault.
  Plain brute-force cosine search is fast enough up to tens of thousands of
  sections; no vector database needed.

Settings: enable/disable, model, re-index button, "index only while
charging" (Android).

Size: 120–300 MB download, ~300–600 MB of RAM while indexing.
Effort: 1.5–2.5 weeks (worker and model download 3–4 days, indexing and
cache 3 days, UI panels 3–5 days, tests and tuning 2–3 days).

## 5. Step 2: generative model

Features (all grounded on the notes found by Step 1, so answers come from the
vault rather than from the model's memory):

- **Summarise** a note or a set of notes (e.g. all notes of a project).
- **Review a note:** missing actions, unclear points, open questions.
- **Extract actions** into Zeolite tasks (`- [ ] … [due:: …]`), proposed for
  insertion.
- **Ask the vault:** questions answered with links to the source notes.
- **Explain a suggested link:** one sentence on why two notes are related.

Model choices (quantized GGUF/ONNX, ~4 bits; pick by French quality):

| Size class | Examples | Download | RAM | Use |
|---|---|---|---|---|
| ~1B | Gemma 3 1B, Llama 3.2 1B, Qwen 3 small | ~0.7–1 GB | ~1.5 GB | Phones, short summaries |
| 3–4B | Llama 3.2 3B, Phi-4-mini, SmolLM3 3B, Ministral 3B, Gemma 3 4B | ~2–2.5 GB | ~3 GB | PC default |
| 7–14B | Mistral, Qwen, Llama families | 4–9 GB | 8–16 GB | Server only (2a) |

Small models can make things up: outputs are labelled as suggestions, and
links to source notes are always shown.

### 2a. The user's own server (Ollama)

Ollama (or LM Studio, llama.cpp server) on the Docker server, called over its
OpenAI-compatible HTTP API. Configured like WebDAV: URL, optional token, model
name, test button. Not embedded, but the most capable option, nothing to
install per device, and still private. It can also serve embeddings for
Step 1 on weak devices.

Effort: about 1 week (client, settings, prompts, streaming display).

### 2b. Embedded in the exe

llama.cpp built into the Tauri app (Rust bindings) or shipped as a helper
program next to the exe. Uses the CPU (AVX2) or the GPU (Vulkan). About 10–30
words/s for a 3B model on a recent laptop. Model file in
`Zeolite-data/models/`, so the exe stays portable.

Alternative: WebLLM in the webview (WebGPU in Edge WebView2). One code base,
but slower and needs a capable GPU.

Effort: 2–3 weeks (native build in CI, model management, streaming to the UI).

### 2c. Embedded in the apk

Native Capacitor plugin around llama.cpp, or Google's LiteRT/MediaPipe LLM
runtime. ~1B models, about 5–15 words/s on a recent phone; heat and battery
are real limits. Gemini Nano (Android's built-in AI) needs no download but
exists only on some recent high-end phones.

Effort: 2–4 weeks, mostly device testing.

## 6. Risks

1. Phone performance and battery for indexing and generation: mitigated by
   on-request indexing and option 2a.
2. Small-model quality in French: test candidates on real notes before
   choosing.
3. Work PC policies (downloads, GPU drivers, antivirus flagging a native
   helper): manual model copy, CPU fallback.
4. WebGPU availability in the Android WebView: WASM fallback for Step 1.

## 7. Decision log

- 2026-10-04: design written; implementation deferred until requested.
  Recommended order 0 → 1 → 2a → 2b.
