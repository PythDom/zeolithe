import { describe, expect, it } from "vitest";
import { allocateIds, importTitle, renameAttachmentLinks, suggestFiling } from "../src/filing";
import { parseTaxonomy } from "../src/taxonomy";

const tax = parseTaxonomy(`## PARA (XX)
| 01 | #Projects | \`01 Projects/\` |
| 02 | #Areas | \`02 Areas/\` |
| 04 | #Archives | \`04 Archives/\` |
## Categories (YY)
| 01 | #Work |
| 02 | #Home |
## Sub-PARA (ZZ)
### 01 Projects
| 05 | #Suppliers |
### 02 Areas
| 01 | #Meetings |
| 02 | #Health |
`);

describe("suggested filing", () => {
  const ids: Record<string, string> = {
    "a.md": "01.01.05.001",
    "b.md": "01.01.05.002",
    "c.md": "02.02.02.001",
    "gone.md": "02.01.09.001",
  };
  const idOf = (p: string) => ids[p];

  it("follows the closest numbered notes, weighted by closeness", () => {
    const s = suggestFiling([{ path: "c.md", score: 0.5 }, { path: "a.md", score: 0.3 }, { path: "b.md", score: 0.3 }, { path: "x.md", score: 0.9 }], idOf, tax);
    expect(s).toMatchObject({ para: "01", category: "01", sub: "05", basis: ["a.md", "b.md"] });
    expect(s!.confidence).toBeCloseTo(0.6 / 1.1);
  });

  it("ignores codes no longer in the taxonomy and notes without ID", () => {
    expect(suggestFiling([{ path: "gone.md", score: 1 }, { path: "x.md", score: 1 }], idOf, tax)).toBeNull();
    expect(suggestFiling([], idOf, tax)).toBeNull();
  });
});

describe("numbers for a batch", () => {
  it("continues each series and keeps hand-typed numbers", () => {
    const res = allocateIds(
      [
        { key: "1", para: "01", category: "01", sub: "05" },
        { key: "2", para: "01", category: "01", sub: "05", seq: 7 },
        { key: "3", para: "01", category: "01", sub: "05" },
        { key: "4", para: "02", category: "02", sub: "02" },
        { key: "5", para: "02", category: "02", sub: "02", seq: 1 },
        { key: "6", para: "02", category: "02", sub: "02", seq: 1000 },
      ],
      ["01.01.05.002", "02.02.02.001"],
    );
    expect(res.get("2")).toEqual({ id: "01.01.05.007" });
    expect(res.get("1")).toEqual({ id: "01.01.05.008" });
    expect(res.get("3")).toEqual({ id: "01.01.05.009" });
    expect(res.get("4")).toEqual({ id: "02.02.02.002" });
    expect(res.get("5")?.error).toMatch(/already used/);
    expect(res.get("6")?.error).toMatch(/001 to 999/);
  });
});

describe("imported notes", () => {
  it("takes the title from the file name, or the first heading for generic names", () => {
    expect(importTitle("Supplier review.md", "# Something else")).toBe("Supplier review");
    expect(importTitle("Untitled 3.md", "---\ntitle: x\n---\nIntro\n# Budget 2027\n")).toBe("Budget 2027");
    expect(importTitle("Untitled.md", "no heading")).toBe("Untitled");
  });

  it("points links at a renamed attachment", () => {
    const text = "![[plan.png]] ![[img/plan.png|300]] ![x](plan.png) ![y](my%20plan.png) ![[plan.png.bak]]";
    expect(renameAttachmentLinks(text, "plan.png", "plan 1.png")).toBe("![[plan 1.png]] ![[img/plan 1.png|300]] ![x](plan%201.png) ![y](my%20plan.png) ![[plan.png.bak]]");
    expect(renameAttachmentLinks("![y](my%20plan.png)", "my plan.png", "my plan 1.png")).toBe("![y](my%20plan%201.png)");
  });
});
