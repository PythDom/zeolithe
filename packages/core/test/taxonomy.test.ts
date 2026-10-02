import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findCollisions, idFromFileName, nextId, noteFileName, parseId, tagsForId } from "../src/ids";
import { archiveNote, createJournalNote, createParaNote, renumberNote } from "../src/notes";
import { splitFrontmatter } from "../src/frontmatter";
import { numberablePara, parseTaxonomy } from "../src/taxonomy";

const tax = parseTaxonomy(readFileSync(new URL("../../../docs/taxonomy.md", import.meta.url), "utf8"));

describe("parseTaxonomy (docs/taxonomy.md)", () => {
  it("reads PARAs with folders", () => {
    expect(tax.paras.map((p) => `${p.code} ${p.tag} ${p.folder}`)).toEqual([
      "01 Projets 01 Projets",
      "02 Areas 02 Areas",
      "03 References 03 References",
      "04 Archives 04 Archives",
    ]);
  });
  it("reads categories and Sub-PARAs", () => {
    expect(tax.categories).toHaveLength(20);
    expect(tax.categories.find((c) => c.code === "06")?.tag).toBe("Programs");
    expect(tax.subParas["01"]?.find((s) => s.code === "05")?.tag).toBe("F35");
    expect(tax.subParas["02"]?.find((s) => s.code === "01")?.tag).toBe("One-on-One_Meetings");
    expect(tax.subParas["04"] ?? []).toHaveLength(0);
    expect(numberablePara(tax).map((p) => p.code)).toEqual(["01", "02", "03"]);
    expect(tax.warnings).toEqual([]);
  });
});

describe("IDs", () => {
  it("computes the next sequence per prefix", () => {
    const ids = ["01.02.05.001", "01.02.05.007", "01.02.06.003", "junk"];
    expect(nextId("01", "02", "05", ids)).toBe("01.02.05.008");
    expect(nextId("01", "02", "06", ids)).toBe("01.02.06.004");
    expect(nextId("02", "00", "00", ids)).toBe("02.00.00.001");
    expect(() => nextId("01", "00", "00", ["01.00.00.999"])).toThrow();
  });
  it("maps IDs to tags and file names", () => {
    expect(tagsForId(tax, parseId("01.02.05.001")!)).toEqual(["Projets", "SAS", "F35"]);
    expect(noteFileName("01.02.05.001", 'F35: "status"?')).toBe("01.02.05.001 F35 status.md");
    expect(idFromFileName("01 Projets/01.02.05.001 F35 status.md")).toBe("01.02.05.001");
    expect(idFromFileName("Journal/2026-10-02.md")).toBeNull();
  });
  it("flags the later-created note in a collision", () => {
    const c = findCollisions([
      { path: "a.md", id: "01.02.05.004", created: "2026-10-02T14:31" },
      { path: "b.md", id: "01.02.05.004", created: "2026-10-02T09:00" },
      { path: "c.md", id: "01.02.05.005" },
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]!.keep.path).toBe("b.md");
    expect(c[0]!.renumber.map((n) => n.path)).toEqual(["a.md"]);
  });
});

describe("notes", () => {
  const now = new Date(2026, 9, 2, 14, 31);
  it("creates a numbered PARA note", () => {
    const n = createParaNote({ taxonomy: tax, para: "01", category: "02", sub: "05", title: "Status review", existingIds: ["01.02.05.003"], now });
    expect(n.path).toBe("01 Projets/01.02.05.004 Status review.md");
    expect(n.content).toBe(
      "---\nid: 01.02.05.004\ntags: [Projets, SAS, F35]\ncreated: 2026-10-02T14:31\n---\n\n# Status review\n\n",
    );
  });
  it("rejects unknown codes", () => {
    expect(() => createParaNote({ taxonomy: tax, para: "04", category: "00", sub: "00", title: "x", existingIds: [], now })).toThrow();
  });
  it("creates journal notes", () => {
    expect(createJournalNote(now).path).toBe("Journal/2026-10-02.md");
  });
  it("archives keeping the ID", () => {
    const n = createParaNote({ taxonomy: tax, para: "01", category: "02", sub: "05", title: "Done", existingIds: [], now });
    const a = archiveNote(tax, n.path, n.content);
    expect(a.path).toBe("04 Archives/01.02.05.001 Done.md");
    expect(a.id).toBe("01.02.05.001");
    expect(splitFrontmatter(a.content).data.tags).toEqual(["Projets", "SAS", "F35", "Archives"]);
  });
  it("renumbers a note", () => {
    const r = renumberNote("01 Projets/01.02.05.004 X.md", "---\nid: 01.02.05.004\n---\nbody", "01.02.05.005");
    expect(r.path).toBe("01 Projets/01.02.05.005 X.md");
    expect(r.content).toBe("---\nid: 01.02.05.005\n---\nbody");
  });
});

describe("assignId", () => {
  it("changes the ID of a numbered note", async () => {
    const { assignId } = await import("../src/notes");
    const content = "---\nid: 01.02.05.001\ntags: [Projets, SAS, F35, review]\ncreated: 2026-10-01T09:00\n---\n# Status\n";
    const r = assignId({ taxonomy: tax, path: "01 Projets/01.02.05.001 Status.md", content, para: "02", category: "00", sub: "00", existingIds: ["01.02.05.001", "02.00.00.001"], moveToParaFolder: true });
    expect(r.id).toBe("02.00.00.002");
    expect(r.path).toBe("02 Areas/02.00.00.002 Status.md");
    expect(r.content).toBe("---\nid: 02.00.00.002\ntags: [Areas, General, Team_meetings, review]\ncreated: 2026-10-01T09:00\n---\n# Status\n");
  });
  it("assigns a first ID to an Obsidian note", async () => {
    const { assignId } = await import("../src/notes");
    const r = assignId({ taxonomy: tax, path: "Notes/Garden ideas.md", content: "# Garden ideas\n#idea\n", para: "03", category: "99", sub: "00", existingIds: [], moveToParaFolder: false });
    expect(r.path).toBe("Notes/03.99.00.001 Garden ideas.md");
    expect(r.content).toMatch(/^---\nid: 03\.99\.00\.001\ntags: \[References, Personal, Notes\]\ncreated: \d{4}-\d\d-\d\dT\d\d:\d\d\n---\n# Garden ideas\n#idea\n$/);
  });
  it("does not count the note's own number as taken", async () => {
    const { assignId } = await import("../src/notes");
    // Same series: its own number is not counted as taken, so it gets the next free one after the others.
    const r = assignId({ taxonomy: tax, path: "01 Projets/01.02.05.003 X.md", content: "---\nid: 01.02.05.003\n---\n", para: "01", category: "02", sub: "05", existingIds: ["01.02.05.001", "01.02.05.003"], moveToParaFolder: true });
    expect(r.id).toBe("01.02.05.002");
  });
});
