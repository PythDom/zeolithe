/**
 * The only platform-specific part of the app. The shared UI talks to a vault
 * through this interface; each shell provides an implementation:
 *   - MemoryStorage:    demo vault, tests
 *   - FsAccessStorage:  desktop Chromium/Edge (File System Access API), dev
 *   - Tauri / Capacitor implementations: next step (native shells)
 * Paths are vault-relative and use "/" separators.
 */
export interface VaultStorage {
  readonly name: string;
  /** Every file in the vault (excluding ignored folders). */
  list(): Promise<string[]>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  readBinary(path: string): Promise<Blob>;
  writeBinary(path: string, data: Blob): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Remove a folder that has been emptied (optional; left in place otherwise). */
  removeDir?(path: string): Promise<void>;
  /** Every folder, empty ones included, so that they can be shown (optional). */
  listDirs?(): Promise<string[]>;
  /** Create a folder and its parents (optional; without it a folder exists once a note is saved in it). */
  makeDir?(path: string): Promise<void>;
  /** Modification time and size, to notice files changed by other apps cheaply (optional). */
  stat?(path: string): Promise<FileStamp>;
  /** Every file with its modification time and size, in one go (optional; faster than list + stat). */
  scan?(): Promise<ScanEntry[]>;
}

export interface ScanEntry extends FileStamp {
  path: string;
}

export interface FileStamp {
  mtime: number;
  size: number;
}

/** Folders never read or written by the app. */
export const IGNORED_DIRS = new Set([".obsidian", ".git", ".trash", ".zeolite", ".stfolder", ".stversions", "node_modules"]);

export class MemoryStorage implements VaultStorage {
  private files = new Map<string, string | Blob>();
  private dirs = new Set<string>();
  constructor(
    readonly name: string,
    seed: Record<string, string | Blob> = {},
  ) {
    for (const [k, v] of Object.entries(seed)) this.files.set(k, v);
  }
  async list() {
    return [...this.files.keys()];
  }
  async readText(path: string) {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`Not found: ${path}`);
    return typeof f === "string" ? f : await f.text();
  }
  async writeText(path: string, text: string) {
    this.files.set(path, text);
  }
  async readBinary(path: string) {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`Not found: ${path}`);
    return typeof f === "string" ? new Blob([f]) : f;
  }
  async writeBinary(path: string, data: Blob) {
    this.files.set(path, data);
  }
  async rename(from: string, to: string) {
    const f = this.files.get(from);
    if (f === undefined) throw new Error(`Not found: ${from}`);
    if (this.files.has(to)) throw new Error(`Already exists: ${to}`);
    this.files.delete(from);
    this.files.set(to, f);
  }
  async remove(path: string) {
    this.files.delete(path);
  }
  async listDirs() {
    const out = new Set(this.dirs);
    for (const f of this.files.keys()) {
      const parts = f.split("/").slice(0, -1);
      for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join("/"));
    }
    return [...out];
  }
  async makeDir(path: string) {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) this.dirs.add(parts.slice(0, i).join("/"));
  }
  async removeDir(path: string) {
    for (const d of [...this.dirs]) if (d === path || d.startsWith(`${path}/`)) this.dirs.delete(d);
    for (const f of [...this.files.keys()]) if (f.startsWith(`${path}/`)) this.files.delete(f);
  }
}

// --- File System Access API (Chromium desktop) -----------------------------

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
};

export function fsAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/**
 * Why this page cannot open a vault folder for editing, in plain words, or
 * null when it can.
 */
export function folderAccessProblem(): string | null {
  if (fsAccessSupported()) return null;
  const ua = navigator.userAgent;
  let embedded = false;
  try {
    embedded = window.top !== window.self;
  } catch {
    embedded = true;
  }
  if (embedded)
    return "Zeolite is shown inside another app's viewer, which does not allow folder access. Save Zeolite.html to your computer, then open the saved file directly in Microsoft Edge or Google Chrome (right-click the file → Open with).";
  if (!window.isSecureContext)
    return "The page was opened from an address the browser does not trust for folder access. Open Zeolite.html from your disk (file) or over https.";
  if ((navigator as Navigator & { brave?: unknown }).brave)
    return "Brave turns folder access off by default. Use Edge or Chrome, or enable brave://flags/#file-system-access-api and restart Brave.";
  if (/Firefox\//.test(ua)) return "Firefox cannot open folders for editing. Open Zeolite.html with Microsoft Edge or Google Chrome.";
  if (/Android|iPhone|iPad/.test(ua)) return "Mobile browsers cannot open folders for editing. The Android app will.";
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return "Safari cannot open folders for editing. Open Zeolite.html with Microsoft Edge or Google Chrome.";
  return "This browser does not offer folder access (it may be turned off by your organisation). Open Zeolite.html with a recent Microsoft Edge or Google Chrome.";
}

/** Folder chosen with <input webkitdirectory>, as an in-memory copy (read-only for the files on disk). */
export async function memoryCopyFromFiles(files: FileList): Promise<MemoryStorage> {
  const list = [...files];
  const root = list[0]?.webkitRelativePath.split("/")[0] ?? "Vault";
  const seed: Record<string, string | Blob> = {};
  for (const f of list) {
    const rel = f.webkitRelativePath.split("/").slice(1).join("/");
    if (!rel || rel.split("/").slice(0, -1).some((d) => IGNORED_DIRS.has(d) && d !== ".obsidian")) continue;
    seed[rel] = /\.(md|json)$/i.test(rel) ? await f.text() : f;
  }
  return new MemoryStorage(`${root} (read-only copy)`, seed);
}

export class FsAccessStorage implements VaultStorage {
  constructor(private root: DirHandle) {}

  /** The folder handle (remembered to reopen the vault later). */
  get handle(): FileSystemDirectoryHandle {
    return this.root;
  }

  static fromHandle(handle: FileSystemDirectoryHandle): FsAccessStorage {
    return new FsAccessStorage(handle as DirHandle);
  }

  static async pick(): Promise<FsAccessStorage> {
    const picker = (window as unknown as { showDirectoryPicker(o: object): Promise<DirHandle> }).showDirectoryPicker;
    return new FsAccessStorage(await picker({ mode: "readwrite" }));
  }

  get name() {
    return this.root.name;
  }

  async list() {
    const out: string[] = [];
    const walk = async (dir: DirHandle, prefix: string) => {
      for await (const h of dir.values()) {
        if (h.kind === "directory") {
          if (!IGNORED_DIRS.has(h.name)) await walk(h as DirHandle, `${prefix}${h.name}/`);
        } else {
          out.push(prefix + h.name);
        }
      }
    };
    await walk(this.root, "");
    return out;
  }

  async scan() {
    const out: ScanEntry[] = [];
    const walk = async (dir: DirHandle, prefix: string) => {
      for await (const h of dir.values()) {
        if (h.kind === "directory") {
          if (!IGNORED_DIRS.has(h.name)) await walk(h as DirHandle, `${prefix}${h.name}/`);
        } else {
          const f = await (h as FileSystemFileHandle).getFile();
          out.push({ path: prefix + h.name, mtime: f.lastModified, size: f.size });
        }
      }
    };
    await walk(this.root, "");
    return out;
  }

  async listDirs() {
    const out: string[] = [];
    const walk = async (dir: DirHandle, prefix: string) => {
      for await (const h of dir.values()) {
        if (h.kind === "directory" && !IGNORED_DIRS.has(h.name)) {
          out.push(prefix + h.name);
          await walk(h as DirHandle, `${prefix}${h.name}/`);
        }
      }
    };
    await walk(this.root, "");
    return out;
  }

  async makeDir(path: string) {
    let dir = this.root;
    for (const p of path.split("/")) dir = (await dir.getDirectoryHandle(p, { create: true })) as DirHandle;
  }

  private async dirOf(path: string, create: boolean): Promise<[DirHandle, string]> {
    const parts = path.split("/");
    const name = parts.pop()!;
    let dir = this.root;
    for (const p of parts) dir = (await dir.getDirectoryHandle(p, { create })) as DirHandle;
    return [dir, name];
  }

  private async file(path: string): Promise<File> {
    const [dir, name] = await this.dirOf(path, false);
    return (await dir.getFileHandle(name)).getFile();
  }

  async readText(path: string) {
    return (await this.file(path)).text();
  }
  async stat(path: string) {
    const f = await this.file(path);
    return { mtime: f.lastModified, size: f.size };
  }
  async readBinary(path: string) {
    return this.file(path);
  }
  private async write(path: string, data: string | Blob) {
    const [dir, name] = await this.dirOf(path, true);
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(data);
    await w.close();
  }
  async writeText(path: string, text: string) {
    await this.write(path, text);
  }
  async writeBinary(path: string, data: Blob) {
    await this.write(path, data);
  }
  async rename(from: string, to: string) {
    await this.write(to, await this.file(from));
    await this.remove(from);
  }
  async remove(path: string) {
    const [dir, name] = await this.dirOf(path, false);
    await dir.removeEntry(name);
  }

  async removeDir(path: string) {
    const [dir, name] = await this.dirOf(path, false);
    await dir.removeEntry(name, { recursive: true });
  }
}
