import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTaxonomy } from "../src/taxonomy";
import {
  addEntry,
  codeUsage,
  editTaxonomyNote,
  removeEntry,
  renameEntry,
  serializeInto,
  suggestCode,
  taxonomyTemplate,
  TaxonomyEditError,
} from "../src/taxonomy-edit";

const doc = readFileSync(new URL("../../../docs/taxonomy.md", import.meta.url), "utf8");
const tax = parseTaxonomy(doc);
const ids = ["01.02.05.001", "01.02.05.002", "02.00.00.001"];

describe("taxonomy edits", () => {
  it("suggests the lowest free code", () => {
    expect(suggestCode(tax, "category")).toBe("12");
    expect(suggestCode(tax, "category", undefined, 56)).toBe("56");
    expect(suggestCode(tax, "sub", "01")).toBe("08");
    expect(suggestCode(tax, "sub", "04")).toBe("00");
  });
  it("adds entries with validation", () => {
    const t = addEntry(tax, "category", { tag: "#Aviation" });
    expect(t.categories.find((c) => c.code === "12")?.tag).toBe("Aviation");
    expect(() => addEntry(tax, "category", { code: "02", tag: "X" })).toThrow(/already #SAS/);
    expect(() => addEntry(tax, "category", { tag: "SAS" })).toThrow(/already in this list/);
    expect(() => addEntry(tax, "category", { code: "7", tag: "X" })).toThrow(TaxonomyEditError);
    expect(() => addEntry(tax, "category", { tag: "has space" })).toThrow(/not a valid tag/);
    expect(addEntry(tax, "para", { code: "05", tag: "Inbox" }).paras.at(-1)).toEqual({ code: "05", tag: "Inbox", folder: "05 Inbox" });
  });
  it("renames and removes, protecting used codes", () => {
    expect(renameEntry(tax, "sub", "05", "F-35", "01").subParas["01"]!.find((s) => s.code === "05")!.tag).toBe("F-35");
    expect(codeUsage(ids, "sub", "05", "01")).toBe(2);
    expect(() => removeEntry(tax, "sub", "05", ids, "01")).toThrow(/used by 2 note IDs/);
    expect(removeEntry(tax, "sub", "06", ids, "01").subParas["01"]!.some((s) => s.code === "06")).toBe(false);
    expect(() => removeEntry(tax, "para", "01", ids)).toThrow(/cannot be removed/);
  });
});

describe("serializeInto", () => {
  it("round-trips the document unchanged when nothing changes (tables normalised)", () => {
    const out = serializeInto(doc, tax);
    expect(parseTaxonomy(out)).toEqual(tax);
    // Text outside the tables is kept.
    expect(out).toContain("## Changes from the original table");
    expect(out).toContain("No Sub-PARAs. Archiving a note moves it");
  });
  it("writes additions into the right tables", () => {
    const out = editTaxonomyNote(doc, (t) => addEntry(addEntry(t, "category", { tag: "Aviation" }), "sub", { tag: "Drones" }, "02"));
    const back = parseTaxonomy(out);
    expect(back.categories.find((c) => c.code === "12")?.tag).toBe("Aviation");
    expect(back.subParas["02"]!.find((s) => s.code === "04")?.tag).toBe("Drones");
    expect(out).toMatch(/\| 11\s+\| #Quality\s+\|\n\| 12\s+\| #Aviation\s+\|\n\| 13/);
    expect(back.warnings).toEqual([]);
  });
  it("adds a heading for a PARA's first Sub-PARA list", () => {
    const withPara = editTaxonomyNote(doc, (t) => addEntry(t, "para", { code: "05", tag: "Ideas" }));
    const out = editTaxonomyNote(withPara, (t) => addEntry(t, "sub", { tag: "Startups" }, "05"));
    expect(out).toContain("### 05 Ideas\n\n| Code | Tag       |\n| ---- | --------- |\n| 00   | #Startups |");
    expect(parseTaxonomy(out).subParas["05"]).toEqual([{ code: "00", tag: "Startups" }]);
    // The new list sits inside the Sub-PARA section, before the next section.
    expect(out.indexOf("### 05 Ideas")).toBeLessThan(out.indexOf("## Changes from the original table"));
  });
  it("builds a fresh note from a template", () => {
    const fresh = taxonomyTemplate(addEntry(parseTaxonomy(""), "para", { code: "01", tag: "Projets" }));
    expect(parseTaxonomy(fresh).paras).toEqual([{ code: "01", tag: "Projets", folder: "01 Projets" }]);
  });
});
