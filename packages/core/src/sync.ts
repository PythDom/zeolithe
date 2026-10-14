/**
 * Two-way sync between the vault folder and a server (WebDAV), decided
 * file by file against the state of the last sync, like Syncthing or
 * Obsidian's Remotely Save:
 *   - changed on one side only → copied to the other side;
 *   - deleted on one side, unchanged on the other → deleted there too;
 *   - changed on both sides → both versions kept: the server's version is
 *     saved next to the note as a Syncthing-style conflict copy.
 * An edit always wins over a deletion. Pure logic; the app does the I/O.
 */

/** What both sides looked like after the last successful sync of a file. */
export interface SyncBase {
  /** Content hash of the local file. */
  hash: string;
  /** Server version (ETag, or modification date and size). */
  etag: string;
  /** Local modification time and size then: an unchanged file is not re-read to hash it. */
  stamp?: string;
}

export type SyncAction =
  | { kind: "upload"; path: string }
  | { kind: "download"; path: string }
  | { kind: "deleteLocal"; path: string }
  | { kind: "deleteRemote"; path: string }
  /** Present on both sides and changed on both (or new on both): compare contents, keep both if different. */
  | { kind: "compare"; path: string }
  /** Gone on both sides: drop it from the sync state. */
  | { kind: "forget"; path: string };

/**
 * Plan a sync. `local` maps paths to content hashes, `remote` maps paths to
 * server versions, `base` is the state saved by the previous sync (empty for
 * the first one, which then never deletes anything).
 */
export function planSync(local: Map<string, string>, remote: Map<string, string>, base: Record<string, SyncBase>): SyncAction[] {
  const paths = new Set([...local.keys(), ...remote.keys(), ...Object.keys(base)]);
  const out: SyncAction[] = [];
  for (const path of [...paths].sort()) {
    const l = local.get(path);
    const r = remote.get(path);
    const b = base[path];
    if (!b) {
      if (l !== undefined && r !== undefined) out.push({ kind: "compare", path });
      else if (l !== undefined) out.push({ kind: "upload", path });
      else if (r !== undefined) out.push({ kind: "download", path });
      continue;
    }
    const localChanged = l !== b.hash;
    const remoteChanged = r !== b.etag;
    if (!localChanged && !remoteChanged) continue;
    if (localChanged && !remoteChanged) out.push(l !== undefined ? { kind: "upload", path } : { kind: "deleteRemote", path });
    else if (!localChanged && remoteChanged) out.push(r !== undefined ? { kind: "download", path } : { kind: "deleteLocal", path });
    else if (l === undefined && r === undefined) out.push({ kind: "forget", path });
    else if (l === undefined) out.push({ kind: "download", path });
    else if (r === undefined) out.push({ kind: "upload", path });
    else out.push({ kind: "compare", path });
  }
  return out;
}

/** Folders and files never synced: hidden ones (.obsidian, .trash, .zeolite…) and conflict-prone system files. */
export function isSyncedPath(path: string): boolean {
  const parts = path.split("/");
  return !parts.some((p) => p.startsWith(".") || p === "node_modules") && !/(^|\/)(desktop\.ini|Thumbs\.db)$/i.test(path);
}

/**
 * Conflict copy name, in Syncthing's format so that the app lists it with
 * the other sync conflicts: `Note.sync-conflict-20261003-142501-SERVER.md`.
 */
export function conflictPath(path: string, date: Date, device = "SERVER"): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const [stem, ext] = dot > slash ? [path.slice(0, dot), path.slice(dot)] : [path, ""];
  return `${stem}.sync-conflict-${stamp}-${device}${ext}`;
}

/** Fast 53-bit content hash (cyrb53) of a file's bytes, with its size. Detects changes, not for security. */
export function hashBytes(data: Uint8Array): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < data.length; i++) {
    const c = data[i]!;
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${data.length.toString(36)}-${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** Normalise a server version: `W/"abc"` and `"abc"` → `abc`. */
export function normaliseEtag(etag: string): string {
  return etag.trim().replace(/^W\//, "").replace(/^"(.*)"$/, "$1");
}

// ---------------------------------------------------------------------------
// Comparing versions of a note

/** Files compared as text, where invisible differences do not count. */
export const isTextPath = (path: string) => /\.(md|markdown|txt|canvas|json|csv)$/i.test(path);

/**
 * A note's text without the differences nobody sees: byte order mark,
 * Windows/old Mac line endings, spaces at the ends of lines, blank lines at
 * the end.
 */
export function normaliseText(text: string): string {
  return text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/, "");
}

/** Same bytes, or (for text files) the same text apart from invisible differences. */
export function sameContent(path: string, a: Uint8Array, b: Uint8Array): boolean {
  if (a.length === b.length && a.every((x, i) => x === b[i])) return true;
  if (!isTextPath(path)) return false;
  const dec = new TextDecoder();
  return normaliseText(dec.decode(a)) === normaliseText(dec.decode(b));
}

export interface DiffLine {
  kind: "same" | "removed" | "added";
  text: string;
}

/**
 * Line differences from `a` to `b` (longest common subsequence), on the
 * normalised texts. Long unchanged stretches are kept: the caller folds them.
 */
export function lineDiff(a: string, b: string): DiffLine[] {
  const x = normaliseText(a).split("\n");
  const y = normaliseText(b).split("\n");
  // Common head and tail first: the table is then only as big as the changed middle.
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let endX = x.length;
  let endY = y.length;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) endX--, endY--;
  const mx = x.slice(start, endX);
  const my = y.slice(start, endY);
  const out: DiffLine[] = x.slice(0, start).map((text) => ({ kind: "same", text }));
  if (mx.length * my.length > 4_000_000) {
    // Too different to align line by line: show the whole change.
    out.push(...mx.map((text): DiffLine => ({ kind: "removed", text })), ...my.map((text): DiffLine => ({ kind: "added", text })));
  } else {
    const n = mx.length;
    const m = my.length;
    const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = mx[i] === my[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && mx[i] === my[j]) out.push({ kind: "same", text: mx[i++]! }), j++;
      else if (i < n && (j >= m || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) out.push({ kind: "removed", text: mx[i++]! });
      else out.push({ kind: "added", text: my[j++]! });
    }
  }
  out.push(...x.slice(endX).map((text): DiffLine => ({ kind: "same", text })));
  return out;
}
