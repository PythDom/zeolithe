/**
 * One-on-one meeting notes, per-person dashboards and "past items" sections
 * (open tasks, Attn points and decisions still to take from earlier notes of
 * the same series). The sections are live Dataview queries, so they work in
 * Obsidian too and ticking an old action in them closes it in its own note.
 */
import { toIsoDate, toIsoMinute } from "./dates";
import { serializeFrontmatter, splitFrontmatter } from "./frontmatter";
import { nextId, parseId, sanitizeTitle, tagsForId } from "./ids";
import type { NewNote } from "./notes";
import { findCategory, findPara, findSubPara, type Taxonomy } from "./taxonomy";
import { createFromTemplate } from "./templates";

/** Frontmatter `type` of one-on-one notes. */
export const ONE_ON_ONE_TYPE = "one-on-one";
/** Default ID prefix: PARA 02 (Areas) · Category 02 · Sub-PARA 01 (One-on-One meetings). */
export const DEFAULT_ONE_ON_ONE_CODE = "02.02.01";

export interface Person {
  name: string;
  email?: string;
}

/** A tag for a person: "Anna Smith" → "Anna_Smith". */
export function personTag(name: string): string {
  const t = name
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_\-/]/gu, "");
  // A tag cannot be only digits.
  return /^\d+$/.test(t) ? `p${t}` : t;
}

const q = (s: string) => `"${s.replace(/["\\]/g, "\\$&")}"`;

/**
 * Markdown section listing what is still open in other notes matching
 * `scope` (a Dataview condition, or a FROM source given as `from`).
 */
export function pastItemsSection(heading: string, scope: { from?: string; where?: string }): string {
  const from = scope.from ? `FROM ${scope.from}\n` : "";
  const w = (cond: string) => [cond, scope.where, "file.name != this.file.name"].filter(Boolean).join(" AND ");
  const block = (query: string) => `\`\`\`dataview\n${query}\n\`\`\``;
  return [
    `## ${heading}`,
    "",
    "### Open actions",
    "",
    block(`TASK\n${from}WHERE ${w('status = " " AND text != ""')}\nGROUP BY file.link`),
    "",
    "### Decisions to take",
    "",
    block(`LIST Decide\n${from}WHERE ${w("Decide")}\nGROUP BY file.link`),
    "",
    "### Open Attn points",
    "",
    block(`LIST Attn\n${from}WHERE ${w("Attn AND !resolved")}\nGROUP BY file.link`),
    "",
  ].join("\n");
}

/** Condition matching the one-on-one notes with a person. */
export const oneOnOneWhere = (person: string) => `type = ${q(ONE_ON_ONE_TYPE)} AND person = ${q(person)}`;

/** Append a section unless the note already has a heading with that title. */
export function appendSection(content: string, heading: string, section: string): string {
  const has = new RegExp(`^#{1,6}\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "mi").test(splitFrontmatter(content).body);
  if (has) return content;
  return `${content.replace(/\s*$/, "")}\n\n${section}`;
}

/** Template written the first time a one-on-one note is created (then editable). */
export const ONE_ON_ONE_TEMPLATE = `---
type: ${ONE_ON_ONE_TYPE}
---
# {{date}} {{person}}-DZ

## Agenda

- {{cursor}}

## Notes

## Actions

- [ ]

## Decisions

`;

export interface OneOnOneRequest {
  taxonomy: Taxonomy;
  /** ID prefix XX.YY.ZZ, e.g. 02.02.01. */
  code: string;
  person: string;
  existingIds: Iterable<string>;
  /** Template text (the one-on-one template); ONE_ON_ONE_TEMPLATE if missing. */
  template?: string;
  now?: Date;
}

/**
 * A one-on-one note: `02 Areas/02.02.01.007 2026-10-09 Anna Smith.md`, tagged
 * with the taxonomy tags and the person, with a "Past meetings" section.
 */
export function createOneOnOneNote(req: OneOnOneRequest): NewNote & { cursor: number | null } {
  const tax = req.taxonomy;
  const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(req.code.trim());
  if (!m) throw new Error(`The one-on-one code "${req.code}" must look like 02.02.01 (PARA.Category.Sub-PARA).`);
  const [, para, category, sub] = m as unknown as [string, string, string, string];
  const p = findPara(tax, para);
  if (!p || !findCategory(tax, category) || !findSubPara(tax, para, sub))
    throw new Error(`The taxonomy has no ${req.code} (PARA ${para}, Category ${category}, Sub-PARA ${sub}): add it, or change the one-on-one code in ⚙ Settings.`);
  const person = req.person.trim();
  if (!person) throw new Error("Choose the person.");

  const now = req.now ?? new Date();
  const date = toIsoDate(now);
  const id = nextId(para, category, sub, req.existingIds);
  const tags = [...tagsForId(tax, parseId(id)!), personTag(person)];
  const title = sanitizeTitle(`${date} ${person}`);
  const base: NewNote = {
    id,
    path: `${p.folder}/${id} ${title}.md`,
    content: `${serializeFrontmatter({ id, tags, type: ONE_ON_ONE_TYPE, person, created: toIsoMinute(now) })}\n# ${title}\n\n`,
  };
  const applied = createFromTemplate(base, req.template ?? ONE_ON_ONE_TEMPLATE, {
    title,
    date: now,
    id,
    para: p.tag,
    category: findCategory(tax, category)!.tag,
    subpara: findSubPara(tax, para, sub)!.tag,
    person,
    persontag: personTag(person),
  });
  return { ...applied, content: appendSection(applied.content, "Past meetings", pastItemsSection("Past meetings", { where: oneOnOneWhere(person) })) };
}

/** People of the one-on-one notes in the vault (from their `person` property). */
export function peopleOfMeetings(records: Iterable<{ frontmatter: Record<string, unknown> }>): string[] {
  const out = new Set<string>();
  for (const r of records) {
    if (r.frontmatter.type === ONE_ON_ONE_TYPE && typeof r.frontmatter.person === "string" && r.frontmatter.person.trim()) out.add(r.frontmatter.person.trim());
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

/**
 * Dashboard for one person: what is open in their one-on-one notes or
 * assigned to them anywhere, plus recent decisions and meetings.
 */
export function personDashboard(person: string): string {
  const scope = `((${oneOnOneWhere(person)}) OR contains(owner, ${q(person)}))`;
  const block = (query: string) => `\`\`\`dataview\n${query}\n\`\`\``;
  return [
    `# ${person}`,
    "",
    "Open items from our one-on-one meetings, and any other assigned items from other discussions.",
    "",
    "## Open actions",
    "",
    block(`TASK\nWHERE status = " " AND text != "" AND ${scope}\nSORT due ASC\nGROUP BY file.link`),
    "",
    "## Attention points",
    "",
    block(`LIST Attn\nWHERE Attn AND !resolved AND ${scope}\nGROUP BY file.link`),
    "",
    "## Decisions to take",
    "",
    block(`LIST Decide\nWHERE Decide AND ${scope}\nGROUP BY file.link`),
    "",
    "## Decisions taken",
    "",
    block(`LIST Decision\nWHERE Decision AND ${scope}\nSORT decided DESC\nLIMIT 20`),
    "",
    "## Meetings",
    "",
    block(`TABLE WITHOUT ID file.link AS "Meeting", created AS "Created"\nWHERE ${oneOnOneWhere(person)}\nSORT file.name DESC\nLIMIT 12`),
    "",
  ].join("\n");
}
