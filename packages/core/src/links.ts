import { scanLines } from "./lines";

export interface WikiLink {
  target: string;
  heading?: string;
  alias?: string;
  embed: boolean;
  line: number;
}

const WIKI = /(!?)\[\[([^\]|#^]*)(?:[#^]([^\]|]*))?(?:\|([^\]]*))?\]\]/g;

export function extractLinks(markdown: string): WikiLink[] {
  const out: WikiLink[] = [];
  for (const l of scanLines(markdown)) {
    if (l.inCode) continue;
    for (const m of l.text.matchAll(WIKI)) {
      out.push({
        embed: m[1] === "!",
        target: m[2]!.trim(),
        heading: m[3] || undefined,
        alias: m[4] || undefined,
        line: l.index,
      });
    }
  }
  return out;
}

/** Note name as used in wiki links: file name without folder and .md. */
export function linkNameOf(path: string): string {
  return path.split("/").pop()!.replace(/\.md$/i, "");
}

/** Rewrite [[old…]] links to [[new…]], keeping headings and aliases. */
export function replaceLinkTarget(markdown: string, oldName: string, newName: string): string {
  return markdown.replace(WIKI, (all, bang: string, target: string) => {
    const t = target.trim();
    if (t !== oldName && linkNameOf(t) !== oldName) return all;
    const replaced = t.includes("/") ? t.slice(0, t.lastIndexOf("/") + 1) + newName : newName;
    return all.replace(`${bang}[[${target}`, `${bang}[[${replaced}`);
  });
}
