/**
 * Native shells: Windows (Tauri) and Android (Capacitor). Each provides a
 * VaultStorage over the real file system, a way to pick the vault folder and
 * a way to save a file elsewhere (PDF export). The web build never loads these
 * modules unless it runs inside one of the shells.
 */
import { IGNORED_DIRS, type VaultStorage } from "./storage";

export type Platform = "tauri" | "android" | "web";

export function platform(): Platform {
  if (typeof window === "undefined") return "web";
  if ("__TAURI_INTERNALS__" in window) return "tauri";
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } }).Capacitor;
  if (cap?.isNativePlatform?.() && cap.getPlatform?.() === "android") return "android";
  return "web";
}

const LAST_PATH = "zeolite.lastVaultPath";

export function lastVaultPath(): string | null {
  try {
    return localStorage.getItem(LAST_PATH);
  } catch {
    return null;
  }
}

export function rememberVaultPath(path: string) {
  try {
    localStorage.setItem(LAST_PATH, path);
  } catch {
    // Not remembered; the folder is simply asked again next time.
  }
}

const folderName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

// ---------------------------------------------------------------------------
// Windows / desktop (Tauri)

export class TauriStorage implements VaultStorage {
  constructor(readonly root: string) {}

  get name() {
    return folderName(this.root);
  }

  private abs(path: string) {
    return `${this.root.replace(/[\\/]+$/, "")}/${path}`;
  }

  async list(): Promise<string[]> {
    const { readDir } = await import("@tauri-apps/plugin-fs");
    const out: string[] = [];
    const walk = async (rel: string) => {
      for (const e of await readDir(rel ? this.abs(rel) : this.root)) {
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory) {
          if (!IGNORED_DIRS.has(e.name)) await walk(p);
        } else if (e.isFile) out.push(p);
      }
    };
    await walk("");
    return out;
  }

  async readText(path: string) {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    return readTextFile(this.abs(path));
  }

  async readBinary(path: string) {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    return new Blob([await readFile(this.abs(path))]);
  }

  private async ensureDir(path: string) {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (!dir) return;
    const { mkdir, exists } = await import("@tauri-apps/plugin-fs");
    if (!(await exists(this.abs(dir)))) await mkdir(this.abs(dir), { recursive: true });
  }

  async writeText(path: string, text: string) {
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await this.ensureDir(path);
    await writeTextFile(this.abs(path), text);
  }

  async writeBinary(path: string, data: Blob) {
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    await this.ensureDir(path);
    await writeFile(this.abs(path), new Uint8Array(await data.arrayBuffer()));
  }

  async rename(from: string, to: string) {
    const { rename, exists } = await import("@tauri-apps/plugin-fs");
    if (await exists(this.abs(to))) throw new Error(`Already exists: ${to}`);
    await this.ensureDir(to);
    await rename(this.abs(from), this.abs(to));
  }

  async remove(path: string) {
    const { remove } = await import("@tauri-apps/plugin-fs");
    await remove(this.abs(path));
  }

  /** Ask for the vault folder. The choice is kept in the app's file access scope across restarts. */
  static async pick(): Promise<TauriStorage | null> {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const dir = await open({ directory: true, recursive: true, title: "Choose your vault folder" });
    if (typeof dir !== "string") return null;
    await TauriStorage.allow(dir);
    return new TauriStorage(dir);
  }

  /** Reopen a folder chosen earlier (null if it is gone or no longer allowed). */
  static async reopen(path: string): Promise<TauriStorage | null> {
    try {
      await TauriStorage.allow(path);
      const { exists } = await import("@tauri-apps/plugin-fs");
      return (await exists(path)) ? new TauriStorage(path) : null;
    } catch {
      return null;
    }
  }

  /** Extend access to the whole vault, hidden folders included (.obsidian, .trash). */
  private static async allow(path: string) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("allow_vault", { path });
  }
}

/** Save a file with the system "Save as" dialog. Returns the saved path or null if cancelled. */
export async function tauriSaveAs(name: string, data: Blob): Promise<string | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  const ext = name.split(".").pop() ?? "";
  const path = await save({ defaultPath: name, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [] });
  if (!path) return null;
  await writeFile(path, new Uint8Array(await data.arrayBuffer()));
  return path;
}

// ---------------------------------------------------------------------------
// Android (Capacitor)

/** Primary shared storage on Android ("Internal storage" in file managers). */
export const ANDROID_ROOT = "/storage/emulated/0";

interface AllFilesAccessPlugin {
  check(): Promise<{ granted: boolean }>;
  request(): Promise<void>;
}

async function allFiles(): Promise<AllFilesAccessPlugin> {
  const { registerPlugin } = await import("@capacitor/core");
  return registerPlugin<AllFilesAccessPlugin>("AllFilesAccess");
}

/** Whether the app may read and write ordinary folders (Android "All files access"). */
export async function androidHasAccess(): Promise<boolean> {
  try {
    return (await (await allFiles()).check()).granted;
  } catch {
    return false;
  }
}

/** Open the system screen where the user allows "All files access" for Zeolite. */
export async function androidRequestAccess(): Promise<void> {
  await (await allFiles()).request();
}

/** Resolve when the app comes back to the foreground (after the settings screen). */
export async function onAndroidResume(cb: () => void): Promise<() => void> {
  const { App } = await import("@capacitor/app");
  const handle = await App.addListener("resume", cb);
  return () => void handle.remove();
}

/** Sub-folders of an absolute Android path (for the in-app folder browser). */
export async function androidListFolders(path: string): Promise<string[]> {
  const { Filesystem } = await import("@capacitor/filesystem");
  const { files } = await Filesystem.readdir({ path });
  return files
    .filter((f) => f.type === "directory" && !f.name.startsWith("."))
    .map((f) => f.name)
    .sort((a, b) => a.localeCompare(b));
}

const base64ToBlob = (b64: string) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes]);
};

async function blobToBase64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class CapacitorStorage implements VaultStorage {
  constructor(readonly root: string) {}

  get name() {
    return folderName(this.root);
  }

  private abs(path: string) {
    return `${this.root.replace(/\/+$/, "")}/${path}`;
  }

  async list(): Promise<string[]> {
    const { Filesystem } = await import("@capacitor/filesystem");
    const out: string[] = [];
    const walk = async (rel: string) => {
      const { files } = await Filesystem.readdir({ path: rel ? this.abs(rel) : this.root });
      for (const f of files) {
        const p = rel ? `${rel}/${f.name}` : f.name;
        if (f.type === "directory") {
          if (!IGNORED_DIRS.has(f.name)) await walk(p);
        } else out.push(p);
      }
    };
    await walk("");
    return out;
  }

  async readText(path: string) {
    const { Filesystem, Encoding } = await import("@capacitor/filesystem");
    const r = await Filesystem.readFile({ path: this.abs(path), encoding: Encoding.UTF8 });
    return typeof r.data === "string" ? r.data : await r.data.text();
  }

  async readBinary(path: string) {
    const { Filesystem } = await import("@capacitor/filesystem");
    const r = await Filesystem.readFile({ path: this.abs(path) });
    return typeof r.data === "string" ? base64ToBlob(r.data) : r.data;
  }

  async writeText(path: string, text: string) {
    const { Filesystem, Encoding } = await import("@capacitor/filesystem");
    await Filesystem.writeFile({ path: this.abs(path), data: text, encoding: Encoding.UTF8, recursive: true });
  }

  async writeBinary(path: string, data: Blob) {
    const { Filesystem } = await import("@capacitor/filesystem");
    await Filesystem.writeFile({ path: this.abs(path), data: await blobToBase64(data), recursive: true });
  }

  async rename(from: string, to: string) {
    const { Filesystem } = await import("@capacitor/filesystem");
    try {
      await Filesystem.stat({ path: this.abs(to) });
      throw new Error(`Already exists: ${to}`);
    } catch (e) {
      if ((e as Error).message.startsWith("Already exists")) throw e;
    }
    const dir = to.includes("/") ? to.slice(0, to.lastIndexOf("/")) : "";
    if (dir) await Filesystem.mkdir({ path: this.abs(dir), recursive: true }).catch(() => {});
    await Filesystem.rename({ from: this.abs(from), to: this.abs(to) });
  }

  async remove(path: string) {
    const { Filesystem } = await import("@capacitor/filesystem");
    await Filesystem.deleteFile({ path: this.abs(path) });
  }

  static async reopen(path: string): Promise<CapacitorStorage | null> {
    try {
      const { Filesystem } = await import("@capacitor/filesystem");
      await Filesystem.readdir({ path });
      return new CapacitorStorage(path);
    } catch {
      return null;
    }
  }
}
