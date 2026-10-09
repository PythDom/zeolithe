/**
 * Read the parts of an Obsidian vault's settings (.obsidian/*.json) that
 * Zeolite follows, so an existing vault works without moving anything.
 */
import { DEFAULT_JOURNAL, ATTACHMENTS_FOLDER, INBOX_FOLDER, type JournalSettings } from "./notes";
import { splitFrontmatter, withFrontmatter } from "./frontmatter";
import { TEMPLATES_FOLDER } from "./templates";
import { DEFAULT_ONE_ON_ONE_CODE, type Person } from "./meetings";

export interface VaultSettings {
  templatesFolder: string;
  journal: JournalSettings & {
    /** Template note for new daily notes (vault path with .md), if set. */
    template?: string;
  };
  /**
   * Where pasted images go: a folder, "" for the vault root, or "./" / "./sub"
   * relative to the note's folder (Obsidian's attachmentFolderPath).
   */
  attachments: string;
  /** True when settings were found in .obsidian/. */
  fromObsidian: boolean;
  /** Zeolite's own folders (kept in _system/Settings.md). */
  inboxFolder: string;
  searchesFolder: string;
  exportsFolder: string;
  /** ID prefix of one-on-one meeting notes (PARA.Category.Sub-PARA). */
  oneOnOneCode: string;
  /** People met in one-on-ones (direct reports), with an optional e-mail address. */
  people: Person[];
}

export const DEFAULT_SETTINGS: VaultSettings = {
  templatesFolder: TEMPLATES_FOLDER,
  journal: { ...DEFAULT_JOURNAL },
  attachments: ATTACHMENTS_FOLDER,
  fromObsidian: false,
  inboxFolder: INBOX_FOLDER,
  searchesFolder: "Searches",
  exportsFolder: "exports",
  oneOnOneCode: DEFAULT_ONE_ON_ONE_CODE,
  people: [],
};

/** Zeolite's vault settings note: plain properties, synced with the notes. */
export const SETTINGS_PATH = "_system/Settings.md";

const clean = (p: unknown) => (typeof p === "string" ? p.trim().replace(/^\/+|\/+$/g, "") : undefined);

function parse(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const v = JSON.parse(json);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Build settings from the raw contents of Obsidian's JSON files (missing = undefined). */
export function readObsidianSettings(files: { templates?: string; dailyNotes?: string; app?: string }): VaultSettings {
  const templates = parse(files.templates);
  const daily = parse(files.dailyNotes);
  const app = parse(files.app);
  const s: VaultSettings = structuredClone(DEFAULT_SETTINGS);
  s.fromObsidian = !!(files.templates || files.dailyNotes || files.app);

  const tf = clean(templates.folder);
  if (tf) s.templatesFolder = tf;

  if ("folder" in daily) s.journal.folder = clean(daily.folder) ?? "";
  if (typeof daily.format === "string" && daily.format.trim()) s.journal.format = daily.format.trim();
  const tpl = clean(daily.template);
  if (tpl) s.journal.template = tpl.endsWith(".md") ? tpl : `${tpl}.md`;

  const att = typeof app.attachmentFolderPath === "string" ? app.attachmentFolderPath.trim() : undefined;
  if (att !== undefined) {
    if (att === "/" || att === "") s.attachments = "";
    else if (att === "./" || att === ".") s.attachments = "./";
    else if (att.startsWith("./")) s.attachments = `./${clean(att.slice(2))}`;
    else s.attachments = clean(att) ?? ATTACHMENTS_FOLDER;
  }
  return s;
}

/** "Anna Smith <anna@x.com>", "Anna Smith, anna@x.com" or just "Anna Smith". */
function personFromText(text: string): Person {
  const t = text.trim();
  const angle = /^(.*?)\s*<([^>]+@[^>]+)>$/.exec(t);
  if (angle) return { name: angle[1]!.trim(), email: angle[2]!.trim() };
  const comma = /^(.*?)\s*[,;]\s*(\S+@\S+)$/.exec(t);
  if (comma) return { name: comma[1]!.trim(), email: comma[2]!.trim() };
  return { name: t };
}

/**
 * People under `one_on_one_people:` read line by line, for properties that a
 * YAML parser rejects: "- name: Anna", "- Anna Smith <a@x.com>",
 * "- name: Anna, email: a@x.com", "  email: a@x.com".
 */
export function loosePeople(raw: string): Person[] {
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => /^one_on_one_people\s*:/.test(l));
  if (start < 0) return [];
  const items: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const item = /^\s*-\s*(.*)$/.exec(line);
    if (item) items.push(item[1]!);
    else if (items.length && line.trim()) items[items.length - 1] += `, ${line.trim()}`;
  }
  const strip = (v: string) => v.trim().replace(/^["']|["']$/g, "").trim();
  return readPeople(
    items.map((it) => {
      const name = /(?:^|,)\s*name\s*:\s*([^,]+)/i.exec(it)?.[1];
      const email = /(?:^|,)\s*email\s*:\s*([^,\s]+)/i.exec(it)?.[1];
      if (name) return email ? `${strip(name)} <${strip(email)}>` : strip(name);
      return strip(it);
    }),
  );
}

/** People as written in the settings note: `- name: Anna`, `email: …`, or plain names. */
function readPeople(list: unknown[]): Person[] {
  const out: Person[] = [];
  for (const item of list) {
    const p: Person | null =
      typeof item === "string"
        ? personFromText(item)
        : item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string"
          ? { name: String((item as { name: string }).name).trim(), email: typeof (item as { email?: unknown }).email === "string" ? String((item as { email: string }).email).trim() : undefined }
          : null;
    if (p?.name && !out.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) out.push(p.email ? p : { name: p.name });
  }
  return out;
}

/** Settings note with a new list of people (other properties kept). */
export function writePeople(note: string | undefined, people: Person[]): string {
  const props = { one_on_one_people: people.map((p) => (p.email ? { name: p.name, email: p.email } : { name: p.name })) };
  return note
    ? withFrontmatter(note, { ...splitFrontmatter(note).data, ...props })
    : withFrontmatter("# Zeolite settings\n\nSettings of this vault, changed in Zeolite with ⚙ Settings. Obsidian keeps its own settings in `.obsidian/`.\n", props);
}

/** Take Zeolite's own folder settings from the settings note's properties. */
export function applyZeoliteSettings(s: VaultSettings, note: string | undefined): VaultSettings {
  if (!note) return s;
  const { data } = splitFrontmatter(note);
  const out = { ...s };
  const pick = (key: string) => (typeof data[key] === "string" ? clean(data[key]) : undefined);
  out.inboxFolder = pick("inbox_folder") ?? out.inboxFolder;
  out.searchesFolder = pick("searches_folder") ?? out.searchesFolder;
  out.exportsFolder = pick("exports_folder") ?? out.exportsFolder;
  const code = typeof data.one_on_one_code === "string" ? data.one_on_one_code.trim() : "";
  if (/^\d{2}\.\d{2}\.\d{2}$/.test(code)) out.oneOnOneCode = code;
  if (Array.isArray(data.one_on_one_people)) out.people = readPeople(data.one_on_one_people);
  else if (!Object.keys(data).length) {
    // Properties that are not valid YAML (often a hand edit): still find the people.
    const loose = loosePeople(splitFrontmatter(note).raw);
    if (loose.length) out.people = loose;
  }
  return out;
}

/**
 * The files to write for new settings: Obsidian's own JSON files (existing
 * keys kept, so Obsidian keeps working with the same values) and Zeolite's
 * settings note.
 */
export function writeVaultSettings(
  s: VaultSettings,
  current: { templates?: string; dailyNotes?: string; app?: string; note?: string },
): { templates: string; dailyNotes: string; app: string; note: string } {
  const json = (o: Record<string, unknown>) => `${JSON.stringify(o, null, 2)}\n`;
  const app = parse(current.app);
  app.attachmentFolderPath = s.attachments === "" ? "/" : s.attachments;
  const templates = parse(current.templates);
  templates.folder = s.templatesFolder;
  const daily = parse(current.dailyNotes);
  daily.folder = s.journal.folder;
  daily.format = s.journal.format;
  if (s.journal.template) daily.template = s.journal.template.replace(/\.md$/i, "");
  else delete daily.template;
  const props = {
    inbox_folder: s.inboxFolder,
    searches_folder: s.searchesFolder,
    exports_folder: s.exportsFolder,
    one_on_one_code: s.oneOnOneCode,
    one_on_one_people: s.people.map((p) => (p.email ? { name: p.name, email: p.email } : { name: p.name })),
  };
  const note = current.note
    ? withFrontmatter(current.note, { ...splitFrontmatter(current.note).data, ...props })
    : withFrontmatter("# Zeolite settings\n\nSettings of this vault, changed in Zeolite with ⚙ Settings. Obsidian keeps its own settings in `.obsidian/`.\n", props);
  return { app: json(app), templates: json(templates), dailyNotes: json(daily), note };
}

/** Folder for an attachment pasted into `notePath`. */
export function attachmentFolder(settings: VaultSettings, notePath: string | null): string {
  const a = settings.attachments;
  if (!a.startsWith("./")) return a;
  const noteFolder = notePath && notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  const sub = a.slice(2);
  return [noteFolder, sub].filter(Boolean).join("/");
}
