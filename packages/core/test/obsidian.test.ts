import { describe, expect, it } from "vitest";
import { createJournalNote } from "../src/notes";
import { attachmentFolder, readObsidianSettings } from "../src/obsidian";
import { isTemplatePath } from "../src/templates";

describe("Obsidian settings", () => {
  it("uses defaults without .obsidian files", () => {
    const s = readObsidianSettings({});
    expect(s).toMatchObject({ templatesFolder: "_system/Templates", attachments: "attachments", fromObsidian: false });
    expect(s.journal).toEqual({ folder: "Journal", format: "YYYY-MM-DD" });
  });
  it("reads templates, daily notes and attachment settings", () => {
    const s = readObsidianSettings({
      templates: '{"folder":"Templates/","dateFormat":"YYYY-MM-DD"}',
      dailyNotes: '{"folder":"Journal/Daily","format":"YYYY/MM/YYYY-MM-DD dddd","template":"Templates/Daily"}',
      app: '{"attachmentFolderPath":"./assets"}',
    });
    expect(s.templatesFolder).toBe("Templates");
    expect(s.journal).toEqual({ folder: "Journal/Daily", format: "YYYY/MM/YYYY-MM-DD dddd", template: "Templates/Daily.md" });
    expect(attachmentFolder(s, "01 Projets/x.md")).toBe("01 Projets/assets");
    expect(attachmentFolder(readObsidianSettings({ app: '{"attachmentFolderPath":"/"}' }), "a/b.md")).toBe("");
    expect(attachmentFolder(readObsidianSettings({ app: '{"attachmentFolderPath":"./"}' }), "a/b.md")).toBe("a");
    expect(attachmentFolder(readObsidianSettings({ app: '{"attachmentFolderPath":"Files"}' }), "a/b.md")).toBe("Files");
    expect(readObsidianSettings({ dailyNotes: "not json" }).journal.folder).toBe("Journal");
  });
  it("creates daily notes with the vault's folder and format", () => {
    const d = new Date(2026, 9, 2, 9, 0);
    expect(createJournalNote(d).path).toBe("Journal/2026-10-02.md");
    const n = createJournalNote(d, { folder: "Journal/Daily", format: "YYYY/MM/YYYY-MM-DD dddd" });
    expect(n.path).toBe("Journal/Daily/2026/10/2026-10-02 Friday.md");
    expect(n.content).toContain("# 2026-10-02 Friday");
    expect(createJournalNote(d, { folder: "", format: "DD-MM-YYYY" }).path).toBe("02-10-2026.md");
    expect(isTemplatePath("Templates/Daily.md", "Templates")).toBe(true);
    expect(isTemplatePath("_system/Templates/X.md")).toBe(true);
  });
});
