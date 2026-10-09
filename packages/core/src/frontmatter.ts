import { Document, isScalar, parse, visit } from "yaml";

export interface SplitNote {
  /** Parsed frontmatter, {} when absent or invalid. */
  data: Record<string, unknown>;
  /** Raw YAML text between the fences ("" when absent). */
  raw: string;
  /** Note body after the frontmatter. */
  body: string;
  hasFrontmatter: boolean;
}

const FM = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?/;

export function splitFrontmatter(markdown: string): SplitNote {
  const m = FM.exec(markdown);
  if (!m) return { data: {}, raw: "", body: markdown, hasFrontmatter: false };
  let data: Record<string, unknown> = {};
  try {
    const parsed = parse(m[1]!);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    // Invalid YAML: keep the note readable, treat as no properties.
  }
  return { data, raw: m[1]!, body: markdown.slice(m[0].length), hasFrontmatter: true };
}

/** Why a note's properties cannot be read (invalid YAML), or null when they can. */
export function frontmatterError(markdown: string): string | null {
  const m = FM.exec(markdown);
  if (!m) return null;
  try {
    const parsed = parse(m[1]!);
    if (parsed !== null && parsed !== undefined && (typeof parsed !== "object" || Array.isArray(parsed))) return "the properties must be “name: value” lines";
    return null;
  } catch (e) {
    const err = e as { linePos?: { line: number }[]; message?: string };
    const line = err.linePos?.[0]?.line;
    // Line in the note: the properties start after the opening ---.
    return `${line ? `line ${line + 1}: ` : ""}${(err.message ?? "invalid YAML").split("\n")[0]}`;
  }
}

export function serializeFrontmatter(data: Record<string, unknown>): string {
  // Short lists of scalars are written inline, like Obsidian: tags: [a, b]
  const doc = new Document(data);
  visit(doc, {
    Seq(_, node) {
      if (node.items.every((i) => isScalar(i))) node.flow = true;
    },
  });
  const yaml = doc.toString({ flowCollectionPadding: false, lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n`;
}

/** Replace the frontmatter of a note, keeping its body unchanged. */
export function withFrontmatter(markdown: string, data: Record<string, unknown>): string {
  return serializeFrontmatter(data) + splitFrontmatter(markdown).body;
}

/** Add tags to the frontmatter `tags` list (no duplicates). */
export function addFrontmatterTags(markdown: string, tags: string[]): string {
  const { data } = splitFrontmatter(markdown);
  const current = Array.isArray(data.tags) ? data.tags.map(String) : typeof data.tags === "string" ? [data.tags] : [];
  const next = [...current];
  for (const t of tags) if (!next.includes(t)) next.push(t);
  return withFrontmatter(markdown, { ...data, tags: next });
}
