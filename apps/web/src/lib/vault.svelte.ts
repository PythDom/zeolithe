import {
  buildNoteRecord,
  conflictPath,
  oneDriveConflictOf,
  findCollisions,
  isTemplatePath,
  attachmentFolder,
  readObsidianSettings,
  DEFAULT_SETTINGS,
  type VaultSettings,
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
} from "@zeolite/core";
import { MULTI_USER_CHECKS } from "./features";
import { IGNORED_DIRS, type FileStamp, type VaultStorage } from "./storage";

/** Paths inside ignored folders (.obsidian, .trash, .git…) are not shown. */
const visible = (path: string) => !path.split("/").slice(0, -1).some((d) => IGNORED_DIRS.has(d));

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
  /** Every folder on disk, empty ones included (when the storage can list them). */
  dirs = $state<string[]>([]);
  records = $state<Map<string, NoteRecord>>(new Map());
  contents = new Map<string, string>();
  taxonomy = $state<Taxonomy>({ paras: [], categories: [], subParas: {}, warnings: [] });
  /** Object URLs for image attachments, keyed by path. */
  private assetUrls = new Map<string, string>();

  constructor(storage: VaultStorage) {
    this.storage = storage;
  }

  /** Last known modification time and size of each note (when the storage can tell). */
  private stamps = new Map<string, string>();
  /** Saves and disk checks run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }
  private async stamp(path: string) {
    if (!MULTI_USER_CHECKS || !this.storage.stat) return;
    try {
      const s: FileStamp = await this.storage.stat(path);
      this.stamps.set(path, `${s.mtime}:${s.size}`);
    } catch {
      this.stamps.delete(path);
    }
  }
  /**
   * Called when a note was changed by another app (OneDrive, Syncthing, a
   * colleague…) while Zeolite was saving it: the other version is kept as
   * `copy`, Zeolite's version stays the note.
   */
  onConflict: ((path: string, copy: string) => void) | null = null;

  get name() {
    return this.storage.name;
  }

  /** Settings read from the vault's .obsidian folder (templates, daily notes, attachments). */
  settings = $state<VaultSettings>(structuredClone(DEFAULT_SETTINGS));

  private async readOptional(path: string): Promise<string | undefined> {
    try {
      return await this.storage.readText(path);
    } catch {
      return undefined;
    }
  }

  async load() {
    this.settings = readObsidianSettings({
      templates: await this.readOptional(".obsidian/templates.json"),
      dailyNotes: await this.readOptional(".obsidian/daily-notes.json"),
      app: await this.readOptional(".obsidian/app.json"),
    });
    const entries = await this.scanFiles();
    const files = entries.map((e) => e.path).sort((a, b) => a.localeCompare(b));
    const records = new Map<string, NoteRecord>();
    this.stamps.clear();
    for (const { path, stamp } of entries) {
      if (!path.toLowerCase().endsWith(".md")) continue;
      const text = await this.storage.readText(path);
      this.contents.set(path, text);
      records.set(path, buildNoteRecord(path, text));
      if (stamp) this.stamps.set(path, stamp);
      else await this.stamp(path);
    }
    for (const u of this.assetUrls.values()) URL.revokeObjectURL(u);
    this.assetUrls.clear();
    for (const path of files) {
      if (IMAGE_EXT.test(path)) this.assetUrls.set(path, URL.createObjectURL(await this.storage.readBinary(path)));
    }
    this.files = files;
    this.dirs = ((await this.storage.listDirs?.()) ?? []).filter((d) => !d.split("/").some((p) => IGNORED_DIRS.has(p)));
    this.records = records;
    this.refreshTaxonomy();
  }

  private refreshTaxonomy() {
    const text = this.contents.get(TAXONOMY_PATH);
    this.taxonomy = text ? parseTaxonomy(text) : { paras: [], categories: [], subParas: {}, warnings: ["No _system/Taxonomy.md in this vault."] };
  }

  /** Original note of a conflict copy (Syncthing, OneDrive, Zeolite), or null. */
  conflictOf(path: string): string | null {
    const sync = /^(.*)\.sync-conflict-[^/]*\.md$/i.exec(path);
    if (sync) return `${sync[1]}.md`;
    return MULTI_USER_CHECKS ? oneDriveConflictOf(path, (p) => this.records.has(p)) : null;
  }

  /** Notes that count as real notes (conflict copies and templates excluded). */
  get notes(): NoteRecord[] {
    return [...this.records.values()].filter((r) => !r.conflict && !this.conflictOf(r.path) && !isTemplatePath(r.path, this.settings.templatesFolder));
  }

  /** Template note paths (in _system/Templates/). */
  templates(): string[] {
    return this.files.filter((f) => isTemplatePath(f, this.settings.templatesFolder) && f.toLowerCase().endsWith(".md"));
  }

  async remove(path: string) {
    await this.storage.remove(path);
    this.contents.delete(path);
    this.files = this.files.filter((f) => f !== path);
    const next = new Map(this.records);
    next.delete(path);
    this.records = next;
  }

  get conflicts(): NoteRecord[] {
    return [...this.records.values()].filter((r) => r.conflict || this.conflictOf(r.path));
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

  save(path: string, content: string): Promise<void> {
    return this.exclusive(async () => {
      if (this.contents.get(path) === content) return;
      const known = this.contents.get(path);
      // Changed on disk by another app since we read it? Keep that version instead of overwriting it.
      if (MULTI_USER_CHECKS && known !== undefined && this.files.includes(path) && (await this.changedOnDisk(path))) {
        const disk = await this.storage.readText(path).catch(() => undefined);
        if (disk !== undefined && disk !== known && disk !== content) {
          const copy = conflictPath(path, new Date(), "OTHER");
          await this.storage.writeText(copy, disk);
          this.remember(copy, disk);
          await this.stamp(copy);
          this.onConflict?.(path, copy);
        }
      }
      await this.storage.writeText(path, content);
      this.remember(path, content);
      await this.stamp(path);
    });
  }

  /** Whether a note may have been changed by another app since we last read or wrote it. */
  private async changedOnDisk(path: string): Promise<boolean> {
    const known = this.stamps.get(path);
    if (!this.storage.stat || known === undefined) return true;
    try {
      const s = await this.storage.stat(path);
      return `${s.mtime}:${s.size}` !== known;
    } catch {
      return true;
    }
  }

  /** Update the in-memory view of a note. */
  private remember(path: string, content: string) {
    this.contents.set(path, content);
    const next = new Map(this.records);
    next.set(path, buildNoteRecord(path, content));
    this.records = next;
    if (!this.files.includes(path)) this.files = [...this.files, path].sort((a, b) => a.localeCompare(b));
    if (path === TAXONOMY_PATH) this.refreshTaxonomy();
  }

  /** Files with their stamps, in one call when the storage can (Windows app), else list (+ stat). */
  private async scanFiles(): Promise<{ path: string; stamp?: string }[]> {
    if (this.storage.scan) {
      return (await this.storage.scan()).filter((e) => visible(e.path)).map((e) => ({ path: e.path, stamp: `${e.mtime}:${e.size}` }));
    }
    return (await this.storage.list()).filter(visible).map((path) => ({ path }));
  }

  /**
   * Pick up changes made by other apps (OneDrive, Syncthing, a colleague, a
   * text editor): new, changed and deleted files. The folder is read without
   * holding up saves; only applying the result waits for them.
   */
  async checkDisk(): Promise<{ changed: string[]; added: string[]; removed: string[] }> {
    const none = { changed: [] as string[], added: [] as string[], removed: [] as string[] };
    // Moves, deletions, saves… may run meanwhile: then this round is dropped (the next one sees the result).
    const filesAtStart = this.files;
    const recordsAtStart = this.records;
    const entries = await this.scanFiles();
    const now = new Set(entries.map((e) => e.path));
    const before = new Set(filesAtStart);
    const added = entries.map((e) => e.path).filter((f) => !before.has(f));
    const removed = filesAtStart.filter((f) => !now.has(f));
    const changed: string[] = [];
    const texts = new Map<string, string>();
    const stamps = new Map<string, string>();
    for (const { path, stamp } of entries) {
      if (!path.toLowerCase().endsWith(".md") || !before.has(path)) continue;
      let key = stamp;
      if (key === undefined && this.storage.stat) {
        try {
          const s: FileStamp = await this.storage.stat(path);
          key = `${s.mtime}:${s.size}`;
        } catch {
          continue;
        }
      }
      if (key !== undefined) {
        if (this.stamps.get(path) === key) continue;
        stamps.set(path, key);
      }
      const text = await this.storage.readText(path).catch(() => undefined);
      if (text === undefined) continue;
      if (text !== this.contents.get(path)) {
        changed.push(path);
        texts.set(path, text);
      }
    }
    for (const { path, stamp } of entries) {
      if (!added.includes(path)) continue;
      if (path.toLowerCase().endsWith(".md")) texts.set(path, await this.storage.readText(path).catch(() => ""));
      if (stamp) stamps.set(path, stamp);
    }
    const images = new Map<string, Blob>();
    for (const path of added) {
      if (IMAGE_EXT.test(path)) {
        const blob = await this.storage.readBinary(path).catch(() => null);
        if (blob) images.set(path, blob);
      }
    }
    return this.exclusive(async () => {
      if (this.files !== filesAtStart || this.records !== recordsAtStart) return none;
      for (const [p, k] of stamps) this.stamps.set(p, k);
      if (!added.length && !removed.length && !changed.length) return none;
      const next = new Map(this.records);
      for (const path of removed) {
        next.delete(path);
        this.contents.delete(path);
        this.stamps.delete(path);
        const url = this.assetUrls.get(path);
        if (url) URL.revokeObjectURL(url);
        this.assetUrls.delete(path);
      }
      for (const [path, text] of texts) {
        this.contents.set(path, text);
        next.set(path, buildNoteRecord(path, text));
      }
      for (const path of added) if (path.toLowerCase().endsWith(".md") && !stamps.has(path)) await this.stamp(path);
      for (const [path, blob] of images) this.assetUrls.set(path, URL.createObjectURL(blob));
      this.files = [...now].sort((a, b) => a.localeCompare(b));
      this.records = next;
      if ([...changed, ...added, ...removed].includes(TAXONOMY_PATH)) this.refreshTaxonomy();
      return { changed, added, removed };
    });
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

  /**
   * Move a note to the vault's .trash folder (like Obsidian), so it can be
   * recovered from the file system. Returns the trash path.
   */
  async trash(path: string): Promise<string> {
    const name = path.split("/").pop()!;
    let target = `.trash/${name}`;
    const all = await this.storage.list();
    for (let i = 1; all.includes(target); i++) target = `.trash/${name.replace(/(\.[^.]*)?$/, ` ${i}$1`)}`;
    await this.storage.rename(path, target);
    this.contents.delete(path);
    this.files = this.files.filter((f) => f !== path);
    const next = new Map(this.records);
    next.delete(path);
    this.records = next;
    if (path === TAXONOMY_PATH) this.refreshTaxonomy();
    return target;
  }

  /** Files inside a folder (any depth). */
  filesIn(folder: string): string[] {
    return this.files.filter((f) => f.startsWith(`${folder}/`));
  }

  /**
   * Move a whole folder to .trash (like Obsidian), keeping its structure:
   * `Projects/a.md` → `.trash/Projects/a.md`. Returns the trash folder.
   */
  async trashFolder(folder: string): Promise<string> {
    const files = this.filesIn(folder);
    const name = folder.split("/").pop()!;
    const all = new Set(await this.storage.list());
    let target = `.trash/${name}`;
    for (let i = 1; [...all].some((f) => f.startsWith(`${target}/`)); i++) target = `.trash/${name} ${i}`;
    for (const f of files) await this.storage.rename(f, `${target}/${f.slice(folder.length + 1)}`);
    // The emptied folder itself (may hold hidden or ignored files we do not track).
    await this.storage.removeDir?.(folder).catch(() => {});
    this.dirs = this.dirs.filter((d) => d !== folder && !d.startsWith(`${folder}/`));
    const gone = new Set(files);
    for (const f of files) this.contents.delete(f);
    this.files = this.files.filter((f) => !gone.has(f));
    const next = new Map(this.records);
    for (const f of files) next.delete(f);
    this.records = next;
    if (files.includes(TAXONOMY_PATH)) this.refreshTaxonomy();
    return target;
  }

  /** Notes outside a folder that link to notes inside it. */
  linksIntoFolder(folder: string): NoteRecord[] {
    const inside = this.notes.filter((r) => r.path.startsWith(`${folder}/`)).map((r) => r.path);
    const set = new Set(this.notes.filter((r) => !r.path.startsWith(`${folder}/`)).flatMap((r) => (inside.some((p) => this.backlinks(p).includes(r)) ? [r] : [])));
    return [...set];
  }

  /** Notes that link to (or embed) a note. */
  backlinks(path: string): NoteRecord[] {
    const name = linkNameOf(path);
    const bare = path.replace(/\.md$/i, "");
    return this.notes.filter((r) => r.path !== path && r.links.some((l) => l.target === name || l.target === bare || linkNameOf(l.target) === name));
  }

  async addAttachment(file: Blob, name: string, notePath: string | null = null): Promise<string> {
    const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, "-");
    const dir = attachmentFolder(this.settings, notePath);
    const at = (n: string) => (dir ? `${dir}/${n}` : n);
    let path = at(clean);
    for (let i = 1; this.files.includes(path); i++) path = at(clean.replace(/(\.[^.]*)?$/, ` ${i}$1`));
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

  /**
   * Shortest link target that opens this file, like Obsidian: the note name
   * (or attachment file name), or the path when another file has the same name.
   */
  linkText(path: string): string {
    const isNote = /\.md$/i.test(path);
    const name = isNote ? linkNameOf(path) : path.split("/").pop()!;
    const same = this.files.filter((f) => (isNote ? /\.md$/i.test(f) && linkNameOf(f) === name : f.split("/").pop() === name));
    if (same.length <= 1) return name;
    return isNote ? path.replace(/\.md$/i, "") : path;
  }

  /** Files that are not notes (images, PDFs…), for links and embeds. */
  attachments(): string[] {
    return this.files.filter((f) => !/\.md$/i.test(f) && !isTemplatePath(f, this.settings.templatesFolder));
  }

  /** Vault path of an attachment, matched by path or file name. */
  resolveAssetPath(target: string): string | undefined {
    if (this.files.includes(target)) return target;
    const name = target.split("/").pop();
    return this.files.find((f) => f.split("/").pop() === name);
  }

  async readAsset(target: string): Promise<Blob | undefined> {
    const path = this.resolveAssetPath(target);
    return path ? this.storage.readBinary(path) : undefined;
  }

  /** Write a binary file (e.g. an export), replacing any existing one. */
  async writeFile(path: string, data: Blob): Promise<string> {
    await this.storage.writeBinary(path, data);
    if (!this.files.includes(path)) this.files = [...this.files, path].sort((a, b) => a.localeCompare(b));
    return path;
  }

  resolveAsset(target: string): string | undefined {
    const direct = this.assetUrls.get(target);
    if (direct) return direct;
    const name = target.split("/").pop();
    for (const [path, url] of this.assetUrls) if (path.split("/").pop() === name) return url;
    return undefined;
  }

  runQuery(source: string, thisPath?: string): QueryResult {
    return runQuery(source, this.notes, new Date(), thisPath);
  }

  /** Folders that contain notes, plus the folders on disk (empty ones included). */
  folders(): string[] {
    const set = new Set<string>(this.dirs);
    for (const r of this.notes) {
      const parts = r.folder.split("/");
      for (let i = 1; i <= parts.length; i++) if (parts[0]) set.add(parts.slice(0, i).join("/"));
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  /** Whether a folder exists (case-insensitive, like Windows and Android file systems). */
  folderExists(folder: string): boolean {
    const f = folder.toLowerCase();
    return this.folders().some((d) => d.toLowerCase() === f) || this.files.some((p) => p.toLowerCase().startsWith(`${f}/`));
  }

  /** Create an empty folder (and its parents). */
  async createFolder(folder: string) {
    if (this.folderExists(folder)) throw new Error(`The folder “${folder}” already exists.`);
    if (!this.storage.makeDir) throw new Error("This vault cannot create empty folders; create a note in the new folder instead.");
    await this.storage.makeDir(folder);
    const parts = folder.split("/");
    const add = parts.map((_, i) => parts.slice(0, i + 1).join("/")).filter((d) => !this.dirs.includes(d));
    this.dirs = [...this.dirs, ...add].sort((a, b) => a.localeCompare(b));
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
