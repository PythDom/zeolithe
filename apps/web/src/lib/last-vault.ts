/**
 * Remember the last opened vault folder (File System Access handle) in
 * IndexedDB, so the portable app can reopen it with one click. Browsers ask
 * the user to confirm access again in each new session.
 */
const DB = "zeolite";
const STORE = "handles";
const KEY = "lastVault";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLastVault(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put(handle, KEY));
  } catch {
    // Storage unavailable (private window…): reopening is just not offered.
  }
}

export async function loadLastVault(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return (await tx("readonly", (s) => s.get(KEY))) as FileSystemDirectoryHandle | undefined;
  } catch {
    return undefined;
  }
}

/** Ask for read/write access again (must run from a click). */
export async function regainAccess(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & {
    queryPermission(o: object): Promise<PermissionState>;
    requestPermission(o: object): Promise<PermissionState>;
  };
  const opts = { mode: "readwrite" };
  if ((await h.queryPermission(opts)) === "granted") return true;
  return (await h.requestPermission(opts)) === "granted";
}
