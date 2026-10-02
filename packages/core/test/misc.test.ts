import { describe, expect, it } from "vitest";
import { parseInlineFields } from "../src/fields";
import { extractLinks, replaceLinkTarget } from "../src/links";
import { buildNoteRecord, isSyncConflict } from "../src/note-record";
import { collectTags, extractInlineTags, renameInlineTag } from "../src/tags";
import { generateToc, upsertStaticToc } from "../src/toc";

describe("inline fields", () => {
  it("parses line and bracket fields", () => {
    const f = parseInlineFields("Attn:: Check [due:: 2026-10-01] budget");
    expect(f.map((x) => [x.key, x.value, x.bracketed])).toEqual([
      ["Attn", "Check budget", false],
      ["due", "2026-10-01", true],
    ]);
  });
});

describe("tags", () => {
  it("extracts inline tags outside code, links and headings", () => {
    const md = "# Title\nSee #F35 and #Projets/F35, not `#code` or #123 or [[a#b]] or http://x.com/#frag\n```\n#nope\n```";
    expect(extractInlineTags(md)).toEqual(["F35", "Projets/F35"]);
  });
  it("merges frontmatter and inline tags", () => {
    expect(collectTags(["Projets", "#SAS"], "text #SAS #New")).toEqual(["Projets", "SAS", "New"]);
  });
  it("renames tags including nested children", () => {
    expect(renameInlineTag("a #Progams b #Progams/x #ProgamsX", "Progams", "Programs")).toBe(
      "a #Programs b #Programs/x #ProgamsX",
    );
  });
});

describe("toc", () => {
  const md = "---\nid: x\n---\n# Title\n## One\n### Sub [[link|L]]\n```\n# not\n```\n## Two";
  it("generates [[#heading]] links", () => {
    expect(generateToc(md, { minLevel: 2 })).toBe("- [[#One]]\n  - [[#Sub L]]\n- [[#Two]]");
  });
  it("inserts and updates a static TOC", () => {
    const once = upsertStaticToc(md, undefined, { minLevel: 2 });
    expect(once).toContain("# Title\n<!-- toc -->\n- [[#One]]");
    expect(upsertStaticToc(once + "\n## Three", undefined, { minLevel: 2 })).toContain("- [[#Three]]\n<!-- /toc -->");
  });
});

describe("links", () => {
  it("extracts and rewrites wiki links", () => {
    const md = "See [[01.02.05.004 X#Plan|plan]] and ![[img.png]]";
    expect(extractLinks(md).map((l) => [l.target, l.heading, l.embed])).toEqual([
      ["01.02.05.004 X", "Plan", false],
      ["img.png", undefined, true],
    ]);
    expect(replaceLinkTarget(md, "01.02.05.004 X", "01.02.05.005 X")).toBe(
      "See [[01.02.05.005 X#Plan|plan]] and ![[img.png]]",
    );
  });
});

describe("note records", () => {
  it("builds a record", () => {
    const r = buildNoteRecord(
      "01 Projets/01.02.05.001 Status.md",
      "---\nid: 01.02.05.001\ntags: [Projets]\ncreated: 2026-10-02T14:31\n---\n# Status\n- [ ] Do #F35\nAttn:: Look",
    );
    expect(r).toMatchObject({ id: "01.02.05.001", title: "Status", folder: "01 Projets", created: "2026-10-02T14:31" });
    expect(r.tags).toEqual(["Projets", "F35"]);
    expect(r.tasks).toHaveLength(1);
    expect(r.attn).toHaveLength(1);
    expect(isSyncConflict("a/b.sync-conflict-20261002-123456-ABCDEF.md")).toBe(true);
  });
});
