/**
 * Direct sync over the local network (Wi-Fi). One device shares its open vault
 * (the Windows app, or the Android app — useful when the PC's firewall cannot
 * be opened without administrator rights); the others sync with it using the
 * same engine as WebDAV and OneDrive.
 */
import { isSyncedPath } from "@zeolite/core";
import { platform } from "./native";

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
  if (!s) throw new LanError("Enter the address shown on the sharing device.");
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

/** Sync remote for runSync: the vault shared by another device on the same network. */
export class LanClient {
  private readonly base: string;
  private readonly code: string;

  constructor(address: string, code: string) {
    this.base = lanAddress(address);
    this.code = normaliseCode(code);
    if (this.code.length < 6) throw new LanError("Enter the pairing code shown on the sharing device.");
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
        `Cannot reach ${this.base.replace(/^http:\/\//, "")}. Check the address (as shown on the sharing device), that both are on the same Wi-Fi, and that sharing is on there. A Windows PC that shares needs Zeolite allowed in its firewall (administrator rights); otherwise share from the phone or tablet instead.`,
      );
    }
    if (res.ok) return res;
    if (res.status === 401) throw new LanError("The pairing code was refused. Check it (⇅ on the sharing device shows it).", 401);
    let message = `${res.status} ${res.statusText}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* keep the status */
    }
    throw new LanError(`Sharing device: ${message}`, res.status);
  }

  async test(): Promise<"ok" | "created"> {
    const info = (await (await this.request("GET", "info")).json()) as { app?: string };
    if (info.app !== "zeolite") throw new LanError("This address is not a device sharing a Zeolite vault.");
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

// --- Sharing (Windows and Android apps) ------------------------------------------

export interface SharingInfo {
  /** This device's addresses on the network, the most likely first. */
  ips: string[];
  port: number;
}

/** Tauri commands reject with the Rust error as plain text: make it an Error. */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new LanError(typeof e === "string" ? e : ((e as Error)?.message ?? String(e)));
  }
}

interface LanSharePlugin {
  start(o: { path: string; name: string; token: string; port: number }): Promise<SharingInfo>;
  stop(): Promise<void>;
  status(): Promise<Partial<SharingInfo> & { running: boolean }>;
  addListener(event: "changed" | "locked", cb: (e: { path?: string }) => void): Promise<{ remove: () => Promise<void> }>;
}

// Wrapped in an object: a Capacitor plugin proxy answers every property, `then`
// included, so resolving a promise with the proxy itself would never settle.
async function android(): Promise<{ plugin: LanSharePlugin }> {
  const { registerPlugin } = await import("@capacitor/core");
  return { plugin: registerPlugin<LanSharePlugin>("LanShare") };
}

const friendly = (e: unknown, port: number) => {
  const m = (e as Error)?.message ?? String(e);
  return /in use|10048/i.test(m) ? new LanError(`Port ${port} is already used on this device (another Zeolite window, or another program). Close it and try again.`) : new LanError(m);
};

export async function startSharing(vaultPath: string, name: string, code: string, port = LAN_PORT): Promise<SharingInfo> {
  const args = { path: vaultPath, name, token: normaliseCode(code), port };
  try {
    if (platform() === "android") return await (await android()).plugin.start(args);
    return await call<SharingInfo>("lan_start", args);
  } catch (e) {
    throw friendly(e, port);
  }
}

export async function stopSharing(): Promise<void> {
  if (platform() === "android") return (await android()).plugin.stop();
  await call("lan_stop");
}

export async function sharingStatus(): Promise<SharingInfo | null> {
  if (platform() === "android") {
    const s = await (await android()).plugin.status();
    return s.running ? { ips: s.ips ?? [], port: s.port ?? LAN_PORT } : null;
  }
  return call<SharingInfo | null>("lan_status");
}

/** Called with the paths a device wrote or deleted. */
export async function onSharedChange(cb: (paths: string[]) => void): Promise<() => void> {
  if (platform() === "android") {
    const h = await (await android()).plugin.addListener("changed", (e) => cb(e.path ? [e.path] : []));
    return () => void h.remove();
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen<string[]>("lan-changed", (e) => cb(e.payload));
}
