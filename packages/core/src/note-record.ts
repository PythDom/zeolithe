import { splitFrontmatter } from "./frontmatter";
import { idFromFileName, parseId } from "./ids";
import { extractLinks, linkNameOf, type WikiLink } from "./links";
import { parseAttnPoints, parseTasks, type AttnPoint, type Task } from "./tasks";
import { collectTags } from "./tags";
import { extractHeadings, type Heading } from "./toc";

/** Everything the index needs to know about one note. */
export interface NoteRecord {
  path: string;
  /** Link name: file name without .md. */
  name: string;
  folder: string;
  title: string;
  id?: string;
  created?: string;
  frontmatter: Record<string, unknown>;
  tags: string[];
  tasks: Task[];
  attn: AttnPoint[];
  headings: Heading[];
  links: WikiLink[];
  body: string;
  /** True for Syncthing conflict copies (not indexed as real notes). */
  conflict: boolean;
}

/**
 * OneDrive / SharePoint conflict copy: `Note-DESKTOP-AB12CD.md` (or
 * `Note-PCNAME-2.md`) next to `Note.md`, the suffix being a Windows computer
 * name (upper-case letters, digits, hyphens; at most 15 characters).
 * Returns the original note's path, or null.
 */
export function oneDriveConflictOf(path: string, exists: (path: string) => boolean): string | null {
  const m = /^(.*)\.md$/i.exec(path);
  if (!m) return null;
  const stem = m[1]!;
  const slash = stem.lastIndexOf("/");
  // Try each hyphen of the file name as the start of the computer name (names can contain hyphens).
  for (let i = stem.indexOf("-", slash + 1); i > slash + 1; i = stem.indexOf("-", i + 1)) {
    const suffix = stem.slice(i + 1).replace(/-\d{1,3}$/, "");
    if (suffix.length < 2 || suffix.length > 15 || !/^[A-Z0-9-]+$/.test(suffix) || !/[A-Z]/.test(suffix)) continue;
    const original = `${stem.slice(0, i)}.md`;
    if (exists(original)) return original;
  }
  return null;
}

export function isSyncConflict(path: string): boolean {
  return /\.sync-conflict-[^/]*\.md$/i.test(path);
}

export function buildNoteRecord(path: string, content: string): NoteRecord {
  const { data, body } = splitFrontmatter(content);
  const name = linkNameOf(path);
  const headings = extractHeadings(content);
  const fmId = typeof data.id === "string" && parseId(data.id) ? data.id : undefined;
  const created = data.created instanceof Date ? data.created.toISOString().slice(0, 16) : (data.created as string | undefined);
  return {
    path,
    name,
    folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
    title: headings.find((h) => h.level === 1)?.text ?? name,
    id: fmId ?? idFromFileName(path) ?? undefined,
    created: created ? String(created) : undefined,
    frontmatter: data,
    tags: collectTags(data.tags, content),
    tasks: parseTasks(content),
    attn: parseAttnPoints(content),
    headings,
    links: extractLinks(content),
    body,
    conflict: isSyncConflict(path),
  };
}
