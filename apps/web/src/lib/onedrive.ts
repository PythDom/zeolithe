/**
 * OneDrive sync through Microsoft Graph: sign-in with a device code (the user
 * enters a short code on microsoft.com/devicelogin, from any device), then
 * list, download, upload and delete files under one OneDrive folder.
 *
 * The sign-in requests go through the native HTTP layer of the Windows and
 * Android apps: Microsoft's sign-in service does not accept requests made
 * directly from a web page for this kind of sign-in. File transfers use
 * Graph, which does.
 */
import { isSyncedPath } from "@zeolite/core";
import { platform } from "./native";

/**
 * Application (client) ID of Zeolite's app registration in Microsoft Entra
 * (see docs/sync.md). Empty: each user registers their own and enters it in
 * the sync dialog.
 */
export const DEFAULT_CLIENT_ID = "";

const LOGIN = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = "Files.ReadWrite offline_access";

export class OneDriveError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Sign-in

interface Tokens {
  clientId: string;
  refreshToken: string;
  accessToken: string;
  /** Epoch ms after which the access token must be refreshed. */
  expires: number;
  /** Name of the signed-in account, for display. */
  account: string;
}

const TOKENS_KEY = "zeolite.onedrive.auth";

function loadTokens(clientId: string): Tokens | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKENS_KEY) ?? "null") as Tokens | null;
    return t && t.clientId === clientId ? t : null;
  } catch {
    return null;
  }
}

function saveTokens(t: Tokens | null) {
  try {
    if (t) localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
    else localStorage.removeItem(TOKENS_KEY);
  } catch {
    // Not kept: the user signs in again next time.
  }
}

/** The account signed in on this device for this app registration, if any. */
export const signedInAccount = (clientId: string) => loadTokens(clientId)?.account ?? "";

export function signOut() {
  saveTokens(null);
}

type Json = Record<string, unknown>;

/** POST a form to Microsoft's sign-in service, natively where possible. */
async function postForm(url: string, params: Record<string, string>): Promise<{ status: number; json: Json }> {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  const body = new URLSearchParams(params).toString();
  try {
    const p = platform();
    if (p === "android") {
      const { CapacitorHttp } = await import("@capacitor/core");
      const r = await CapacitorHttp.post({ url, headers, data: params });
      return { status: r.status, json: (typeof r.data === "string" ? JSON.parse(r.data || "{}") : r.data) as Json };
    }
    const doFetch = p === "tauri" ? (await import("@tauri-apps/plugin-http")).fetch : fetch;
    const r = await doFetch(url, { method: "POST", headers, body });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Json };
  } catch {
    throw new OneDriveError(
      platform() === "web"
        ? "Signing in to Microsoft is not possible from a web page: use the Windows or Android app to set up OneDrive sync."
        : "Cannot reach Microsoft's sign-in service. Check your network.",
    );
  }
}

export interface DeviceCode {
  /** Code to type on the page. */
  userCode: string;
  /** Page where the code is entered (microsoft.com/devicelogin). */
  url: string;
  /** Wait for the user to finish; resolves with the account name. */
  done: Promise<string>;
  cancel: () => void;
}

const authError = (json: Json) => {
  const code = String(json.error ?? "");
  const desc = String(json.error_description ?? "").split("\r\n")[0] ?? "";
  if (/AADSTS700016|unauthorized_client|invalid_client/i.test(`${code} ${desc}`))
    return "Microsoft does not recognise this application ID. Check it, and that the app registration allows personal accounts and public client flows (see the guide).";
  if (/AADSTS7000218/.test(desc)) return 'The app registration must allow public client flows: in Microsoft Entra, Authentication → "Allow public client flows" → Yes.';
  return desc || code || "Microsoft refused the sign-in.";
};

/** Start a device-code sign-in. */
export async function startSignIn(clientId: string): Promise<DeviceCode> {
  const id = clientId.trim();
  if (!id) throw new OneDriveError("Enter the application (client) ID first.");
  const start = await postForm(`${LOGIN}/devicecode`, { client_id: id, scope: SCOPES });
  if (start.status !== 200) throw new OneDriveError(authError(start.json), start.status);
  const deviceCode = String(start.json.device_code);
  let interval = Number(start.json.interval ?? 5) * 1000;
  const deadline = Date.now() + Number(start.json.expires_in ?? 900) * 1000;
  let cancelled = false;

  const done = (async () => {
    while (!cancelled) {
      await new Promise((r) => setTimeout(r, interval));
      if (cancelled) break;
      if (Date.now() > deadline) throw new OneDriveError("The code has expired: start the sign-in again.");
      const r = await postForm(`${LOGIN}/token`, { grant_type: "urn:ietf:params:oauth:grant-type:device_code", client_id: id, device_code: deviceCode });
      if (r.status === 200) {
        const t = tokensFrom(id, r.json, "");
        t.account = await accountName(t.accessToken);
        saveTokens(t);
        return t.account;
      }
      const err = String(r.json.error ?? "");
      if (err === "authorization_pending") continue;
      if (err === "slow_down") {
        interval += 5000;
        continue;
      }
      if (err === "authorization_declined") throw new OneDriveError("The sign-in was declined.");
      if (err === "expired_token") throw new OneDriveError("The code has expired: start the sign-in again.");
      throw new OneDriveError(authError(r.json), r.status);
    }
    throw new OneDriveError("Sign-in cancelled.");
  })();
  return {
    userCode: String(start.json.user_code),
    url: String(start.json.verification_uri ?? "https://microsoft.com/devicelogin"),
    done,
    cancel: () => (cancelled = true),
  };
}

function tokensFrom(clientId: string, json: Json, account: string): Tokens {
  return {
    clientId,
    accessToken: String(json.access_token),
    refreshToken: String(json.refresh_token ?? ""),
    // Refresh a few minutes early.
    expires: Date.now() + (Number(json.expires_in ?? 3600) - 300) * 1000,
    account,
  };
}

async function accountName(token: string): Promise<string> {
  try {
    const r = await fetch(`${GRAPH}/me/drive?$select=owner`, { headers: { Authorization: `Bearer ${token}` } });
    const d = (await r.json()) as { owner?: { user?: { displayName?: string; email?: string } } };
    return d.owner?.user?.email ?? d.owner?.user?.displayName ?? "your Microsoft account";
  } catch {
    return "your Microsoft account";
  }
}

/** A valid access token, refreshed when needed. */
async function accessToken(clientId: string, force = false): Promise<string> {
  const t = loadTokens(clientId);
  if (!t) throw new OneDriveError("Not signed in to OneDrive on this device: open ⇅ Sync and sign in.", 401);
  if (!force && Date.now() < t.expires) return t.accessToken;
  const r = await postForm(`${LOGIN}/token`, { grant_type: "refresh_token", client_id: clientId, refresh_token: t.refreshToken, scope: SCOPES });
  if (r.status !== 200) {
    if (r.json.error === "invalid_grant") saveTokens(null);
    throw new OneDriveError(`OneDrive sign-in expired: open ⇅ Sync and sign in again. (${authError(r.json)})`, 401);
  }
  const next = tokensFrom(clientId, r.json, t.account);
  // Microsoft may keep the same refresh token.
  if (!next.refreshToken) next.refreshToken = t.refreshToken;
  saveTokens(next);
  return next.accessToken;
}

// ---------------------------------------------------------------------------
// Files

interface Item {
  id: string;
  /** Content tag: changes only when the content changes. */
  version: string;
  downloadUrl?: string;
}

interface DriveItem {
  id: string;
  name: string;
  eTag?: string;
  cTag?: string;
  folder?: unknown;
  file?: unknown;
  "@microsoft.graph.downloadUrl"?: string;
}

const versionOf = (d: DriveItem) => d.cTag ?? d.eTag ?? "";
/** Graph path syntax: each segment percent-encoded. */
const encodePath = (path: string) => path.split("/").filter(Boolean).map(encodeURIComponent).join("/");

/** Sync remote for runSync: one folder in the signed-in user's OneDrive. */
export class OneDriveClient {
  private readonly folder: string;
  private items = new Map<string, Item>();

  constructor(
    private readonly clientId: string,
    folder: string,
  ) {
    this.folder = folder.trim().replace(/^\/+|\/+$/g, "");
    if (!this.folder) throw new OneDriveError("Choose a folder in your OneDrive, for example Zeolite.");
  }

  /** Identifies the sync target (a different folder starts a fresh sync state). */
  get url() {
    return `onedrive:${this.clientId}/${this.folder}`;
  }

  private async request(method: string, url: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}, ok: number[] = []): Promise<Response> {
    let token = await accessToken(this.clientId);
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(url.startsWith("https://") ? url : `${GRAPH}${url}`, {
          method,
          body: init.body,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
      } catch {
        throw new OneDriveError("Cannot reach OneDrive. Check your network.");
      }
      if (res.ok || ok.includes(res.status)) return res;
      if (res.status === 401 && attempt === 0) {
        token = await accessToken(this.clientId, true);
        continue;
      }
      // Throttled: wait as asked, a few times.
      if ((res.status === 429 || res.status === 503) && attempt < 4) {
        const wait = Math.min(60, Number(res.headers.get("Retry-After")) || 2 ** attempt * 2);
        await new Promise((r) => setTimeout(r, wait * 1000));
        continue;
      }
      let message = `${res.status} ${res.statusText}`;
      try {
        message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
      } catch {
        /* keep the status */
      }
      throw new OneDriveError(`OneDrive: ${message}`, res.status);
    }
  }

  private itemUrl(path: string) {
    const full = encodePath(path ? `${this.folder}/${path}` : this.folder);
    return `/me/drive/root:/${full}`;
  }

  /** Check the connection; create the sync folder if it does not exist yet. */
  async test(): Promise<"ok" | "created"> {
    const res = await this.request("GET", `${this.itemUrl("")}?$select=id,folder`, {}, [404]);
    if (res.status !== 404) {
      if (!((await res.json()) as DriveItem).folder) throw new OneDriveError(`“${this.folder}” in your OneDrive is a file, not a folder.`);
      return "ok";
    }
    // Create each missing folder of the path.
    let parent = "/me/drive/root";
    const done: string[] = [];
    for (const name of this.folder.split("/")) {
      done.push(name);
      const res = await this.request(
        "POST",
        `${parent}/children`,
        { body: JSON.stringify({ name, folder: {}, "@microsoft.graph.conflictBehavior": "fail" }), headers: { "Content-Type": "application/json" } },
        [409],
      );
      // 409: this level already exists.
      const item = (await (res.status === 409 ? await this.request("GET", `/me/drive/root:/${encodePath(done.join("/"))}?$select=id`) : res).json()) as DriveItem;
      parent = `/me/drive/items/${item.id}`;
    }
    return "created";
  }

  /** Every synced file under the sync folder, with its content version. */
  async list(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    this.items.clear();
    const root = await this.request("GET", `${this.itemUrl("")}?$select=id`, {}, [404]);
    if (root.status === 404) return files;
    const queue: { id: string; path: string }[] = [{ id: ((await root.json()) as DriveItem).id, path: "" }];
    while (queue.length) {
      const dir = queue.shift()!;
      let next: string | undefined = `/me/drive/items/${dir.id}/children?$top=999`;
      while (next) {
        const page = (await (await this.request("GET", next)).json()) as { value: DriveItem[]; "@odata.nextLink"?: string };
        for (const d of page.value) {
          const path = dir.path ? `${dir.path}/${d.name}` : d.name;
          if (!isSyncedPath(path)) continue;
          if (d.folder) queue.push({ id: d.id, path });
          else if (d.file) {
            files.set(path, versionOf(d));
            this.items.set(path, { id: d.id, version: versionOf(d), downloadUrl: d["@microsoft.graph.downloadUrl"] });
          }
        }
        next = page["@odata.nextLink"];
      }
    }
    return files;
  }

  async get(path: string): Promise<Blob> {
    let url = this.items.get(path)?.downloadUrl;
    if (!url) {
      const d = (await (await this.request("GET", this.itemUrl(path))).json()) as DriveItem;
      url = d["@microsoft.graph.downloadUrl"];
      if (!url) throw new OneDriveError(`OneDrive: no download link for ${path}.`);
    }
    // Pre-authenticated link: no Authorization header (and no redirect, which browsers refuse here).
    let res: Response;
    try {
      res = await fetch(url, { cache: "no-store" });
    } catch {
      throw new OneDriveError("Cannot reach OneDrive. Check your network.");
    }
    if (!res.ok) throw new OneDriveError(`OneDrive: download of ${path} failed (${res.status}).`, res.status);
    return res.blob();
  }

  /** Upload a file (OneDrive creates missing folders); returns its new version. */
  async put(path: string, data: Blob): Promise<string> {
    const res = await this.request("PUT", `${this.itemUrl(path)}:/content`, { body: data, headers: { "Content-Type": "application/octet-stream" } });
    const d = (await res.json()) as DriveItem;
    this.items.set(path, { id: d.id, version: versionOf(d) });
    return versionOf(d);
  }

  async remove(path: string) {
    const item = this.items.get(path);
    await this.request("DELETE", item ? `/me/drive/items/${item.id}` : this.itemUrl(path), {}, [404]);
    this.items.delete(path);
  }
}
