import {
  buildNoteRecord,
  findCollisions,
  linkNameOf,
  parseTaxonomy,
  renameInlineTag,
  replaceLinkTarget,
  splitFrontmatter,
  withFrontmatter,
  runQuery,
  TAXONOMY_PATH,
  type IdCollision,
  type NewNote,
  type NoteRecord,
  type QueryResult,
  type Taxonomy,
} from "@zeolithe/core";
import type { VaultStorage } from "./storage";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export interface SearchHit {
  record: NoteRecord;
  score: number;
  snippet: string;
}

/**
 * In-memory view of the vault. Files on disk are the source of truth; this is
 * a cache rebuilt on load. (Phase 2 replaces search with SQLite WASM + FTS5.)
 */
export class Vault {
  storage: VaultStorage;
  files = $state<string[]>([]);
  records = $state<Map<string, NoteRecord>>(new Map());
  contents = new Map<string, string>();
  taxonomy = $state<Taxonomy>({ paras: [], categories: [], subParas: {}, warnings: [] });
  /** Object URLs for image attachments, keyed by path. */
  private assetUrls = new Map<string, string>();

  constructor(storage: VaultStorage) {
    this.storage = storage;
  }

  get name() {
    return this.storage.name;
  }

  async load() {
    const files = (await this.storage.list()).sort((a, b) => a.localeCompare(b));
    const records = new Map<string, NoteRecord>();
    for (const path of files) {
      if (!path.toLowerCase().endsWith(".md")) continue;
      const text = await this.storage.readText(path);
      this.contents.set(path, text);
      records.set(path, buildNoteRecord(path, text));
    }
    for (const u of this.assetUrls.values()) URL.revokeObjectURL(u);
    this.assetUrls.clear();
    for (const path of files) {
      if (IMAGE_EXT.test(path)) this.assetUrls.set(path, URL.createObjectURL(await this.storage.readBinary(path)));
    }
    this.files = files;
    this.records = records;
    this.refreshTaxonomy();
  }

  private refreshTaxonomy() {
    const text = this.contents.get(TAXONOMY_PATH);
    this.taxonomy = text ? parseTaxonomy(text) : { paras: [], categories: [], subParas: {}, warnings: ["No _system/Taxonomy.md in this vault."] };
  }

  /** Notes that count as real notes (Syncthing conflict copies excluded). */
  get notes(): NoteRecord[] {
    return [...this.records.values()].filter((r) => !r.conflict);
  }

  get conflicts(): NoteRecord[] {
    return [...this.records.values()].filter((r) => r.conflict);
  }

  get existingIds(): string[] {
    return this.notes.map((r) => r.id).filter((x): x is string => !!x);
  }

  get collisions(): IdCollision[] {
    return findCollisions(this.notes.filter((r) => r.id).map((r) => ({ path: r.path, id: r.id!, created: r.created })));
  }

  read(path: string): string {
    return this.contents.get(path) ?? "";
  }

  async save(path: string, content: string) {
    if (this.contents.get(path) === content) return;
    this.contents.set(path, content);
    await this.storage.writeText(path, content);
    const next = new Map(this.records);
    next.set(path, buildNoteRecord(path, content));
    this.records = next;
    if (!this.files.includes(path)) this.files = [...this.files, path].sort((a, b) => a.localeCompare(b));
    if (path === TAXONOMY_PATH) this.refreshTaxonomy();
  }

  exists(path: string) {
    return this.files.includes(path);
  }

  async create(note: NewNote): Promise<string> {
    if (this.exists(note.path)) throw new Error(`A note already exists at ${note.path}`);
    await this.save(note.path, note.content);
    return note.path;
  }

  /** Move/rename a note and update [[links]] to it across the vault. */
  async move(from: string, to: string, content?: string): Promise<string> {
    if (from !== to && this.exists(to)) throw new Error(`A note already exists at ${to}`);
    const text = content ?? this.read(from);
    if (from !== to) {
      await this.storage.rename(from, to);
      this.contents.delete(from);
      this.files = this.files.filter((f) => f !== from);
      const next = new Map(this.records);
      next.delete(from);
      this.records = next;
    }
    await this.save(to, text);
    const oldName = linkNameOf(from);
    const newName = linkNameOf(to);
    if (oldName !== newName) {
      for (const [path, body] of [...this.contents]) {
        const updated = replaceLinkTarget(body, oldName, newName);
        if (updated !== body) await this.save(path, updated);
      }
    }
    return to;
  }

  async addAttachment(file: Blob, name: string): Promise<string> {
    const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, "-");
    let path = `attachments/${clean}`;
    for (let i = 1; this.files.includes(path); i++) path = `attachments/${clean.replace(/(\.[^.]*)?$/, ` ${i}$1`)}`;
    await this.storage.writeBinary(path, file);
    this.files = [...this.files, path].sort((a, b) => a.localeCompare(b));
    if (IMAGE_EXT.test(path)) this.assetUrls.set(path, URL.createObjectURL(file));
    return path;
  }

  /** Resolve a [[link]] target the way Obsidian does: exact path, then by name. */
  resolveNote(target: string): string | undefined {
    const t = target.replace(/\.md$/i, "");
    if (this.records.has(`${t}.md`)) return `${t}.md`;
    const name = linkNameOf(t);
    return [...this.records.keys()].find((p) => linkNameOf(p) === name);
  }

  resolveAsset(target: string): string | undefined {
    const direct = this.assetUrls.get(target);
    if (direct) return direct;
    const name = target.split("/").pop();
    for (const [path, url] of this.assetUrls) if (path.split("/").pop() === name) return url;
    return undefined;
  }

  runQuery(source: string): QueryResult {
    return runQuery(source, this.notes);
  }

  /** Folders that contain notes. */
  folders(): string[] {
    const set = new Set<string>();
    for (const r of this.notes) {
      const parts = r.folder.split("/");
      for (let i = 1; i <= parts.length; i++) if (parts[0]) set.add(parts.slice(0, i).join("/"));
    }
    return [...set].sort();
  }

  /**
   * Rename a tag in every note: frontmatter `tags` and inline #tags (nested
   * children follow). Returns the number of notes changed.
   */
  async renameTag(from: string, to: string): Promise<number> {
    let changed = 0;
    for (const r of this.notes) {
      const text = this.read(r.path);
      let next = renameInlineTag(text, from, to);
      const { data, hasFrontmatter } = splitFrontmatter(next);
      if (hasFrontmatter && Array.isArray(data.tags)) {
        const tags = data.tags.map((t) => {
          const s = String(t).replace(/^#/, "");
          return s === from ? to : s.startsWith(`${from}/`) ? to + s.slice(from.length) : t;
        });
        if (tags.some((t, i) => t !== (data.tags as unknown[])[i])) next = withFrontmatter(next, { ...data, tags });
      }
      if (next !== text) {
        await this.save(r.path, next);
        changed++;
      }
    }
    return changed;
  }

  tagCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const r of this.notes) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return counts;
  }

  people(): string[] {
    const s = new Set<string>();
    for (const r of this.notes) {
      for (const t of r.tasks) t.assignees.forEach((a) => s.add(a));
      for (const a of r.attn) a.assignees.forEach((p) => s.add(p));
    }
    return [...s].sort();
  }

  search(query: string): SearchHit[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const hits: SearchHit[] = [];
    for (const r of this.notes) {
      const hay = this.read(r.path).toLowerCase();
      const name = r.name.toLowerCase();
      let score = 0;
      let first = -1;
      for (const term of terms) {
        const tag = term.startsWith("#") ? term.slice(1) : null;
        if (tag !== null) {
          if (!r.tags.some((t) => t.toLowerCase() === tag || t.toLowerCase().startsWith(`${tag}/`))) {
            score = 0;
            break;
          }
          score += 5;
          continue;
        }
        const i = hay.indexOf(term);
        if (i < 0 && !name.includes(term)) {
          score = 0;
          break;
        }
        score += (name.includes(term) ? 10 : 0) + (i >= 0 ? 1 : 0);
        if (first < 0 && i >= 0) first = i;
      }
      if (score === 0) continue;
      const text = this.read(r.path);
      const snippet = first >= 0 ? text.slice(Math.max(0, first - 40), first + 80).replace(/\s+/g, " ") : "";
      hits.push({ record: r, score, snippet });
    }
    return hits.sort((a, b) => b.score - a.score || a.record.name.localeCompare(b.record.name));
  }
}
