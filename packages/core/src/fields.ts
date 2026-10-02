/**
 * Dataview-style inline fields:
 *   key:: value          at the start of a line (or list item) — "line field"
 *   [key:: value]        anywhere in a line — "bracket field"
 *   (key:: value)        anywhere in a line — same, but hidden key in Dataview
 */

export interface InlineField {
  key: string;
  value: string;
  /** Character offsets of the whole field in the line (including brackets). */
  start: number;
  end: number;
  bracketed: boolean;
}

const BRACKET = /[[(]([\p{L}\p{N}_\- ]+?)::\s*([^\])]*?)\s*[\])]/gu;
const LINE = /^(\s*(?:[-*+]\s+(?:\[.\]\s+)?|\d+[.)]\s+)?)([\p{L}\p{N}_\-]+)::\s*(.*)$/u;

export function parseInlineFields(line: string): InlineField[] {
  const fields: InlineField[] = [];
  for (const m of line.matchAll(BRACKET)) {
    fields.push({
      key: m[1]!.trim(),
      value: m[2]!,
      start: m.index!,
      end: m.index! + m[0].length,
      bracketed: true,
    });
  }
  const lm = LINE.exec(line);
  if (lm && !fields.some((f) => f.start <= lm[1]!.length)) {
    // The line field's value runs to end of line minus any bracket fields in it.
    const valueStart = line.length - lm[3]!.length;
    let value = lm[3]!;
    const inner = fields.filter((f) => f.start >= valueStart);
    for (const f of [...inner].sort((a, b) => b.start - a.start)) {
      value = value.slice(0, f.start - valueStart) + value.slice(f.end - valueStart);
    }
    fields.unshift({
      key: lm[2]!,
      value: value.replace(/\s+/g, " ").trim(),
      start: lm[1]!.length,
      end: line.length,
      bracketed: false,
    });
  }
  return fields;
}

export function getField(line: string, key: string): InlineField | undefined {
  const k = key.toLowerCase();
  return parseInlineFields(line).find((f) => f.key.toLowerCase() === k);
}

/** Set (or replace) a bracket field, appending it to the end of the line. */
export function setBracketField(line: string, key: string, value: string): string {
  const existing = parseInlineFields(line).find((f) => f.bracketed && f.key.toLowerCase() === key.toLowerCase());
  const field = `[${key}:: ${value}]`;
  if (existing) return line.slice(0, existing.start) + field + line.slice(existing.end);
  return `${line.replace(/\s+$/, "")} ${field}`;
}

export function removeBracketField(line: string, key: string): string {
  const existing = parseInlineFields(line).find((f) => f.bracketed && f.key.toLowerCase() === key.toLowerCase());
  if (!existing) return line;
  return (line.slice(0, existing.start).replace(/\s+$/, "") + line.slice(existing.end)).replace(/\s+$/, "");
}
