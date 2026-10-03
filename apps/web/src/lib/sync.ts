/**
 * Sync of the vault folder with a WebDAV server: settings (kept per device
 * and per vault in local storage), and one sync run. The decisions are made
 * by planSync in @zeolite/core; this file does the reading and writing.
 */
import { conflictPath, hashBytes, isSyncedPath, planSync, type SyncAction, type SyncBase } from "@zeolite/core";
import type { VaultStorage } from "./storage";
import { WebDavClient } from "./webdav";

export interface SyncSettings {
  url: string;
  username: string;
  password: string;
  /** Minutes between automatic syncs (0: only on opening and with the button). */
  every: number;
}

const key = (vault: string) => `zeolite.sync.${vault}`;

export function loadSyncSettings(vault: string): SyncSettings | null {
  try {
    const raw = localStorage.getItem(key(vault));
    return raw ? (JSON.parse(raw) as SyncSettings) : null;
  } catch {
    return null;
  }
}

export function saveSyncSettings(vault: string, s: SyncSettings | null) {
  try {
    if (s) localStorage.setItem(key(vault), JSON.stringify(s));
    else localStorage.removeItem(key(vault));
  } catch {
    // Not kept: asked again next time.
  }
}

/** Sync state of this device, kept in the vault (never synced itself). */
export const SYNC_STATE_PATH = ".zeolite/sync.json";

interface SyncState {
  url: string;
  lastSync: string;
  files: Record<string, SyncBase>;
}

export interface SyncReport {
  uploaded: string[];
  downloaded: string[];
  deletedLocal: string[];
  deletedRemote: string[];
  /** Conflict copies created (the server's version of notes changed on both sides). */
  conflicts: string[];
  errors: string[];
  /** Whether files in the vault folder changed (the app reloads the vault). */
  localChanged: boolean;
}

export interface SyncOptions {
  /** Asked before deleting many files on one side; false keeps them (they are copied back instead). */
  confirmDeletes: (count: number, side: "server" | "device", sample: string[]) => Promise<boolean>;
  onProgress?: (done: number, total: number) => void;
  now?: Date;
}

async function readState(storage: VaultStorage, url: string): Promise<Record<string, SyncBase>> {
  try {
    const s = JSON.parse(await storage.readText(SYNC_STATE_PATH)) as SyncState;
    // Another server or folder: start again (nothing is deleted on a first sync).
    return s.url === url ? s.files : {};
  } catch {
    return {};
  }
}

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

/** Modification time and size of a local file, when the storage can tell. */
async function stampOf(storage: VaultStorage, path: string): Promise<string | undefined> {
  if (!storage.stat) return undefined;
  try {
    const s = await storage.stat(path);
    return `${s.mtime}:${s.size}`;
  } catch {
    return undefined;
  }
}

/** Many deletions at once usually mean a wrong folder: ask first. */
const tooMany = (n: number, known: number) => n > 5 && n > known * 0.3;

export async function runSync(storage: VaultStorage, client: WebDavClient, opts: SyncOptions): Promise<SyncReport> {
  const report: SyncReport = { uploaded: [], downloaded: [], deletedLocal: [], deletedRemote: [], conflicts: [], errors: [], localChanged: false };
  const base = await readState(storage, client.url);

  // Local files and their stamps (modification time + size): files unchanged since the
  // last sync are not read again, only new or modified ones are hashed.
  const stamps = new Map<string, string | undefined>();
  if (storage.scan) {
    for (const e of await storage.scan()) if (isSyncedPath(e.path)) stamps.set(e.path, `${e.mtime}:${e.size}`);
  } else {
    for (const path of await storage.list()) {
      if (isSyncedPath(path)) stamps.set(path, await stampOf(storage, path));
    }
  }
  const local = new Map<string, string>();
  const rehashed = new Set<string>();
  for (const [path, stamp] of stamps) {
    const b = base[path];
    if (stamp && b?.stamp === stamp) local.set(path, b.hash);
    else {
      local.set(path, hashBytes(await bytes(await storage.readBinary(path))));
      rehashed.add(path);
    }
  }
  const remote = await client.list();
  let plan = planSync(local, remote, base);

  const known = Object.keys(base).length;
  const delRemote = plan.filter((a) => a.kind === "deleteRemote");
  if (tooMany(delRemote.length, known) && !(await opts.confirmDeletes(delRemote.length, "server", delRemote.slice(0, 5).map((a) => a.path)))) {
    plan = plan.map((a): SyncAction => (a.kind === "deleteRemote" ? { kind: "download", path: a.path } : a));
  }
  const delLocal = plan.filter((a) => a.kind === "deleteLocal");
  if (tooMany(delLocal.length, known) && !(await opts.confirmDeletes(delLocal.length, "device", delLocal.slice(0, 5).map((a) => a.path)))) {
    plan = plan.map((a): SyncAction => (a.kind === "deleteLocal" ? { kind: "upload", path: a.path } : a));
  }

  const files = { ...base };
  // Touched but identical files: remember the new stamp so they are not re-read next time.
  for (const path of rehashed) {
    const b = base[path];
    if (b && b.hash === local.get(path)) files[path] = { ...b, stamp: stamps.get(path) };
  }
  const now = opts.now ?? new Date();
  const trashDir = `.trash/deleted by sync ${now.toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "-")}`;
  let done = 0;
  opts.onProgress?.(0, plan.length);

  const upload = async (path: string) => {
    const data = await storage.readBinary(path);
    const etag = await client.put(path, data);
    files[path] = { hash: hashBytes(await bytes(data)), etag, stamp: (await stampOf(storage, path)) ?? stamps.get(path) };
  };
  const download = async (path: string) => {
    const data = await client.get(path);
    await storage.writeBinary(path, data);
    files[path] = { hash: hashBytes(await bytes(data)), etag: remote.get(path) ?? "", stamp: await stampOf(storage, path) };
    report.localChanged = true;
  };

  for (const a of plan) {
    try {
      switch (a.kind) {
        case "upload":
          await upload(a.path);
          report.uploaded.push(a.path);
          break;
        case "download":
          await download(a.path);
          report.downloaded.push(a.path);
          break;
        case "deleteRemote":
          await client.remove(a.path);
          delete files[a.path];
          report.deletedRemote.push(a.path);
          break;
        case "deleteLocal": {
          // Into .trash like other deletions, so nothing is lost.
          await storage.rename(a.path, `${trashDir}/${a.path}`);
          delete files[a.path];
          report.deletedLocal.push(a.path);
          report.localChanged = true;
          break;
        }
        case "compare": {
          const theirs = await client.get(a.path);
          const theirHash = hashBytes(await bytes(theirs));
          const ours = local.get(a.path)!;
          if (theirHash === ours) {
            files[a.path] = { hash: ours, etag: remote.get(a.path) ?? "", stamp: stamps.get(a.path) };
            break;
          }
          // Both changed: keep ours as the note, theirs as a conflict copy on both sides.
          const copy = conflictPath(a.path, now);
          await storage.writeBinary(copy, theirs);
          files[copy] = { hash: theirHash, etag: await client.put(copy, theirs), stamp: await stampOf(storage, copy) };
          await upload(a.path);
          report.conflicts.push(copy);
          report.localChanged = true;
          break;
        }
        case "forget":
          delete files[a.path];
          break;
      }
    } catch (e) {
      report.errors.push(`${a.path}: ${(e as Error).message}`);
      // A failed server listing or login fails the whole sync.
      if ((e as { status?: number }).status === 401) throw e;
    }
    opts.onProgress?.(++done, plan.length);
  }

  const state: SyncState = { url: client.url, lastSync: now.toISOString(), files };
  await storage.writeText(SYNC_STATE_PATH, JSON.stringify(state, null, 1));
  return report;
}

export function describeReport(r: SyncReport): string {
  const parts = [
    r.downloaded.length && `${r.downloaded.length} received`,
    r.uploaded.length && `${r.uploaded.length} sent`,
    r.deletedLocal.length + r.deletedRemote.length && `${r.deletedLocal.length + r.deletedRemote.length} deleted`,
    r.conflicts.length && `${r.conflicts.length} conflict${r.conflicts.length > 1 ? "s" : ""} (both versions kept)`,
    r.errors.length && `${r.errors.length} error${r.errors.length > 1 ? "s" : ""}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "everything up to date";
}
