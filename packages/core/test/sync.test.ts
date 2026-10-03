import { describe, expect, it } from "vitest";
import { conflictPath, hashBytes, isSyncedPath, normaliseEtag, planSync, type SyncBase } from "../src/sync";

const m = (o: Record<string, string>) => new Map(Object.entries(o));
const kinds = (local: Record<string, string>, remote: Record<string, string>, base: Record<string, SyncBase> = {}) =>
  Object.fromEntries(planSync(m(local), m(remote), base).map((a) => [a.path, a.kind]));

describe("planSync", () => {
  it("first sync copies each side's new files and compares files present on both", () => {
    expect(kinds({ "a.md": "h1", "both.md": "h2" }, { "b.md": "e1", "both.md": "e2" })).toEqual({
      "a.md": "upload",
      "b.md": "download",
      "both.md": "compare",
    });
  });

  it("does nothing when neither side changed", () => {
    expect(kinds({ "a.md": "h" }, { "a.md": "e" }, { "a.md": { hash: "h", etag: "e" } })).toEqual({});
  });

  it("copies one-sided changes", () => {
    const base = { "a.md": { hash: "h", etag: "e" }, "b.md": { hash: "h", etag: "e" } };
    expect(kinds({ "a.md": "h2", "b.md": "h" }, { "a.md": "e", "b.md": "e2" }, base)).toEqual({ "a.md": "upload", "b.md": "download" });
  });

  it("propagates deletions of unchanged files", () => {
    const base = { "a.md": { hash: "h", etag: "e" }, "b.md": { hash: "h", etag: "e" } };
    expect(kinds({ "b.md": "h" }, { "a.md": "e" }, base)).toEqual({ "a.md": "deleteRemote", "b.md": "deleteLocal" });
  });

  it("an edit wins over a deletion", () => {
    const base = { "a.md": { hash: "h", etag: "e" }, "b.md": { hash: "h", etag: "e" } };
    expect(kinds({ "a.md": "h2" }, { "b.md": "e2" }, base)).toEqual({ "a.md": "upload", "b.md": "download" });
  });

  it("compares files changed on both sides and forgets files gone on both", () => {
    const base = { "a.md": { hash: "h", etag: "e" }, "gone.md": { hash: "h", etag: "e" } };
    expect(kinds({ "a.md": "h2" }, { "a.md": "e2" }, base)).toEqual({ "a.md": "compare", "gone.md": "forget" });
  });
});

describe("sync helpers", () => {
  it("names conflict copies like Syncthing", () => {
    const d = new Date(2026, 9, 3, 14, 5, 1);
    expect(conflictPath("01 Projets/Note.md", d)).toBe("01 Projets/Note.sync-conflict-20261003-140501-SERVER.md");
    expect(conflictPath("v1.0/README", d)).toBe("v1.0/README.sync-conflict-20261003-140501-SERVER");
  });

  it("skips hidden folders and system files", () => {
    expect(isSyncedPath("01 Projets/a.md")).toBe(true);
    expect(isSyncedPath(".obsidian/app.json")).toBe(false);
    expect(isSyncedPath(".zeolite/sync.json")).toBe(false);
    expect(isSyncedPath("a/.trash/x.md")).toBe(false);
    expect(isSyncedPath("a/Thumbs.db")).toBe(false);
  });

  it("hashes content and normalises versions", () => {
    const enc = new TextEncoder();
    expect(hashBytes(enc.encode("abc"))).toBe(hashBytes(enc.encode("abc")));
    expect(hashBytes(enc.encode("abc"))).not.toBe(hashBytes(enc.encode("abd")));
    expect(normaliseEtag('W/"x1"')).toBe("x1");
    expect(normaliseEtag('"x1"')).toBe("x1");
  });
});
