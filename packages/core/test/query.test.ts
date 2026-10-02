import { describe, expect, it } from "vitest";
import { buildNoteRecord } from "../src/note-record";
import { parseQuery, QueryError, runQuery, displayValue } from "../src/query";
import { buildQuery, DEFAULT_QUERY } from "../src/query-builder";

const today = new Date(2026, 9, 2); // Friday

const notes = [
  buildNoteRecord(
    "01 Projets/01.02.05.001 F35 status.md",
    `---
id: 01.02.05.001
tags: [Projets, SAS, F35]
created: 2026-10-01T09:00
---
# F35 status
- [ ] Draft report @alice #F35 [due:: 2026-10-07]
- [ ] Review schedule [due:: 2026-10-01]
- [x] Send minutes [done:: 2026-10-02]
- [-] Old idea
Attn:: Budget overrun @bob
- went well, but [Attn:: supplier delay] needs follow-up
`,
  ),
  buildNoteRecord(
    "02 Areas/02.00.00.001 Team meeting.md",
    `---
id: 02.00.00.001
tags: [Areas, General, Team_meetings]
created: 2026-09-20T10:00
---
- [ ] Plan training [due:: 2026-10-02]
- [>] Later thing
Attn:: Room booking [resolved:: 2026-10-01]
See [[01.02.05.001 F35 status]]
`,
  ),
  buildNoteRecord("04 Archives/01.02.05.002 Old.md", "---\nid: 01.02.05.002\ntags: [Projets, Archives]\n---\n- [ ] archived task\n"),
];

const texts = (src: string) =>
  runQuery(src, notes, today).groups.flatMap((g) => g.rows.map((r) => r.task?.text ?? r.attn?.text ?? r.name));

describe("runQuery", () => {
  it("lists open tasks sorted by due", () => {
    expect(texts('TASK WHERE status = " " SORT due ASC')).toEqual([
      "archived task",
      "Review schedule",
      "Plan training",
      "Draft report @alice #F35",
    ]);
  });
  it("filters by tag source, excluding a folder", () => {
    expect(texts('TASK FROM #Projets AND -"04 Archives" WHERE !completed')).toEqual([
      "Draft report @alice #F35",
      "Review schedule",
      "Old idea",
    ]);
  });
  it("handles date arithmetic", () => {
    expect(texts("TASK WHERE due AND due < date(today)")).toEqual(["Review schedule"]);
    expect(texts("TASK WHERE due = date(today)")).toEqual(["Plan training"]);
    expect(texts("TASK WHERE due >= date(today) AND due <= date(today) + dur(7 days)")).toEqual([
      "Draft report @alice #F35",
      "Plan training",
    ]);
  });
  it("matches assignees and text", () => {
    expect(texts('TASK WHERE contains(text, "@alice")')).toEqual(["Draft report @alice #F35"]);
    expect(texts('TASK WHERE icontains(text, "TRAINING")')).toEqual(["Plan training"]);
  });
  it("groups tasks by file", () => {
    const r = runQuery('TASK WHERE status = " " GROUP BY file.link', notes, today);
    expect(r.groups.map((g) => displayValue(g.key!))).toEqual(["01.02.05.001 F35 status", "01.02.05.002 Old", "02.00.00.001 Team meeting"]);
    expect(r.count).toBe(4);
  });
  it("lists individual Attn points", () => {
    expect(texts("LIST Attn WHERE Attn AND !resolved")).toEqual(["Budget overrun @bob", "supplier delay"]);
    expect(texts("LIST Attn WHERE Attn AND resolved")).toEqual(["Room booking"]);
    expect(runQuery("LIST Attn", notes, today).kind).toBe("attn");
  });
  it("lists and tables notes", () => {
    expect(texts('LIST WHERE startswith(id, "01.02")')).toEqual(["01.02.05.001 F35 status", "01.02.05.002 Old"]);
    const t = runQuery('TABLE id, file.tags AS "Tags" FROM #SAS', notes, today);
    expect(t.headers).toEqual(["File", "id", "Tags"]);
    expect(t.groups[0]!.rows[0]!.values.map(displayValue)).toEqual(["01.02.05.001", "#Projets, #SAS, #F35"]);
    expect(texts("LIST FROM [[01.02.05.001 F35 status]]")).toEqual(["02.00.00.001 Team meeting"]);
    expect(texts("LIST SORT file.ctime DESC LIMIT 1")).toEqual(["01.02.05.001 F35 status"]);
  });
  it("supports this.file fields", () => {
    const r = runQuery('TASK WHERE status = " " AND file.name = this.file.name', notes, today, "02 Areas/02.00.00.001 Team meeting.md");
    expect(r.groups[0]!.rows.map((x) => x.task!.text)).toEqual(["Plan training"]);
  });
  it("reports readable errors", () => {
    expect(() => parseQuery("SELECT *")).toThrow(QueryError);
    expect(() => parseQuery("TASK WHERE (due")).toThrow(/Missing/);
    expect(() => runQuery("TASK WHERE nope(1)", notes, today)).toThrow(/Unknown function/);
  });
});

describe("buildQuery", () => {
  it("builds a task query", () => {
    const q = buildQuery({ ...DEFAULT_QUERY, tags: ["F35", "SAS"], excludeFolder: "04 Archives", due: "next", dueDays: 14, person: "alice" });
    expect(q).toBe(
      [
        "TASK",
        'FROM (#F35 OR #SAS) AND -"04 Archives"',
        'WHERE status = " " AND due AND due >= date(today) AND due <= date(today) + dur(14 days) AND contains(text, "@alice")',
        "SORT due ASC",
        "GROUP BY file.link",
      ].join("\n"),
    );
    expect(() => runQuery(q, notes, today)).not.toThrow();
  });
  it("builds Attn, list and table queries that run", () => {
    const attn = buildQuery({ ...DEFAULT_QUERY, target: "attn", group: "none", sort: "none" });
    expect(attn).toBe("LIST Attn\nWHERE Attn AND !resolved");
    expect(texts(attn)).toEqual(["Budget overrun @bob", "supplier delay"]);

    const list = buildQuery({ ...DEFAULT_QUERY, target: "notes", idPrefix: "01.02", sort: "id", group: "none", excludeFolder: "04 Archives" });
    expect(list).toBe('LIST\nFROM "" AND -"04 Archives"\nWHERE startswith(id, "01.02")\nSORT id ASC');
    expect(texts(list)).toEqual(["01.02.05.001 F35 status"]);

    const table = buildQuery({ ...DEFAULT_QUERY, target: "table", tags: ["Projets"], sort: "created-desc", group: "folder", limit: 10 });
    expect(table).toBe("TABLE id, file.tags, created\nFROM #Projets\nSORT file.ctime DESC\nGROUP BY file.folder\nLIMIT 10");
    expect(runQuery(table, notes, today).count).toBe(2);
  });
});
