import { describe, expect, it } from "vitest";
import { createParaNote } from "../src/notes";
import { createFromTemplate, formatDate, insertTemplate, renderTemplate } from "../src/templates";
import { parseTaxonomy } from "../src/taxonomy";
import { splitFrontmatter } from "../src/frontmatter";

const d = new Date(2026, 9, 2, 14, 5, 9); // Friday

describe("formatDate", () => {
  it("formats moment-style tokens", () => {
    expect(formatDate(d, "YYYY-MM-DD HH:mm:ss")).toBe("2026-10-02 14:05:09");
    expect(formatDate(d, "dddd D MMMM YYYY")).toBe("Friday 2 October 2026");
    expect(formatDate(d, "ddd DD MMM YY, h:mm a")).toBe("Fri 02 Oct 26, 2:05 pm");
    expect(formatDate(d, "[Week] WW")).toBe("Week 40");
  });
});

describe("renderTemplate", () => {
  it("replaces variables and finds the cursor", () => {
    const r = renderTemplate("# {{title}}\n{{date}} {{time}} {{date:dddd}}\nID {{id}} {{unknown}}\n{{cursor}}end", {
      title: "Weekly",
      date: d,
      id: "01.02.05.001",
    });
    expect(r.text).toBe("# Weekly\n2026-10-02 14:05 Friday\nID 01.02.05.001 {{unknown}}\nend");
    expect(r.text.slice(r.cursor!)).toBe("end");
  });
});

describe("createFromTemplate", () => {
  const tax = parseTaxonomy("## PARA (XX)\n| 01 | #Projets |\n## Categories (YY)\n| 02 | #SAS |\n## Sub-PARA (ZZ)\n### 01 Projets\n| 05 | #F35 |");
  const note = createParaNote({ taxonomy: tax, para: "01", category: "02", sub: "05", title: "Kick-off", existingIds: [], now: d });

  it("merges properties and uses the template body", () => {
    const tpl = "---\ntags: [Meeting]\ntype: meeting\nid: nope\n---\n# {{title}} ({{id}})\n\n## Attendees\n- {{cursor}}\n";
    const out = createFromTemplate(note, tpl, { title: "Kick-off", id: note.id, date: d });
    const { data, body } = splitFrontmatter(out.content);
    expect(data).toEqual({ id: "01.02.05.001", tags: ["Projets", "SAS", "F35", "Meeting"], created: "2026-10-02T14:05", type: "meeting" });
    expect(body).toBe("\n# Kick-off (01.02.05.001)\n\n## Attendees\n- \n");
    expect(out.content.slice(out.cursor!)).toBe("\n");
    expect(out.content.slice(0, out.cursor!).endsWith("## Attendees\n- ")).toBe(true);
  });
  it("keeps the default body when the template has only properties", () => {
    const out = createFromTemplate(note, "---\nstatus: draft\n---\n", { title: "Kick-off" });
    expect(out.content).toContain("status: draft");
    expect(out.content).toContain("# Kick-off");
  });
});

describe("insertTemplate", () => {
  it("inserts the body at the offset and merges properties", () => {
    const text = "---\ntags: [A]\n---\n# Note\n\nend";
    const at = text.indexOf("end");
    const r = insertTemplate(text, at, "---\ntags: [B]\n---\n- [ ] {{cursor}}\n", { date: d });
    expect(r.text).toBe("---\ntags: [A, B]\n---\n# Note\n\n- [ ] \nend");
    expect(r.text.slice(r.cursor)).toBe("\nend");
  });
  it("works on notes without frontmatter", () => {
    const r = insertTemplate("Hello\n", 6, "Date: {{date}}\n", { date: d });
    expect(r.text).toBe("Hello\nDate: 2026-10-02\n");
    expect(r.cursor).toBe(r.text.length);
  });
});
