/**
 * Note templates, compatible with Obsidian's core Templates plugin.
 *
 * Templates are ordinary notes in `_system/Templates/`. Variables:
 *   {{title}}                 note title
 *   {{date}} / {{time}}       2026-10-02 / 14:31
 *   {{date:FORMAT}}           e.g. {{date:dddd D MMMM YYYY}} (moment-style tokens)
 *   {{time:FORMAT}}           e.g. {{time:HH[h]mm}}
 *   {{id}}                    note ID (PARA notes)
 *   {{para}} {{category}} {{subpara}}   taxonomy tags of the ID
 *   {{cursor}}                where the cursor goes after inserting
 * Unknown {{…}} are left as written.
 */
import { splitFrontmatter, serializeFrontmatter } from "./frontmatter";
import type { NewNote } from "./notes";

export const TEMPLATES_FOLDER = "_system/Templates";

export function isTemplatePath(path: string, folder: string = TEMPLATES_FOLDER): boolean {
  return path.startsWith(`${folder.replace(/\/+$/, "")}/`);
}

export function templateName(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Format a date with moment-style tokens; text in [brackets] is literal. */
export function formatDate(d: Date, format: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const week = (() => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  })();
  const tokens: Record<string, () => string> = {
    YYYY: () => String(d.getFullYear()),
    YY: () => String(d.getFullYear()).slice(-2),
    MMMM: () => MONTHS[d.getMonth()]!,
    MMM: () => MONTHS[d.getMonth()]!.slice(0, 3),
    MM: () => pad(d.getMonth() + 1),
    M: () => String(d.getMonth() + 1),
    DD: () => pad(d.getDate()),
    D: () => String(d.getDate()),
    dddd: () => DAYS[d.getDay()]!,
    ddd: () => DAYS[d.getDay()]!.slice(0, 3),
    WW: () => pad(week),
    W: () => String(week),
    HH: () => pad(d.getHours()),
    H: () => String(d.getHours()),
    hh: () => pad(d.getHours() % 12 || 12),
    h: () => String(d.getHours() % 12 || 12),
    mm: () => pad(d.getMinutes()),
    ss: () => pad(d.getSeconds()),
    A: () => (d.getHours() < 12 ? "AM" : "PM"),
    a: () => (d.getHours() < 12 ? "am" : "pm"),
  };
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|WW|W|HH|H|hh|h|mm|ss|A|a/g, (m, literal: string | undefined) =>
    literal !== undefined ? literal : tokens[m]!(),
  );
}

export interface TemplateVars {
  title?: string;
  date?: Date;
  id?: string;
  para?: string;
  category?: string;
  subpara?: string;
}

const CURSOR = "{{cursor}}";

/** Replace variables. Returns the text and the {{cursor}} offset (if any). */
export function renderTemplate(template: string, vars: TemplateVars = {}): { text: string; cursor: number | null } {
  const date = vars.date ?? new Date();
  const simple: Record<string, string | undefined> = {
    title: vars.title,
    id: vars.id,
    para: vars.para,
    category: vars.category,
    subpara: vars.subpara,
  };
  let text = template.replace(/\{\{\s*(\w+)\s*(?::([^}]*))?\}\}/g, (all, name: string, fmt: string | undefined) => {
    const key = name.toLowerCase();
    if (key === "date") return formatDate(date, fmt?.trim() || "YYYY-MM-DD");
    if (key === "time") return formatDate(date, fmt?.trim() || "HH:mm");
    if (key === "cursor") return CURSOR;
    const v = simple[key];
    return v === undefined ? all : v;
  });
  const at = text.indexOf(CURSOR);
  text = text.split(CURSOR).join("");
  return { text, cursor: at >= 0 ? at : null };
}

function mergeData(note: Record<string, unknown>, tpl: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...note };
  for (const [k, v] of Object.entries(tpl)) {
    if (k === "tags") {
      const a = Array.isArray(note.tags) ? note.tags.map(String) : note.tags ? [String(note.tags)] : [];
      const b = Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
      const tags = [...a];
      for (const t of b.map((x) => x.replace(/^#/, ""))) if (t && !tags.includes(t)) tags.push(t);
      if (tags.length) out.tags = tags;
    } else if (!(k in out)) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Apply a template to a note being created. The generated properties (id,
 * created, tags) win; template properties are added; template tags are merged.
 * A template with a body replaces the default "# Title" body.
 */
export function createFromTemplate(note: NewNote, template: string, vars: TemplateVars = {}): NewNote & { cursor: number | null } {
  const rendered = renderTemplate(template, vars);
  const gen = splitFrontmatter(note.content);
  const tpl = splitFrontmatter(rendered.text);
  const data = mergeData(gen.data, tpl.data);
  const fm = Object.keys(data).length ? `${serializeFrontmatter(data)}\n` : "";
  const tplBody = tpl.body.replace(/^\s*\n/, "");
  const body = tplBody.trim() ? tplBody : gen.body.replace(/^\s*\n/, "");
  let cursor: number | null = null;
  if (rendered.cursor !== null && tplBody.trim()) {
    // Map the cursor from the rendered template into the final content.
    const offsetInBody = rendered.cursor - (rendered.text.length - tpl.body.length) - (tpl.body.length - tplBody.length);
    cursor = fm.length + Math.max(0, offsetInBody);
  }
  return { ...note, content: fm + body, cursor };
}

/**
 * Insert a template into an existing note at `offset`: its properties are
 * merged into the note's frontmatter and its body is inserted.
 */
export function insertTemplate(noteText: string, offset: number, template: string, vars: TemplateVars = {}): { text: string; cursor: number } {
  const rendered = renderTemplate(template, vars);
  const tpl = splitFrontmatter(rendered.text);
  const note = splitFrontmatter(noteText);
  const tplBodyStart = rendered.text.length - tpl.body.length;

  let head = noteText.slice(0, noteText.length - note.body.length);
  let bodyOffset = Math.max(0, offset - head.length);
  if (Object.keys(tpl.data).length) {
    const merged = mergeData(note.data, tpl.data);
    head = serializeFrontmatter(merged) + (note.hasFrontmatter ? "" : "\n");
    if (!note.hasFrontmatter) bodyOffset = offset;
  }
  const body = note.body;
  const insert = tpl.body;
  const text = head + body.slice(0, bodyOffset) + insert + body.slice(bodyOffset);
  const cursorInInsert = rendered.cursor !== null ? Math.max(0, rendered.cursor - tplBodyStart) : insert.length;
  return { text, cursor: head.length + bodyOffset + cursorInInsert };
}

/** Starter content for a new template. */
export function templateStarter(): string {
  return `---
tags: []
---
# {{title}}

Created {{date:dddd D MMMM YYYY}} at {{time}}.

{{cursor}}
`;
}
