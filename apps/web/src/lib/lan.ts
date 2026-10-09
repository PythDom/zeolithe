/**
 * Direct sync over the local network (Wi-Fi). The Windows app shares its open
 * vault ("Share with a phone or tablet"); a phone, tablet or another Zeolite
 * syncs with it using the same engine as WebDAV and OneDrive.
 */
import { isSyncedPath } from "@zeolite/core";

export class LanError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

/** Default port of the PC's sharing server. */
export const LAN_PORT = 47123;

/** "192.168.1.20", "192.168.1.20:47123" or a full URL → http://host:port */
export function lanAddress(input: string): string {
  let s = input.trim().replace(/\/+$/, "");
  if (!s) throw new LanError("Enter the address shown on the PC.");
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new LanError(`“${input}” is not an address.`);
  }
  if (!u.port) u.port = String(LAN_PORT);
  return `${u.protocol}//${u.host}`;
}

/** Pairing codes are shown in groups (K7P4-QX9M); spaces, dashes and case do not matter. */
export const normaliseCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** A new pairing code: 8 characters without look-alikes (0/O, 1/I). */
export function newPairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export const formatCode = (code: string) => code.replace(/^(.{4})(.+)$/, "$1-$2");

/** Sync remote for runSync: the vault shared by a PC on the same network. */
export class LanClient {
  private readonly base: string;
  private readonly code: string;

  constructor(address: string, code: string) {
    this.base = lanAddress(address);
    this.code = normaliseCode(code);
    if (this.code.length < 6) throw new LanError("Enter the pairing code shown on the PC.");
  }

  get url() {
    return `lan:${this.base}`;
  }

  private async request(method: string, route: string, body?: Blob): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/zeolite/v1/${route}`, {
        method,
        body,
        headers: { Authorization: `Bearer ${this.code}` },
        cache: "no-store",
      });
    } catch {
      throw new LanError(
        `Cannot reach the PC at ${this.base.replace(/^http:\/\//, "")}. Check that both are on the same Wi-Fi, that sharing is on in Zeolite on the PC, and that Windows allowed Zeolite on private networks.`,
      );
    }
    if (res.ok) return res;
    if (res.status === 401) throw new LanError("The PC refused the pairing code. Check it (⇅ on the PC shows it).", 401);
    let message = `${res.status} ${res.statusText}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* keep the status */
    }
    throw new LanError(`PC: ${message}`, res.status);
  }

  async test(): Promise<"ok" | "created"> {
    const info = (await (await this.request("GET", "info")).json()) as { app?: string };
    if (info.app !== "zeolite") throw new LanError("This address is not a Zeolite PC.");
    return "ok";
  }

  /** Name of the vault the PC shares. */
  async vaultName(): Promise<string> {
    return ((await (await this.request("GET", "info")).json()) as { name?: string }).name ?? "";
  }

  async list(): Promise<Map<string, string>> {
    const { files } = (await (await this.request("GET", "list")).json()) as { files: Record<string, string> };
    return new Map(Object.entries(files).filter(([p]) => isSyncedPath(p)));
  }

  async get(path: string): Promise<Blob> {
    return (await this.request("GET", `file?path=${encodeURIComponent(path)}`)).blob();
  }

  async put(path: string, data: Blob): Promise<string> {
    return ((await (await this.request("PUT", `file?path=${encodeURIComponent(path)}`, data)).json()) as { version: string }).version;
  }

  async remove(path: string): Promise<void> {
    await this.request("DELETE", `file?path=${encodeURIComponent(path)}`);
  }
}

// --- Sharing (Windows app) ----------------------------------------------------

export interface SharingInfo {
  ip: string | null;
  port: number;
}

export async function startSharing(vaultPath: string, name: string, code: string, port = LAN_PORT): Promise<SharingInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SharingInfo>("lan_start", { path: vaultPath, name, token: normaliseCode(code), port });
}

export async function stopSharing(): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("lan_stop");
}

export async function sharingStatus(): Promise<SharingInfo | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<SharingInfo | null>("lan_status");
}

/** Called with the paths a device wrote or deleted. */
export async function onSharedChange(cb: (paths: string[]) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string[]>("lan-changed", (e) => cb(e.payload));
}
