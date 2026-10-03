import { toIsoDate, toIsoMinute } from "./dates";
import { formatDate } from "./templates";
import { addFrontmatterTags, serializeFrontmatter, splitFrontmatter, withFrontmatter } from "./frontmatter";
import { formatId, idFromFileName, nextId, noteFileName, parseId, sanitizeTitle, tagsForId } from "./ids";
import { archivePara, findCategory, findPara, findSubPara, type Taxonomy } from "./taxonomy";

export const JOURNAL_FOLDER = "Journal";
export const INBOX_FOLDER = "Inbox";
export const ATTACHMENTS_FOLDER = "attachments";
export const TAXONOMY_PATH = "_system/Taxonomy.md";

export interface NewNote {
  path: string;
  content: string;
  id?: string;
}

export interface ParaNoteRequest {
  taxonomy: Taxonomy;
  para: string;
  category: string;
  sub: string;
  title: string;
  existingIds: Iterable<string>;
  now?: Date;
}

/** Create a numbered PARA note: `01 Projets/01.02.05.001 Title.md`. */
export function createParaNote(req: ParaNoteRequest): NewNote {
  const { taxonomy: tax, para, category, sub } = req;
  const p = findPara(tax, para);
  if (!p) throw new Error(`Unknown PARA ${para}.`);
  if (!findCategory(tax, category)) throw new Error(`Unknown category ${category}.`);
  if (!findSubPara(tax, para, sub)) throw new Error(`Unknown Sub-PARA ${sub} for PARA ${para}.`);

  const id = nextId(para, category, sub, req.existingIds);
  const now = req.now ?? new Date();
  const title = sanitizeTitle(req.title);
  const fm = serializeFrontmatter({ id, tags: tagsForId(tax, parseId(id)!), created: toIsoMinute(now) });
  return {
    id,
    path: `${p.folder}/${noteFileName(id, title)}`,
    content: `${fm}\n# ${title || id}\n\n`,
  };
}

export interface JournalSettings {
  /** Folder of daily notes (Obsidian's Daily Notes "folder"). */
  folder: string;
  /** File name format with moment tokens (Obsidian's Daily Notes "format"). */
  format: string;
}

export const DEFAULT_JOURNAL: JournalSettings = { folder: JOURNAL_FOLDER, format: "YYYY-MM-DD" };

/** `Journal/2026-10-02.md` by default; folder and format follow Obsidian's Daily Notes settings. */
export function createJournalNote(date: Date = new Date(), settings: JournalSettings = DEFAULT_JOURNAL): NewNote {
  const name = formatDate(date, settings.format || "YYYY-MM-DD").replace(/[\\:*?"<>|#^[\]]/g, "-");
  const folder = settings.folder.replace(/^\/+|\/+$/g, "");
  const title = name.split("/").pop()!;
  return {
    path: `${folder ? `${folder}/` : ""}${name}.md`,
    content: `${serializeFrontmatter({ tags: ["Journal"], created: toIsoMinute(date) })}\n# ${title}\n\n`,
  };
}

export function createInboxNote(title: string, now: Date = new Date(), folder: string = INBOX_FOLDER): NewNote {
  const t = sanitizeTitle(title) || `Note ${toIsoMinute(now).replace(":", "h")}`;
  const dir = folder.replace(/^\/+|\/+$/g, "");
  return {
    path: `${dir ? `${dir}/` : ""}${t}.md`,
    content: `${serializeFrontmatter({ created: toIsoMinute(now) })}\n# ${t}\n\n`,
  };
}

/** A free note: any folder, any file name, no ID. */
export function createFreeNote(folder: string, title: string, now: Date = new Date()): NewNote {
  const t = sanitizeTitle(title) || "Untitled";
  const dir = folder.replace(/^\/+|\/+$/g, "");
  return {
    path: dir ? `${dir}/${t}.md` : `${t}.md`,
    content: `${serializeFrontmatter({ created: toIsoMinute(now) })}\n# ${t}\n\n`,
  };
}

/**
 * Archive: move to the Archives folder and add the #Archives tag.
 * The ID and other tags are kept.
 */
export function archiveNote(tax: Taxonomy, path: string, content: string): NewNote {
  const arch = archivePara(tax);
  if (!arch) throw new Error("The taxonomy defines no Archives PARA.");
  const name = path.split("/").pop()!;
  return {
    path: `${arch.folder}/${name}`,
    content: addFrontmatterTags(content, [arch.tag]),
    id: (splitFrontmatter(content).data.id as string | undefined) ?? idFromFileName(name) ?? undefined,
  };
}

export function isArchived(tax: Taxonomy, path: string): boolean {
  const arch = archivePara(tax);
  return !!arch && path.startsWith(`${arch.folder}/`);
}

/** Give a note a new ID (collision repair): frontmatter `id` and file name. */
export function renumberNote(path: string, content: string, newId: string): NewNote {
  const { data } = splitFrontmatter(content);
  const parts = path.split("/");
  const name = parts.pop()!;
  const oldId = (data.id as string | undefined) ?? idFromFileName(name);
  const newName = oldId && name.startsWith(oldId) ? newId + name.slice(oldId.length) : name;
  return {
    id: newId,
    path: [...parts, newName].join("/"),
    content: withFrontmatter(content, { ...data, id: newId }),
  };
}

export interface AssignIdRequest {
  taxonomy: Taxonomy;
  path: string;
  content: string;
  para: string;
  category: string;
  sub: string;
  existingIds: Iterable<string>;
  /** Move the note into the new PARA's folder. */
  moveToParaFolder: boolean;
  /** Sequence number (1–999) chosen by hand; default: the next free one in the series. */
  seq?: number;
}

/**
 * Give a note a new ID (or its first one): next number for the chosen
 * PARA/Category/Sub-PARA, file name prefix, frontmatter `id`, and the
 * taxonomy tags of the old ID replaced by the new ones (other tags kept).
 */
export function assignId(req: AssignIdRequest): NewNote & { id: string } {
  const { taxonomy: tax } = req;
  const p = findPara(tax, req.para);
  if (!p) throw new Error(`Unknown PARA ${req.para}.`);
  if (!findCategory(tax, req.category)) throw new Error(`Unknown category ${req.category}.`);
  if (!findSubPara(tax, req.para, req.sub)) throw new Error(`Unknown Sub-PARA ${req.sub} for PARA ${req.para}.`);

  const { data } = splitFrontmatter(req.content);
  const parts = req.path.split("/");
  const name = parts.pop()!;
  const oldId = (typeof data.id === "string" && parseId(data.id) ? data.id : undefined) ?? idFromFileName(name) ?? undefined;
  const others = [...req.existingIds].filter((x) => x !== oldId);
  let id: string;
  if (req.seq === undefined) id = nextId(req.para, req.category, req.sub, others);
  else {
    if (!Number.isInteger(req.seq) || req.seq < 1 || req.seq > 999) throw new Error("The number must be between 001 and 999.");
    id = formatId({ para: req.para, category: req.category, sub: req.sub, seq: req.seq });
    if (others.includes(id)) throw new Error(`${id} is already used by another note.`);
  }

  const base = name.replace(/\.md$/i, "");
  const title = oldId && base.startsWith(oldId) ? base.slice(oldId.length).trim() : base;
  const fileName = noteFileName(id, title);
  const folder = req.moveToParaFolder ? p.folder! : parts.join("/");

  const oldTags = oldId ? tagsForId(tax, parseId(oldId)!) : [];
  const current = Array.isArray(data.tags) ? data.tags.map((t) => String(t).replace(/^#/, "")) : typeof data.tags === "string" ? [data.tags] : [];
  const kept = current.filter((t) => !oldTags.includes(t));
  const newTags = tagsForId(tax, parseId(id)!);
  const tags = [...newTags, ...kept.filter((t) => !newTags.includes(t))];

  const created = data.created ?? toIsoMinute(new Date());
  const { id: _old, tags: _t, created: _c, ...rest } = data;
  void _old;
  void _t;
  void _c;
  return {
    id,
    path: folder ? `${folder}/${fileName}` : fileName,
    content: withFrontmatter(req.content, { id, tags, created, ...rest }),
  };
}
