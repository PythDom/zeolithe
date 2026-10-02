import { scanLines, stripInlineCode } from "./lines";

/** Obsidian tag characters: letters, digits, _, -, / ; must not be purely numeric. */
const TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]+)/gu;

export function isValidTag(tag: string): boolean {
  return /^[\p{L}\p{N}_\-/]+$/u.test(tag) && !/^[\d/]+$/.test(tag);
}

export function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "");
}

/** Inline #tags in the body (outside code, frontmatter, and URLs). */
export function extractInlineTags(markdown: string): string[] {
  const tags = new Set<string>();
  for (const line of scanLines(markdown)) {
    if (line.inCode) continue;
    const text = stripInlineCode(line.text).replace(/\[\[[^\]]*\]\]|\]\([^)]*\)|https?:\/\/\S+/g, " ");
    for (const m of text.matchAll(TAG)) {
      const tag = m[2]!.replace(/\/+$/, "");
      if (isValidTag(tag)) tags.add(tag);
    }
  }
  return [...tags];
}

/** Every tag of a note: frontmatter `tags` plus inline tags, deduplicated. */
export function collectTags(frontmatterTags: unknown, markdown: string): string[] {
  const fm: string[] = [];
  if (Array.isArray(frontmatterTags)) fm.push(...frontmatterTags.map(String));
  else if (typeof frontmatterTags === "string") fm.push(...frontmatterTags.split(/[,\s]+/));
  const all = new Set([...fm.map(normalizeTag).filter(isValidTag), ...extractInlineTags(markdown)]);
  return [...all];
}

/**
 * Rename a tag in a note body (inline occurrences only). Nested children
 * follow: renaming `a` to `b` turns `#a/x` into `#b/x`.
 */
export function renameInlineTag(markdown: string, from: string, to: string): string {
  const lines = markdown.split("\n");
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[\\s(,;])#${esc}(?=$|[^\\p{L}\\p{N}_\\-]|/)`, "gu");
  for (const l of scanLines(markdown)) {
    if (l.inCode) continue;
    lines[l.index] = l.text.replace(re, `$1#${to}`);
  }
  return lines.join("\n");
}
