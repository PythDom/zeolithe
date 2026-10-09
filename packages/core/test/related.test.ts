import { describe, expect, it } from "vitest";
import { buildNoteRecord } from "../src/note-record";
import {
  buildKeywordIndex,
  keywordDocs,
  linkMention,
  mentionTargets,
  mergeRelated,
  nearest,
  noteChunks,
  notesWithoutLinks,
  plainWords,
  relatedByKeywords,
  relatedByVectors,
  searchByKeywords,
  suggestTags,
  tokenize,
  unlinkedMentions,
} from "../src/related";

const notes = [
  buildNoteRecord("01 Projets/01.02.05.001 Typhoon status review.md", "---\ntags: [Typhoon, SAS]\n---\n# Typhoon status review\n\nSupplier delay on the turbine blades. Budget overrun on lot 3.\n- [ ] Call the supplier about turbine blades [due:: 2026-10-07]\n"),
  buildNoteRecord("01 Projets/Turbine supplier audit.md", "---\ntags: [Typhoon, Quality]\n---\n# Turbine supplier audit\n\nThe supplier of the turbine blades failed the audit; delay expected.\n"),
  buildNoteRecord("02 Areas/Guitar.md", "# Guitar practice\n\nChords and scales for the evening. Amazing Grace in G.\n"),
  buildNoteRecord("Journal/2026-10-08.md", "---\ntags: [Journal]\n---\n# 2026-10-08\n\nMet Anna about the Typhoon status review and the turbine supplier audit. See [[Guitar]].\n```\nTyphoon status review inside code\n```\n"),
];

describe("words", () => {
  it("folds accents, drops common words, stems plurals", () => {
    expect(tokenize("Les réunions de l'équipe avec the suppliers")).toEqual(["reunion", "equipe", "supplier"]);
    expect(plainWords("See [[Note|alias]] and `code` [due:: 2026-10-07]\nAttn:: check budget")).toContain("alias");
    expect(plainWords("Attn:: check budget")).not.toContain("Attn");
  });
});

describe("related notes by words", () => {
  const index = buildKeywordIndex(keywordDocs(notes));
  it("ranks the note sharing rare words first", () => {
    const r = relatedByKeywords(index, notes[0]!.path);
    const audit = r.findIndex((x) => x.path === "01 Projets/Turbine supplier audit.md");
    expect(audit).toBeGreaterThanOrEqual(0);
    expect(audit).toBeLessThan(2);
    expect(r[audit]!.why).toEqual(expect.arrayContaining(["turbine"]));
    expect(r.some((x) => x.path === "02 Areas/Guitar.md")).toBe(false);
  });
  it("searches", () => {
    expect(searchByKeywords(index, "turbine blades")[0]!.path).toMatch(/Typhoon status review|Turbine/);
  });
  it("suggests tags of related notes", () => {
    const related = [
      { path: notes[1]!.path, score: 0.6, why: [] },
      { path: notes[0]!.path, score: 0.5, why: [] },
    ];
    expect(suggestTags(["Journal"], related, (p) => notes.find((n) => n.path === p)!.tags)).toEqual(["Typhoon"]);
  });
});

describe("unlinked mentions", () => {
  const targets = mentionTargets(notes);
  const journal = notes[3]!;
  const content = "---\ntags: [Journal]\n---\n# 2026-10-08\n\nMet Anna about the Typhoon status review and the turbine supplier audit. See [[Guitar]].\n```\nTyphoon status review inside code\n```\n";
  it("finds note titles written as plain text, not in code or existing links", () => {
    const linked = new Set(["02 Areas/Guitar.md"]);
    const m = unlinkedMentions(content, journal.path, targets, linked);
    expect(m.map((x) => x.text)).toEqual(["Typhoon status review", "turbine supplier audit"]);
    const once = linkMention(content, m[0]!, "01.02.05.001 Typhoon status review");
    expect(once).toContain("[[01.02.05.001 Typhoon status review|Typhoon status review]]");
    expect(linkMention(content, m[1]!, "Turbine supplier audit")).toContain("[[Turbine supplier audit]]");
    // Code blocks stay untouched, and a stale offset changes nothing.
    expect(once).toContain("```\nTyphoon status review inside code");
    expect(linkMention(content, { index: 0, text: "nope" }, "X")).toBe(content);
  });
});

describe("notes without links", () => {
  it("lists notes nothing links to and that link nowhere", () => {
    const resolve = (t: string) => notes.find((n) => n.name === t)?.path;
    expect(notesWithoutLinks(notes, resolve)).toEqual(["01 Projets/01.02.05.001 Typhoon status review.md", "01 Projets/Turbine supplier audit.md"]);
  });
});

describe("sections and vectors", () => {
  it("cuts notes by heading", () => {
    const c = noteChunks(buildNoteRecord("a.md", "# Title\n\nIntro text long enough to count.\n\n## Part two\n\nSecond part, also long enough.\n"));
    expect(c.map((x) => x.heading)).toEqual(["Title", "Part two"]);
    expect(c[1]!.text).toMatch(/^Title — Part two\n/);
  });
  it("finds nearest sections and related notes by meaning", () => {
    const entries = [
      { key: "a#0", path: "a.md", heading: "A", vector: [1, 0, 0] },
      { key: "b#0", path: "b.md", heading: "B", vector: [0.9, 0.1, 0] },
      { key: "c#0", path: "c.md", heading: "C", vector: [0, 0, 1] },
    ];
    expect(nearest([1, 0, 0], entries, 2).map((e) => e.path)).toEqual(["a.md", "b.md"]);
    expect(relatedByVectors("a.md", entries).map((r) => r.path)).toEqual(["b.md"]);
    const merged = mergeRelated([{ path: "c.md", score: 0.1, why: ["x"] }], [{ path: "b.md", score: 0.95, why: ["B"] }]);
    expect(merged[0]!.path).toBe("b.md");
  });
});
