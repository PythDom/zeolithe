/**
 * The journal: one note per month (`Journal/2026-10.md`, "# October 2026"),
 * with a heading per day added on demand ("## Tuesday 14 October 2026"), and
 * at the bottom a live section with everything still open in the journal.
 * Daily notes (one note per day, Obsidian's Daily Notes) remain possible.
 */
import { toIsoMinute } from "./dates";
import { serializeFrontmatter, splitFrontmatter } from "./frontmatter";
import { DEFAULT_JOURNAL, type JournalSettings, type NewNote } from "./notes";
import { createFromTemplate, formatDate, renderTemplate } from "./templates";

/** Template of a month note (written to the templates folder on first use, then editable). */
export const JOURNAL_MONTH_TEMPLATE = `---
tags: [Journal]
---
# {{date:MMMM YYYY}}

`;

/** Template of a day's entry in the month note. */
export const JOURNAL_ENTRY_TEMPLATE = `## {{date:dddd D MMMM YYYY}}

{{cursor}}
`;

export const JOURNAL_MONTH_TEMPLATE_NAME = "Journal month";
export const JOURNAL_ENTRY_TEMPLATE_NAME = "Journal entry";

/** Heading of the section listing what is open in the journal (day entries go above it). */
export const JOURNAL_ITEMS_HEADING = "Open in the journal";

const folderOf = (s: JournalSettings) => s.folder.replace(/^\/+|\/+$/g, "");

/** True when the journal has one note per month. */
export const isMonthly = (s: JournalSettings = DEFAULT_JOURNAL) => (s.period ?? "month") === "month";

/** Path of the month note for a date: `Journal/2026-10.md`. */
export function monthNotePath(date: Date, settings: JournalSettings = DEFAULT_JOURNAL): string {
  const folder = folderOf(settings);
  return `${folder ? `${folder}/` : ""}${formatDate(date, "YYYY-MM")}.md`;
}

/** Dataview source of the journal notes: its folder, or #Journal at the vault root. */
export function journalSource(settings: JournalSettings = DEFAULT_JOURNAL): string {
  const folder = folderOf(settings);
  return folder ? `"${folder.replace(/"/g, '\\"')}"` : "#Journal";
}

/**
 * Live section: open actions, unresolved Attn points and all decisions (to
 * take and taken) from every journal note, this one included.
 */
export function journalItemsSection(settings: JournalSettings = DEFAULT_JOURNAL): string {
  const from = journalSource(settings);
  const block = (query: string) => `\`\`\`dataview\n${query}\n\`\`\``;
  return [
    `## ${JOURNAL_ITEMS_HEADING}`,
    "",
    "### Open actions",
    "",
    block(`TASK\nFROM ${from}\nWHERE status = " " AND text != ""\nGROUP BY file.link`),
    "",
    "### Open Attn points",
    "",
    block(`LIST Attn\nFROM ${from}\nWHERE Attn AND !resolved\nGROUP BY file.link`),
    "",
    "### Decisions to take",
    "",
    block(`LIST Decide\nFROM ${from}\nWHERE Decide\nGROUP BY file.link`),
    "",
    "### Decisions taken",
    "",
    block(`LIST Decision\nFROM ${from}\nWHERE Decision\nSORT decided DESC\nGROUP BY file.link`),
    "",
  ].join("\n");
}

/** A new month note from its template, with the open-items section at the bottom. */
export function createMonthNote(date: Date, settings: JournalSettings = DEFAULT_JOURNAL, template: string = JOURNAL_MONTH_TEMPLATE): NewNote & { cursor: number | null } {
  const base: NewNote = {
    path: monthNotePath(date, settings),
    content: `${serializeFrontmatter({ tags: ["Journal"], created: toIsoMinute(date) })}\n# ${formatDate(date, "MMMM YYYY")}\n\n`,
  };
  const applied = createFromTemplate(base, template, { date, title: formatDate(date, "MMMM YYYY") });
  const section = journalItemsSection(settings);
  const has = new RegExp(`^##\\s+${JOURNAL_ITEMS_HEADING}\\s*$`, "m").test(applied.content);
  return { ...applied, content: has ? applied.content : `${applied.content.replace(/\s*$/, "")}\n\n${section}` };
}

/**
 * Add a day's entry to a month note, above the open-items section (or at the
 * end). When the day already has its heading, the cursor goes under it and
 * the note is unchanged.
 */
export function addJournalEntry(content: string, date: Date, template: string = JOURNAL_ENTRY_TEMPLATE): { text: string; cursor: number } {
  const rendered = renderTemplate(template, { date, title: formatDate(date, "dddd D MMMM YYYY") });
  const entry = splitFrontmatter(rendered.text).body.replace(/^\s*\n/, "");
  const heading = entry.split("\n").find((l) => /^#{1,6}\s+\S/.test(l));
  if (heading) {
    const at = content.split("\n").findIndex((l) => l.trim() === heading.trim());
    if (at >= 0) {
      const lines = content.split("\n");
      const offset = lines.slice(0, at + 1).join("\n").length + 1;
      return { text: content, cursor: Math.min(offset, content.length) };
    }
  }
  const section = new RegExp(`^##\\s+${JOURNAL_ITEMS_HEADING}\\s*$`, "m").exec(content);
  // The entry, then an empty line to type on and a blank line before what follows.
  const head = entry.replace(/\s*$/, "");
  const block = `${head}\n\n\n\n`;
  const cursorInEntry = rendered.cursor !== null ? Math.max(0, rendered.cursor - (rendered.text.length - entry.length)) : head.length + 2;
  const cursor = Math.min(cursorInEntry, head.length + 2);
  if (section) {
    const before = content.slice(0, section.index).replace(/\s*$/, "\n\n");
    return { text: before + block + content.slice(section.index), cursor: before.length + cursor };
  }
  const before = content.replace(/\s*$/, "\n\n");
  return { text: before + `${head}\n\n`, cursor: before.length + cursor };
}

/** True for a month note of the journal (`<folder>/YYYY-MM.md`). */
export function isMonthNote(path: string, settings: JournalSettings = DEFAULT_JOURNAL): boolean {
  const folder = folderOf(settings);
  const name = path.split("/").pop()!;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return dir === folder && /^\d{4}-\d{2}\.md$/.test(name);
}
