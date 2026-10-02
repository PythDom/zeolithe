import { findCategory, findPara, findSubPara, type Taxonomy } from "./taxonomy";

/** XX.YY.ZZ.NNN = PARA . Category . Sub-PARA . Sequential */
export interface NoteId {
  para: string;
  category: string;
  sub: string;
  seq: number;
}

const ID = /^(\d{2})\.(\d{2})\.(\d{2})\.(\d{3})$/;
const ID_PREFIX = /^(\d{2}\.\d{2}\.\d{2}\.\d{3})(?:\s|$)/;
export const MAX_SEQ = 999;

export function parseId(s: string): NoteId | null {
  const m = ID.exec(s.trim());
  if (!m) return null;
  return { para: m[1]!, category: m[2]!, sub: m[3]!, seq: Number(m[4]) };
}

export function formatId(id: NoteId): string {
  return `${id.para}.${id.category}.${id.sub}.${String(id.seq).padStart(3, "0")}`;
}

export function idPrefix(para: string, category: string, sub: string): string {
  return `${para}.${category}.${sub}`;
}

/** Next free sequence number for a prefix: highest existing + 1. */
export function nextSeq(prefix: string, existingIds: Iterable<string>): number {
  let max = 0;
  for (const s of existingIds) {
    const id = parseId(s);
    if (id && idPrefix(id.para, id.category, id.sub) === prefix) max = Math.max(max, id.seq);
  }
  if (max >= MAX_SEQ) throw new Error(`No sequence numbers left for ${prefix} (max ${MAX_SEQ}).`);
  return max + 1;
}

export function nextId(para: string, category: string, sub: string, existingIds: Iterable<string>): string {
  return formatId({ para, category, sub, seq: nextSeq(idPrefix(para, category, sub), existingIds) });
}

/** Characters that break file names on Windows/Android or Obsidian links. */
export function sanitizeTitle(title: string): string {
  return title
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
}

export function noteFileName(id: string, title: string): string {
  const t = sanitizeTitle(title);
  return t ? `${id} ${t}.md` : `${id}.md`;
}

/** ID at the start of a file name, if any. */
export function idFromFileName(name: string): string | null {
  const base = name.split("/").pop()!.replace(/\.md$/i, "");
  return ID_PREFIX.exec(base)?.[1] ?? null;
}

/** Tags implied by an ID: PARA, Category, Sub-PARA (only those found). */
export function tagsForId(tax: Taxonomy, id: NoteId): string[] {
  return [
    findPara(tax, id.para)?.tag,
    findCategory(tax, id.category)?.tag,
    findSubPara(tax, id.para, id.sub)?.tag,
  ].filter((t): t is string => !!t);
}

export interface IdentifiedNote {
  path: string;
  id: string;
  /** ISO timestamp from the `created` property (may be missing). */
  created?: string;
}

export interface IdCollision {
  id: string;
  /** The note that keeps the ID (earliest created). */
  keep: IdentifiedNote;
  /** Notes to renumber (created later). */
  renumber: IdentifiedNote[];
}

/** Notes sharing an ID. The earliest-created keeps it; the others are flagged. */
export function findCollisions(notes: IdentifiedNote[]): IdCollision[] {
  const byId = new Map<string, IdentifiedNote[]>();
  for (const n of notes) {
    const list = byId.get(n.id) ?? [];
    list.push(n);
    byId.set(n.id, list);
  }
  const out: IdCollision[] = [];
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    // Missing `created` sorts last; ties fall back to path for stable output.
    const sorted = [...list].sort((a, b) => {
      const ca = a.created ?? "￿";
      const cb = b.created ?? "￿";
      return ca < cb ? -1 : ca > cb ? 1 : a.path.localeCompare(b.path);
    });
    out.push({ id, keep: sorted[0]!, renumber: sorted.slice(1) });
  }
  return out;
}
