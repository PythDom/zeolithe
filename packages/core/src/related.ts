/**
 * Connections between notes without AI: related notes by shared words
 * (TF-IDF), unlinked mentions (a note's title written as plain text in
 * another note), notes with no links, tag suggestions. Also the building
 * blocks of the embedding index: note sections and vector similarity.
 */
import { splitFrontmatter } from "./frontmatter";
import { linkNameOf } from "./links";
import type { NoteRecord } from "./note-record";

// ---------------------------------------------------------------------------
// Words

/** Common French and English words, ignored when comparing notes. */
const STOP = new Set(
  (
    "les des une est que qui dans pour par pas sur avec son ses aux mais ont sont cette ces elle ils elles nous vous leur leurs " +
    "tout tous toute toutes plus moins comme bien aussi alors donc car fait faire etre avoir avait sera suis etait entre sans " +
    "sous vers chez dont quoi quel quelle quels quelles meme autre autres deux tres peu encore deja ici apres avant pendant " +
    "the and for are but not you all any can had her was one our out has have him his how its may new now old see two who boy " +
    "did does with this that from they will would there their what about which when your said each she them then these into " +
    "than been more some time could other only like just also over such make most much very where after before should those " +
    "while being here why yes off per via etc todo note notes"
  ).split(" "),
);

/** Lower case, without accents: "Été" → "ete". */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** Markdown without code, links' targets, URLs and syntax: the words a reader sees. */
export function plainWords(markdown: string): string {
  return splitFrontmatter(markdown)
    .body.replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t: string, alias?: string) => ` ${alias ?? t} `)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, " $1 ")
    .replace(/https?:\/\/\S+/g, " ")
    // Inline fields: keep the value, drop the key ([due:: …] → its date, Attn:: … → the text).
    .replace(/[[(][\p{L}\p{N}_ -]+::\s*([^\])\n]*)[\])]/gu, " $1 ")
    .replace(/^(\s*(?:[-*+]\s+(?:\[.\]\s+)?)?)[\p{L}\p{N}_-]+::/gmu, "$1");
}

/** Words that carry meaning, folded and lightly stemmed (plural "s" removed). */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of fold(text).split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 3 || /^\d+$/.test(raw) || STOP.has(raw)) continue;
    out.push(raw.length > 4 && raw.endsWith("s") && !raw.endsWith("ss") ? raw.slice(0, -1) : raw);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Related notes by shared words (TF-IDF, cosine similarity)

export interface KeywordDoc {
  path: string;
  title: string;
  text: string;
  tags: string[];
}

export interface KeywordIndex {
  vectors: Map<string, Map<string, number>>;
  norms: Map<string, number>;
  idf: Map<string, number>;
}

export function keywordDocs(records: Iterable<NoteRecord>): KeywordDoc[] {
  return [...records].map((r) => ({ path: r.path, title: r.title, text: plainWords(r.body), tags: r.tags }));
}

export function buildKeywordIndex(docs: KeywordDoc[]): KeywordIndex {
  const counts = new Map<string, Map<string, number>>();
  const df = new Map<string, number>();
  for (const d of docs) {
    const c = new Map<string, number>();
    const add = (terms: string[], weight: number) => terms.forEach((t) => c.set(t, (c.get(t) ?? 0) + weight));
    add(tokenize(d.text), 1);
    // Titles and tags say what a note is about: they weigh more.
    add(tokenize(d.title), 3);
    add(tokenize(d.tags.join(" ").replace(/[_/-]/g, " ")), 2);
    counts.set(d.path, c);
    for (const t of c.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = docs.length || 1;
  const idf = new Map<string, number>();
  for (const [t, f] of df) idf.set(t, Math.log(1 + n / f));
  const vectors = new Map<string, Map<string, number>>();
  const norms = new Map<string, number>();
  for (const [path, c] of counts) {
    const v = new Map<string, number>();
    let sum = 0;
    for (const [t, tf] of c) {
      // Words found in a single note cannot connect notes: left out.
      if ((df.get(t) ?? 0) < 2) continue;
      const w = (1 + Math.log(tf)) * idf.get(t)!;
      v.set(t, w);
      sum += w * w;
    }
    vectors.set(path, v);
    norms.set(path, Math.sqrt(sum));
  }
  return { vectors, norms, idf };
}

export interface Related {
  path: string;
  /** 0–1. */
  score: number;
  /** Words or meaning the notes share (for display). */
  why: string[];
}

function cosineSparse(a: Map<string, number>, na: number, b: Map<string, number>, nb: number): { score: number; shared: [string, number][] } {
  if (!na || !nb) return { score: 0, shared: [] };
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  let dot = 0;
  const shared: [string, number][] = [];
  for (const [t, w] of small) {
    const o = large.get(t);
    if (o) {
      dot += w * o;
      shared.push([t, w * o]);
    }
  }
  return { score: dot / (na * nb), shared };
}

/** Notes sharing the most meaningful words with `path`. */
export function relatedByKeywords(index: KeywordIndex, path: string, limit = 10, min = 0.06): Related[] {
  const v = index.vectors.get(path);
  if (!v) return [];
  const nv = index.norms.get(path)!;
  const out: Related[] = [];
  for (const [other, ov] of index.vectors) {
    if (other === path) continue;
    const { score, shared } = cosineSparse(v, nv, ov, index.norms.get(other)!);
    if (score >= min) out.push({ path: other, score, why: shared.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Free-text search ranked by the same word weights. */
export function searchByKeywords(index: KeywordIndex, query: string, limit = 20): Related[] {
  const q = new Map<string, number>();
  for (const t of tokenize(query)) q.set(t, (q.get(t) ?? 0) + (index.idf.get(t) ?? 0));
  const nq = Math.sqrt([...q.values()].reduce((s, w) => s + w * w, 0));
  const out: Related[] = [];
  for (const [path, v] of index.vectors) {
    const { score, shared } = cosineSparse(q, nq, v, index.norms.get(path)!);
    if (score > 0) out.push({ path, score, why: shared.map(([t]) => t) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Unlinked mentions

export interface MentionTarget {
  path: string;
  /** Link text for [[…]]. */
  link: string;
  /** Texts that refer to the note: title, file name, name without its ID, aliases. */
  names: string[];
}

const ID_PREFIX = /^\d{2}\.\d{2}\.\d{2}\.\d{3}\s+/;

/** Names worth looking for: not too short, not a common word. */
function usefulName(n: string): boolean {
  const t = n.trim();
  if (t.length < 4 || /^\d+$/.test(t)) return false;
  return t.includes(" ") || !STOP.has(fold(t));
}

export function mentionTargets(records: Iterable<NoteRecord>, linkText: (path: string) => string = (p) => linkNameOf(p)): MentionTarget[] {
  const out: MentionTarget[] = [];
  for (const r of records) {
    const aliases = r.frontmatter.aliases;
    const names = new Set<string>([r.title, r.name, r.name.replace(ID_PREFIX, ""), r.title.replace(ID_PREFIX, "")]);
    if (Array.isArray(aliases)) aliases.forEach((a) => typeof a === "string" && names.add(a));
    else if (typeof aliases === "string") names.add(aliases);
    const useful = [...names].map((n) => n.trim()).filter(usefulName);
    if (useful.length) out.push({ path: r.path, link: linkText(r.path), names: useful });
  }
  return out;
}

/** The note with code, links, URLs, frontmatter and headings blanked out (same length, so offsets match). */
function searchable(content: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  const fm = /^---\n[\s\S]*?\n---\n/.exec(content)?.[0] ?? "";
  return (
    blank(fm) +
    content
      .slice(fm.length)
      .replace(/```[\s\S]*?```/g, blank)
      .replace(/`[^`\n]*`/g, blank)
      .replace(/!?\[\[[^\]]*\]\]/g, blank)
      .replace(/\[[^\]]*\]\([^)]*\)/g, blank)
      .replace(/https?:\/\/\S+/g, blank)
      .replace(/^#{1,6} .*$/gm, blank)
      .replace(/[\[(][\p{L}\p{N}_-]+::[^\])\n]*[\])]/gu, blank)
  );
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface Mention {
  target: MentionTarget;
  /** Offset and text in the note's content. */
  index: number;
  text: string;
}

/**
 * Other notes named in `content` as plain text (first occurrence each),
 * leaving out notes it already links to.
 */
export function unlinkedMentions(content: string, selfPath: string, targets: MentionTarget[], linked: Set<string>): Mention[] {
  const text = searchable(content);
  const taken: [number, number][] = [];
  const found: Mention[] = [];
  const candidates = targets
    .filter((t) => t.path !== selfPath && !linked.has(t.path))
    .flatMap((t) => t.names.map((name) => ({ t, name })))
    .sort((a, b) => b.name.length - a.name.length);
  const done = new Set<string>();
  for (const { t, name } of candidates) {
    if (done.has(t.path)) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, "iu");
    const m = re.exec(text);
    if (!m) continue;
    const [a, b] = [m.index, m.index + m[0].length];
    if (taken.some(([x, y]) => a < y && b > x)) continue;
    taken.push([a, b]);
    done.add(t.path);
    found.push({ target: t, index: a, text: content.slice(a, b) });
  }
  return found.sort((x, y) => x.index - y.index);
}

/** Replace a mention by a link: [[Note]] or [[Note|text as written]]. */
export function linkMention(content: string, m: { index: number; text: string }, link: string): string {
  if (content.slice(m.index, m.index + m.text.length) !== m.text) return content;
  const same = fold(m.text) === fold(link);
  return `${content.slice(0, m.index)}[[${same ? link : `${link}|${m.text}`}]]${content.slice(m.index + m.text.length)}`;
}

// ---------------------------------------------------------------------------
// Notes with no links, tag suggestions

/** Notes that link nowhere and that no note links to. */
export function notesWithoutLinks(records: NoteRecord[], resolve: (target: string) => string | undefined, skip: (path: string) => boolean = () => false): string[] {
  const linkedTo = new Set<string>();
  const linking = new Set<string>();
  for (const r of records) {
    for (const l of r.links) {
      const p = resolve(l.target);
      if (p && p !== r.path) {
        linkedTo.add(p);
        linking.add(r.path);
      }
    }
  }
  return records
    .filter((r) => !r.conflict && !skip(r.path) && !linkedTo.has(r.path) && !linking.has(r.path))
    .map((r) => r.path)
    .sort((a, b) => a.localeCompare(b));
}

/** Tags carried by several closely related notes but missing from this one. */
export function suggestTags(own: string[], related: Related[], tagsOf: (path: string) => string[], limit = 5): string[] {
  const have = new Set(own.map((t) => t.toLowerCase()));
  const score = new Map<string, { tag: string; s: number; n: number }>();
  for (const r of related.slice(0, 8)) {
    for (const tag of tagsOf(r.path)) {
      const k = tag.toLowerCase();
      if (have.has(k) || k === "archives") continue;
      const e = score.get(k) ?? { tag, s: 0, n: 0 };
      e.s += r.score;
      e.n += 1;
      score.set(k, e);
    }
  }
  return [...score.values()]
    .filter((e) => e.n >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((e) => e.tag);
}

// ---------------------------------------------------------------------------
// Sections and vectors (embedding index)

export interface Chunk {
  /** "path#n": stable while the note's sections do not move. */
  key: string;
  path: string;
  heading: string;
  /** Text given to the embedding model: title, heading, section text. */
  text: string;
}

/** A note cut into sections (by heading), long sections cut by paragraphs. */
export function noteChunks(record: Pick<NoteRecord, "path" | "title" | "body">, max = 1200): Chunk[] {
  const out: Chunk[] = [];
  const lines = record.body.split("\n");
  let heading = "";
  let buf: string[] = [];
  const flush = () => {
    const text = plainWords(buf.join("\n")).replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
    buf = [];
    if (text.length < 20) return;
    for (let i = 0; i < text.length; i += max) {
      const part = text.slice(i, i + max);
      out.push({ key: `${record.path}#${out.length}`, path: record.path, heading, text: `${record.title}${heading && heading !== record.title ? ` — ${heading}` : ""}\n${part}` });
    }
  };
  let inCode = false;
  for (const line of lines) {
    if (/^```/.test(line)) inCode = !inCode;
    const h = !inCode && /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = h[1]!.trim();
    } else buf.push(line);
  }
  flush();
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface VectorEntry {
  key: string;
  path: string;
  heading: string;
  vector: ArrayLike<number>;
}

/** Nearest sections to a vector, best first. */
export function nearest(vector: ArrayLike<number>, entries: VectorEntry[], limit = 10, skipPath?: string): (VectorEntry & { score: number })[] {
  const out: (VectorEntry & { score: number })[] = [];
  for (const e of entries) if (e.path !== skipPath) out.push({ ...e, score: cosine(vector, e.vector) });
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Notes closest in meaning to `path` (best section pair per note). */
export function relatedByVectors(path: string, entries: VectorEntry[], limit = 10, min = 0.5): Related[] {
  const own = entries.filter((e) => e.path === path);
  const best = new Map<string, { score: number; heading: string }>();
  for (const o of own) {
    for (const e of entries) {
      if (e.path === path) continue;
      const s = cosine(o.vector, e.vector);
      if (s > (best.get(e.path)?.score ?? -1)) best.set(e.path, { score: s, heading: e.heading });
    }
  }
  return [...best.entries()]
    .filter(([, v]) => v.score >= min)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit)
    .map(([p, v]) => ({ path: p, score: v.score, why: v.heading ? [v.heading] : [] }));
}

/** Combine word and meaning similarity (each 0–1) into one list. */
export function mergeRelated(words: Related[], meaning: Related[], limit = 10): Related[] {
  const all = new Map<string, Related & { w: number; m: number }>();
  for (const r of words) all.set(r.path, { ...r, w: r.score, m: 0 });
  for (const r of meaning) {
    const e = all.get(r.path);
    if (e) (e.m = r.score), (e.why = [...new Set([...r.why, ...e.why])].slice(0, 3));
    else all.set(r.path, { ...r, w: 0, m: r.score });
  }
  // Meaning scores of unrelated texts sit around 0.5–0.7: rescale before mixing.
  const m = (x: number) => Math.max(0, (x - 0.55) / 0.45);
  return [...all.values()]
    .map((e) => ({ path: e.path, why: e.why, score: meaning.length ? 0.4 * Math.min(1, e.w * 2) + 0.6 * m(e.m) : e.w }))
    .filter((e) => e.score > 0.02)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
