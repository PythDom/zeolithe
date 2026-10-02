import { scanLines } from "./lines";

export interface Heading {
  level: number;
  text: string;
  /** 0-based line number. */
  line: number;
}

const ATX = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
export const TOC_START = "<!-- toc -->";
export const TOC_END = "<!-- /toc -->";

export function extractHeadings(markdown: string): Heading[] {
  const out: Heading[] = [];
  for (const l of scanLines(markdown)) {
    if (l.inCode) continue;
    const m = ATX.exec(l.text);
    if (m && m[2]) out.push({ level: m[1]!.length, text: m[2], line: l.index });
  }
  return out;
}

/** Heading text as Obsidian expects it in [[#…]] links. */
export function headingLinkText(text: string): string {
  return text
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
    .replace(/[#|^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface TocOptions {
  minLevel?: number;
  maxLevel?: number;
}

/** Markdown bullet list of [[#Heading]] links. */
export function generateToc(markdown: string, opts: TocOptions = {}): string {
  const min = opts.minLevel ?? 1;
  const max = opts.maxLevel ?? 6;
  const hs = extractHeadings(markdown).filter((h) => h.level >= min && h.level <= max);
  if (hs.length === 0) return "";
  const base = Math.min(...hs.map((h) => h.level));
  return hs
    .map((h) => `${"  ".repeat(h.level - base)}- [[#${headingLinkText(h.text)}]]`)
    .join("\n");
}

/**
 * Write a static TOC between <!-- toc --> markers. Replaces an existing one;
 * otherwise inserts it at `atLine` (0-based, default: after frontmatter/title).
 */
export function upsertStaticToc(markdown: string, atLine?: number, opts: TocOptions = {}): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === TOC_START);
  const end = lines.findIndex((l, i) => i > start && l.trim() === TOC_END);
  const withoutToc = start >= 0 && end > start ? [...lines.slice(0, start), ...lines.slice(end + 1)].join("\n") : markdown;
  const block = [TOC_START, generateToc(withoutToc, opts), TOC_END];
  if (start >= 0 && end > start) {
    lines.splice(start, end - start + 1, ...block);
    return lines.join("\n");
  }
  let at = atLine;
  if (at === undefined) {
    const scanned = scanLines(markdown);
    const firstBody = scanned.findIndex((l) => !l.inCode);
    const h1 = extractHeadings(markdown).find((h) => h.level === 1);
    at = h1 ? h1.line + 1 : Math.max(firstBody, 0);
  }
  lines.splice(at, 0, ...block, "");
  return lines.join("\n");
}
