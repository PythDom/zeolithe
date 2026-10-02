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
}

/** Folders never read or written by the app. */
export const IGNORED_DIRS = new Set([".obsidian", ".git", ".trash", ".stfolder", ".stversions", "node_modules"]);

export class MemoryStorage implements VaultStorage {
  private files = new Map<string, string | Blob>();
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
}

// --- File System Access API (Chromium desktop) -----------------------------

type DirHandle = FileSystemDirectoryHandle & {
  values(): AsyncIterable<FileSystemHandle>;
};

export function fsAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
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
}
