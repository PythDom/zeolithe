import { describe, expect, it } from "vitest";
import { buildNoteRecord } from "../src/note-record";
import { runQuery } from "../src/query";
import { parseTaxonomy } from "../src/taxonomy";
import { applyZeoliteSettings, DEFAULT_SETTINGS, writePeople } from "../src/obsidian";
import { createJournalNote } from "../src/notes";
import { appendSection, createOneOnOneNote, pastItemsSection, peopleOfMeetings, personDashboard, personTag } from "../src/meetings";

const taxonomy = parseTaxonomy(`## PARA (XX)
| 02 | #Areas | \`02 Areas/\` |
## Categories (YY)
| 02 | #SAS |
## Sub-PARA (ZZ)
### 02 Areas
| 01 | #One-on-One_Meetings |
`);
const day = (d: number) => new Date(2026, 9, d, 9, 0);

const blocks = (content: string) => [...content.matchAll(/```dataview\n([\s\S]*?)```/g)].map((m) => m[1]!);
const rows = (res: ReturnType<typeof runQuery>) =>
  res.groups.flatMap((g) => g.rows.map((r) => r.task?.text ?? r.attn?.text ?? r.decision?.text ?? r.values.map(String).join(" ")));

describe("one-on-one notes", () => {
  const past = [
    buildNoteRecord(
      "02 Areas/02.02.01.001 2026-10-01 Anna Smith.md",
      `---\nid: 02.02.01.001\ntype: one-on-one\nperson: Anna Smith\n---\n- [ ] Send the training plan\n- [ ] \n- [x] Book the room\nAttn:: Workload is high\nAttn:: Old point [resolved:: 2026-10-02]\nDecide:: Promotion case\nDecision:: Keep Monday slot [decided:: 2026-10-01]\n`,
    ),
    buildNoteRecord("02 Areas/02.02.01.002 2026-10-02 Bob Lee.md", `---\nid: 02.02.01.002\ntype: one-on-one\nperson: Bob Lee\n---\n- [ ] Bob's own action\n`),
    buildNoteRecord("01 Projets/Other.md", `- [ ] Review budget [owner:: Anna Smith]\n- [ ] Unrelated\n`),
  ];

  it("creates the note with ID, date, person tag and a Past meetings section", () => {
    const n = createOneOnOneNote({ taxonomy, code: "02.02.01", person: "Anna Smith", existingIds: ["02.02.01.001", "02.02.01.002"], now: day(9) });
    expect(n.path).toBe("02 Areas/02.02.01.003 2026-10-09 Anna Smith.md");
    expect(n.content).toContain("# 2026-10-09 Anna Smith-DZ");
    expect(n.content).toMatch(/tags: \[Areas, SAS, One-on-One_Meetings, Anna_Smith\]/);
    expect(n.content).toContain("person: Anna Smith");
    expect(n.content).toContain("type: one-on-one");
    expect(n.content).toContain("## Past meetings");
    expect(n.content.indexOf("## Agenda")).toBeLessThan(n.content.indexOf("## Past meetings"));
    expect(n.cursor).not.toBeNull();

    // The queries list what is still open in Anna's other meetings only.
    const notes = [...past, buildNoteRecord(n.path, n.content)];
    const [tasks, decide, attn] = blocks(n.content).map((src) => rows(runQuery(src, notes, day(9), n.path)));
    expect(tasks).toEqual(["Send the training plan"]);
    expect(decide).toEqual(["Promotion case"]);
    expect(attn).toEqual(["Workload is high"]);
  });

  it("refuses a code missing from the taxonomy, and needs a person", () => {
    expect(() => createOneOnOneNote({ taxonomy, code: "02.03.01", person: "Anna", existingIds: [] })).toThrow(/no 02.03.01/);
    expect(() => createOneOnOneNote({ taxonomy, code: "02.02.01", person: " ", existingIds: [] })).toThrow(/person/);
  });

  it("keeps a template's own Past meetings section", () => {
    const tpl = "---\ntype: one-on-one\n---\n# {{person}} ({{persontag}})\n\n## Past meetings\n\nmine\n";
    const n = createOneOnOneNote({ taxonomy, code: "02.02.01", person: "Anna Smith", existingIds: [], template: tpl, now: day(9) });
    expect(n.content).toContain("# Anna Smith (Anna_Smith)");
    expect(n.content.match(/## Past meetings/g)).toHaveLength(1);
  });

  it("dashboard: one-on-one items and items owned by the person", () => {
    const md = personDashboard("Anna Smith");
    const [tasks, attn, decide, decided, meetings] = blocks(md).map((src) => rows(runQuery(src, past, day(9))));
    expect(tasks).toEqual(["Send the training plan", "Review budget"]);
    expect(attn).toEqual(["Workload is high"]);
    expect(decide).toEqual(["Promotion case"]);
    expect(decided).toEqual(["Keep Monday slot"]);
    expect(meetings).toHaveLength(1);
  });

  it("people and tags", () => {
    expect(peopleOfMeetings(past)).toEqual(["Anna Smith", "Bob Lee"]);
    expect(personTag("Anne-Marie  O'Neil")).toBe("Anne-Marie_ONeil");
    expect(personTag("2024")).toBe("p2024");
    const note = writePeople(undefined, [{ name: "Anna Smith", email: "anna@example.com" }, { name: "Bob Lee" }]);
    expect(applyZeoliteSettings(DEFAULT_SETTINGS, note).people).toEqual([{ name: "Anna Smith", email: "anna@example.com" }, { name: "Bob Lee" }]);
  });
});

describe("journal past notes", () => {
  it("lists what is open in other journal entries", () => {
    const old = buildNoteRecord("Journal/2026-10-08.md", "---\ntags: [Journal]\n---\n- [ ] Call the bank\nDecide:: Holiday dates\nAttn:: Car service due\n");
    const other = buildNoteRecord("Notes/x.md", "- [ ] Not a journal task\n");
    const today = createJournalNote(day(9));
    const content = appendSection(today.content, "Past notes", pastItemsSection("Past notes", { from: '"Journal"' }));
    const notes = [old, other, buildNoteRecord(today.path, content)];
    const [tasks, decide, attn] = blocks(content).map((src) => rows(runQuery(src, notes, day(9), today.path)));
    expect(tasks).toEqual(["Call the bank"]);
    expect(decide).toEqual(["Holiday dates"]);
    expect(attn).toEqual(["Car service due"]);
    expect(appendSection(content, "Past notes", "again")).toBe(content);
  });
});
