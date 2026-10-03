/**
 * Read the parts of an Obsidian vault's settings (.obsidian/*.json) that
 * Zeolite follows, so an existing vault works without moving anything.
 */
import { DEFAULT_JOURNAL, ATTACHMENTS_FOLDER, INBOX_FOLDER, type JournalSettings } from "./notes";
import { splitFrontmatter, withFrontmatter } from "./frontmatter";
import { TEMPLATES_FOLDER } from "./templates";

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
}

export const DEFAULT_SETTINGS: VaultSettings = {
  templatesFolder: TEMPLATES_FOLDER,
  journal: { ...DEFAULT_JOURNAL },
  attachments: ATTACHMENTS_FOLDER,
  fromObsidian: false,
  inboxFolder: INBOX_FOLDER,
  searchesFolder: "Searches",
  exportsFolder: "exports",
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

/** Take Zeolite's own folder settings from the settings note's properties. */
export function applyZeoliteSettings(s: VaultSettings, note: string | undefined): VaultSettings {
  if (!note) return s;
  const { data } = splitFrontmatter(note);
  const out = { ...s };
  const pick = (key: string) => (typeof data[key] === "string" ? clean(data[key]) : undefined);
  out.inboxFolder = pick("inbox_folder") ?? out.inboxFolder;
  out.searchesFolder = pick("searches_folder") ?? out.searchesFolder;
  out.exportsFolder = pick("exports_folder") ?? out.exportsFolder;
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
  const props = { inbox_folder: s.inboxFolder, searches_folder: s.searchesFolder, exports_folder: s.exportsFolder };
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
