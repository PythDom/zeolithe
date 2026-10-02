/**
 * Read the parts of an Obsidian vault's settings (.obsidian/*.json) that
 * Zeolite follows, so an existing vault works without moving anything.
 */
import { DEFAULT_JOURNAL, ATTACHMENTS_FOLDER, type JournalSettings } from "./notes";
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
}

export const DEFAULT_SETTINGS: VaultSettings = {
  templatesFolder: TEMPLATES_FOLDER,
  journal: { ...DEFAULT_JOURNAL },
  attachments: ATTACHMENTS_FOLDER,
  fromObsidian: false,
};

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

/** Folder for an attachment pasted into `notePath`. */
export function attachmentFolder(settings: VaultSettings, notePath: string | null): string {
  const a = settings.attachments;
  if (!a.startsWith("./")) return a;
  const noteFolder = notePath && notePath.includes("/") ? notePath.slice(0, notePath.lastIndexOf("/")) : "";
  const sub = a.slice(2);
  return [noteFolder, sub].filter(Boolean).join("/");
}
