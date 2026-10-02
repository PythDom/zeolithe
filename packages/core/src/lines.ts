/**
 * Line-oriented helpers shared by the parsers. Markdown inside fenced code
 * blocks must never be interpreted as tasks, tags, headings or fields.
 */

export interface ScannedLine {
  /** 0-based line number. */
  index: number;
  text: string;
  /** True when the line is inside (or delimits) a fenced code block. */
  inCode: boolean;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export function scanLines(markdown: string): ScannedLine[] {
  const lines = markdown.split(/\r?\n/);
  const out: ScannedLine[] = [];
  let fence: string | null = null;
  let inFrontmatter = lines[0] === "---";
  lines.forEach((text, index) => {
    if (inFrontmatter) {
      out.push({ index, text, inCode: true });
      if (index > 0 && (text === "---" || text === "...")) inFrontmatter = false;
      return;
    }
    const m = FENCE.exec(text);
    if (fence === null && m) {
      fence = m[1]!;
      out.push({ index, text, inCode: true });
    } else if (fence !== null) {
      out.push({ index, text, inCode: true });
      if (m && m[1]!.startsWith(fence[0]!) && m[1]!.length >= fence.length && text.trim() === m[1]) {
        fence = null;
      }
    } else {
      out.push({ index, text, inCode: false });
    }
  });
  return out;
}

/** Remove inline code spans so their content is not parsed. */
export function stripInlineCode(text: string): string {
  return text.replace(/(`+)[^`]*?\1/g, (s) => " ".repeat(s.length));
}
