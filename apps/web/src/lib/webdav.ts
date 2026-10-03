/**
 * Minimal WebDAV client (RFC 4918) over fetch: list a folder tree, download,
 * upload, delete. Works with any WebDAV server that allows CORS requests
 * from the app (see docs/sync.md for a ready-made Docker setup).
 */
import { isSyncedPath, normaliseEtag } from "@zeolite/core";

export class WebDavError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

const PROPFIND_BODY =
  '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>';

interface Entry {
  path: string;
  dir: boolean;
  /** Server version: ETag, else modification date and size. */
  version: string;
}

export class WebDavClient {
  private readonly base: URL;
  private readonly auth: string;
  /** Folders known to exist on the server (no MKCOL needed). */
  private dirs = new Set<string>([""]);

  constructor(url: string, username: string, password: string) {
    let u: URL;
    try {
      u = new URL(url.trim());
    } catch {
      throw new WebDavError("The server address is not a valid URL (it should start with https:// or http://).");
    }
    if (!/^https?:$/.test(u.protocol)) throw new WebDavError("The server address must start with https:// or http://.");
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    this.base = u;
    this.auth = username ? `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${username}:${password}`)))}` : "";
  }

  get url() {
    return this.base.href;
  }

  private href(path: string) {
    return new URL(path.split("/").map(encodeURIComponent).join("/"), this.base).href;
  }

  private async request(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}, ok: number[] = []) {
    const headers: Record<string, string> = { ...init.headers };
    if (this.auth) headers.Authorization = this.auth;
    let res: Response;
    try {
      res = await fetch(this.href(path), { method, headers, body: init.body, cache: "no-store", credentials: "omit" });
    } catch {
      throw new WebDavError(
        `Cannot reach ${this.base.host}. Check the address and your network. If the address is right, the server must allow requests from Zeolite (CORS, see the sync guide); an http:// server cannot be used from an https:// page.`,
      );
    }
    if (res.ok || ok.includes(res.status)) return res;
    if (res.status === 401) throw new WebDavError("The server refused the user name or password.", 401);
    if (res.status === 403) throw new WebDavError(`The server does not allow this (${method} ${path || "/"}). Check the user's permissions.`, 403);
    throw new WebDavError(`${method} ${path || "/"} failed: ${res.status} ${res.statusText}`.trim(), res.status);
  }

  private parse(xml: string): Entry[] {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const out: Entry[] = [];
    const basePath = decodeURIComponent(this.base.pathname);
    for (const r of Array.from(doc.getElementsByTagNameNS("DAV:", "response"))) {
      const href = r.getElementsByTagNameNS("DAV:", "href")[0]?.textContent ?? "";
      let full: string;
      try {
        full = decodeURIComponent(new URL(href, this.base).pathname);
      } catch {
        continue;
      }
      if (!full.startsWith(basePath)) continue;
      const path = full.slice(basePath.length).replace(/\/+$/, "");
      // Properties of the successful propstat only.
      const ok = Array.from(r.getElementsByTagNameNS("DAV:", "propstat")).find((p) => /\s2\d\d\s/.test(p.getElementsByTagNameNS("DAV:", "status")[0]?.textContent ?? " 200 "));
      const scope = ok ?? r;
      const prop = (name: string) => scope.getElementsByTagNameNS("DAV:", name)[0]?.textContent?.trim() ?? "";
      const dir = scope.getElementsByTagNameNS("DAV:", "collection").length > 0;
      const etag = prop("getetag");
      out.push({ path, dir, version: etag ? normaliseEtag(etag) : `${prop("getlastmodified")}|${prop("getcontentlength")}` });
    }
    return out;
  }

  private async propfind(path: string, depth: "0" | "1"): Promise<Entry[]> {
    const res = await this.request("PROPFIND", path, { body: PROPFIND_BODY, headers: { Depth: depth, "Content-Type": "application/xml; charset=utf-8" } });
    return this.parse(await res.text());
  }

  /** Check the connection; create the sync folder if it does not exist yet. */
  async test(): Promise<"ok" | "created"> {
    try {
      await this.propfind("", "0");
      return "ok";
    } catch (e) {
      if ((e as WebDavError).status !== 404) throw e;
    }
    // Create the folder and any missing parents.
    const segments = this.base.pathname.split("/").filter(Boolean);
    for (let i = 1; i <= segments.length; i++) {
      const url = new URL(`/${segments.slice(0, i).join("/")}/`, this.base);
      const res = await fetch(url, { method: "MKCOL", headers: this.auth ? { Authorization: this.auth } : {}, credentials: "omit" }).catch(() => null);
      if (res && res.status === 401) throw new WebDavError("The server refused the user name or password.", 401);
    }
    await this.propfind("", "0");
    return "created";
  }

  /** Every synced file under the sync folder, with its server version. */
  async list(): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    const queue = [""];
    while (queue.length) {
      const dir = queue.shift()!;
      for (const e of await this.propfind(dir ? `${dir}/` : "", "1")) {
        if (e.path === dir || !e.path || !isSyncedPath(e.path)) continue;
        if (e.dir) {
          this.dirs.add(e.path);
          queue.push(e.path);
        } else files.set(e.path, e.version);
      }
    }
    return files;
  }

  async get(path: string): Promise<Blob> {
    return (await this.request("GET", path)).blob();
  }

  private async ensureDir(dir: string) {
    if (this.dirs.has(dir)) return;
    const parent = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
    await this.ensureDir(parent);
    // 405: already exists.
    await this.request("MKCOL", `${dir}/`, {}, [405]);
    this.dirs.add(dir);
  }

  /** Upload a file (creating its folders); returns its new server version. */
  async put(path: string, data: Blob): Promise<string> {
    await this.ensureDir(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
    const res = await this.request("PUT", path, { body: data, headers: { "Content-Type": "application/octet-stream" } });
    const etag = res.headers.get("ETag");
    if (etag) return normaliseEtag(etag);
    const [e] = await this.propfind(path, "0");
    return e?.version ?? "";
  }

  async remove(path: string) {
    await this.request("DELETE", path, {}, [404]);
  }
}
