import { describe, expect, it } from "vitest";
import { applyZeoliteSettings, DEFAULT_SETTINGS, readObsidianSettings, writeVaultSettings } from "../src/obsidian";
import { parseTaxonomy } from "../src/taxonomy";
import { setParaFolder } from "../src/taxonomy-edit";
import { createInboxNote } from "../src/notes";
import { readFileSync } from "node:fs";

describe("vault settings", () => {
  it("writes Obsidian's files keeping their other keys, and reads them back", () => {
    const s = { ...structuredClone(DEFAULT_SETTINGS), attachments: "files/img", templatesFolder: "Tpl", journal: { folder: "Daily", format: "YYYY/MM-DD", template: "Tpl/Day.md" } };
    const out = writeVaultSettings(s, { app: '{"vimMode":true,"attachmentFolderPath":"old"}', templates: '{"dateFormat":"DD"}' });
    expect(JSON.parse(out.app)).toEqual({ vimMode: true, attachmentFolderPath: "files/img" });
    expect(JSON.parse(out.templates)).toEqual({ dateFormat: "DD", folder: "Tpl" });
    expect(JSON.parse(out.dailyNotes)).toEqual({ folder: "Daily", format: "YYYY/MM-DD", template: "Tpl/Day" });
    const back = readObsidianSettings({ app: out.app, templates: out.templates, dailyNotes: out.dailyNotes });
    expect(back.attachments).toBe("files/img");
    expect(back.templatesFolder).toBe("Tpl");
    expect(back.journal).toEqual({ folder: "Daily", format: "YYYY/MM-DD", template: "Tpl/Day.md" });
  });

  it("vault root and note-relative attachment folders round-trip", () => {
    for (const a of ["", "./", "./img"]) {
      const out = writeVaultSettings({ ...structuredClone(DEFAULT_SETTINGS), attachments: a }, {});
      expect(readObsidianSettings({ app: out.app }).attachments).toBe(a);
    }
  });

  it("keeps Zeolite's folders in the settings note", () => {
    const s = { ...structuredClone(DEFAULT_SETTINGS), inboxFolder: "00 Inbox", searchesFolder: "_system/Searches", exportsFolder: "PDF" };
    const { note } = writeVaultSettings(s, {});
    const back = applyZeoliteSettings(structuredClone(DEFAULT_SETTINGS), note);
    expect([back.inboxFolder, back.searchesFolder, back.exportsFolder]).toEqual(["00 Inbox", "_system/Searches", "PDF"]);
    // An existing note keeps its text and other properties.
    const again = writeVaultSettings(s, { note: "---\nfoo: 1\n---\nMy text\n" }).note;
    expect(again).toContain("foo: 1");
    expect(again).toContain("My text");
  });

  it("creates inbox notes in the chosen folder", () => {
    expect(createInboxNote("Idea", new Date(), "00 Inbox").path).toBe("00 Inbox/Idea.md");
  });
});

describe("setParaFolder", () => {
  const tax = parseTaxonomy(readFileSync(new URL("../../../docs/taxonomy.md", import.meta.url), "utf8"));
  it("changes a PARA's folder", () => {
    expect(setParaFolder(tax, "01", "1 - Projects/").paras.find((p) => p.code === "01")!.folder).toBe("1 - Projects");
  });
  it("refuses empty, invalid or duplicate folders", () => {
    expect(() => setParaFolder(tax, "01", " ")).toThrow(/empty/);
    expect(() => setParaFolder(tax, "01", "a:b")).toThrow(/cannot be used/);
    expect(() => setParaFolder(tax, "01", "02 Areas")).toThrow(/already/);
  });
});
