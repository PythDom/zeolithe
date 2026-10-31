import { describe, expect, it } from "vitest";
import { addJournalEntry, createMonthNote, isMonthNote, journalItemsSection, monthNotePath } from "../src/journal";
import { buildNoteRecord } from "../src/note-record";
import { runQuery } from "../src/query";
import { parseFupiLine, toggleAttnResolved, toggleFupi, toggleFupiResolved } from "../src/tasks";
import { createOneOnOneNote, MEETING_TEMPLATE, ONE_ON_ONE_TEMPLATE } from "../src/meetings";
import { parseTaxonomy } from "../src/taxonomy";
import { renderTemplate } from "../src/templates";

const journal = { folder: "Journal", format: "YYYY-MM-DD", period: "month" as const };
const oct14 = new Date(2026, 9, 14, 9, 30);
const blocks = (content: string) => [...content.matchAll(/```dataview\n([\s\S]*?)```/g)].map((m) => m[1]!);
const texts = (res: ReturnType<typeof runQuery>) => res.groups.flatMap((g) => g.rows.map((r) => r.task?.text ?? r.attn?.text ?? r.fupi?.text ?? r.decision?.text));

describe("monthly journal", () => {
  it("names the note after the month, titles it, and ends with what is open in the journal", () => {
    const n = createMonthNote(oct14, journal);
    expect(n.path).toBe("Journal/2026-10.md");
    expect(monthNotePath(oct14, { ...journal, folder: "" })).toBe("2026-10.md");
    expect(n.content).toContain("# October 2026");
    expect(n.content).toMatch(/tags: \[Journal\]/);
    expect(n.content).toContain("## Open in the journal");
    expect(blocks(n.content)).toHaveLength(4);
    expect(isMonthNote("Journal/2026-10.md", journal)).toBe(true);
    expect(isMonthNote("Journal/2026-10-14.md", journal)).toBe(false);
  });

  it("adds a day entry above the open-items section, once", () => {
    const month = createMonthNote(oct14, journal).content;
    const a = addJournalEntry(month, oct14);
    expect(a.text).toContain("## Wednesday 14 October 2026\n\n");
    expect(a.text.indexOf("## Wednesday 14 October 2026")).toBeLessThan(a.text.indexOf("## Open in the journal"));
    // The cursor sits on an empty line under the new heading, a blank line above the section.
    expect(a.text.slice(0, a.cursor).endsWith("## Wednesday 14 October 2026\n\n")).toBe(true);
    expect(a.text.slice(a.cursor).startsWith("\n\n## Open in the journal")).toBe(true);
    const b = addJournalEntry(a.text, new Date(2026, 9, 15));
    expect(b.text.indexOf("## Thursday 15 October 2026")).toBeGreaterThan(b.text.indexOf("## Wednesday 14 October 2026"));
    const again = addJournalEntry(b.text, oct14);
    expect(again.text).toBe(b.text);
    expect(b.text.slice(0, again.cursor).endsWith("## Wednesday 14 October 2026\n")).toBe(true);
    // A note without the section: appended at the end.
    expect(addJournalEntry("# October 2026\n", oct14).text).toBe("# October 2026\n\n## Wednesday 14 October 2026\n\n");
  });

  it("lists open actions, open Attn points and all decisions of every journal note", () => {
    const notes = [
      buildNoteRecord("Journal/2026-09.md", "---\ntags: [Journal]\n---\n- [ ] Old action\n- [x] Done\nAttn:: Risk A\nAttn:: Gone [resolved:: 2026-09-02]\nDecide:: Pick vendor\nDecision:: Keep plan [decided:: 2026-09-03]\n"),
      buildNoteRecord("Journal/2026-10.md", "---\ntags: [Journal]\n---\n- [ ] This month\n"),
      buildNoteRecord("Projects/Other.md", "- [ ] Not journal\nAttn:: Elsewhere\n"),
    ];
    const [tasks, attn, decide, decided] = blocks(journalItemsSection(journal)).map((q) => texts(runQuery(q, notes, oct14, "Journal/2026-10.md")));
    expect(tasks).toEqual(["Old action", "This month"]);
    expect(attn).toEqual(["Risk A"]);
    expect(decide).toEqual(["Pick vendor"]);
    expect(decided).toEqual(["Keep plan"]);
  });
});

describe("follow-up items (fupi::)", () => {
  it("parses, toggles and resolves", () => {
    expect(parseFupiLine("- fupi:: Budget for 2027")?.text).toBe("Budget for 2027");
    expect(toggleFupi("- Budget for 2027")).toBe("- fupi:: Budget for 2027");
    expect(toggleFupi("Budget")).toBe("- fupi:: Budget");
    expect(toggleFupi("  - [ ] Send plan")).toBe("  - fupi:: Send plan");
    expect(toggleFupi("- fupi:: Budget for 2027")).toBe("- Budget for 2027");
    expect(toggleFupi("We spoke about [fupi:: the budget] today")).toBe("We spoke about the budget today");
    const resolved = toggleFupiResolved("- fupi:: Budget", oct14);
    expect(resolved).toBe("- fupi:: Budget [resolved:: 2026-10-14]");
    expect(parseFupiLine(resolved)?.resolved).toBe("2026-10-14");
    expect(toggleFupiResolved(resolved)).toBe("- fupi:: Budget");
    expect(toggleAttnResolved("- fupi:: Budget", oct14)).toContain("[resolved:: 2026-10-14]");
  });

  const tax = parseTaxonomy("## PARA (XX)\n| 02 | #Areas | `02 Areas/` |\n## Categories (YY)\n| 02 | #SAS |\n## Sub-PARA (ZZ)\n### 02 Areas\n| 01 | #One-on-One_Meetings |\n");

  it("puts the open follow-ups of earlier meetings with the same person in the agenda", () => {
    const n = createOneOnOneNote({ taxonomy: tax, code: "02.02.01", person: "Anna Smith", existingIds: ["02.02.01.001"], now: oct14 });
    expect(n.content).toContain("# 2026-10-14 Anna Smith-DZ");
    const body = n.content;
    expect(body.indexOf("### Follow-up items")).toBeLessThan(body.indexOf("### New topics"));
    expect(body.indexOf("### New topics")).toBeLessThan(body.indexOf("## Notes"));
    const notes = [
      buildNoteRecord("02 Areas/02.02.01.001 2026-10-01 Anna Smith.md", "---\ntype: one-on-one\nperson: Anna Smith\n---\n- fupi:: Training budget\n- fupi:: Old point [resolved:: 2026-10-07]\n"),
      buildNoteRecord("02 Areas/02.02.01.003 2026-10-02 Bob Lee.md", "---\ntype: one-on-one\nperson: Bob Lee\n---\n- fupi:: Bob's point\n"),
      buildNoteRecord(n.path, `${n.content}\n- fupi:: Raised today\n`),
    ];
    const query = blocks(n.content)[0]!;
    expect(texts(runQuery(query, notes, oct14, n.path))).toEqual(["Training budget"]);
  });

  it("fills the meeting template", () => {
    const t = renderTemplate(MEETING_TEMPLATE, { title: "Supplier review", date: oct14 });
    expect(t.text).toContain("# Supplier review, 2026-10-14\n\n## Participants\n\n- \n\n## Agenda\n\n## Notes");
    expect(ONE_ON_ONE_TEMPLATE).toContain("LIST fupi");
  });
});

describe("open since", () => {
  it("says how long ago, in rounded units", async () => {
    const { sinceLabel } = await import("../src/dates");
    const t = new Date(2026, 9, 21, 15, 0);
    expect(sinceLabel("2026-10-21T08:00", t)).toBe("today");
    expect(sinceLabel("2026-10-20", t)).toBe("1 day");
    expect(sinceLabel("2026-10-11", t)).toBe("10 days");
    expect(sinceLabel("2026-09-30", t)).toBe("3 weeks");
    expect(sinceLabel("2026-06-01", t)).toBe("4 months");
    expect(sinceLabel("2024-10-01", t)).toBe("2 years");
    expect(sinceLabel(undefined, t)).toBeNull();
    expect(sinceLabel("2026-11-01", t)).toBeNull();
  });
});

describe("trash names", () => {
  it("stamps deleted files and folders with the date and time", async () => {
    const { trashPath } = await import("../src/notes");
    const t = new Date(2026, 9, 31, 14, 5, 22);
    expect(trashPath("Projects/Budget.md", t)).toBe(".trash/Budget 2026-10-31 14-05-22.md");
    expect(trashPath("Budget.md", t, 1)).toBe(".trash/Budget 2026-10-31 14-05-22 2.md");
    expect(trashPath("attachments/plan.v2.png", t)).toBe(".trash/plan.v2 2026-10-31 14-05-22.png");
    expect(trashPath("Projects/v1.2", t, 0, true)).toBe(".trash/v1.2 2026-10-31 14-05-22");
  });
});
