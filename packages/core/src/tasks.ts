import { isIsoDate, parseNaturalDate, toIsoDate } from "./dates";
import { getField, parseInlineFields, removeBracketField, setBracketField } from "./fields";
import { scanLines, stripInlineCode } from "./lines";
import { extractInlineTags } from "./tags";

export type TaskStatus = "open" | "done" | "cancelled" | "deferred" | "other";

export interface Task {
  /** 0-based line number in the note. */
  line: number;
  status: TaskStatus;
  /** The character between the brackets. */
  char: string;
  /** Task text with inline fields removed. */
  text: string;
  raw: string;
  due?: string;
  done?: string;
  assignees: string[];
  tags: string[];
}

export interface AttnPoint {
  line: number;
  text: string;
  raw: string;
  /** True when written as [Attn:: …] inside a line. */
  inline: boolean;
  resolved?: string;
  assignees: string[];
}

/** Task markers are recognised only at the start of a list item. */
const TASK = /^(\s*)([-*+]|\d+[.)])\s+\[(.)\](\s|$)(.*)$/;
const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const ASSIGNEE = /(^|[\s(])@([\p{L}\p{N}_.\-]*[\p{L}\p{N}_])/gu;

const STATUS_CHARS: Record<string, TaskStatus> = {
  " ": "open",
  x: "done",
  X: "done",
  "-": "cancelled",
  ">": "deferred",
};
const CHAR_FOR: Record<Exclude<TaskStatus, "other">, string> = {
  open: " ",
  done: "x",
  cancelled: "-",
  deferred: ">",
};
const CYCLE: Exclude<TaskStatus, "other">[] = ["open", "done", "cancelled", "deferred"];

export function extractAssignees(text: string): string[] {
  const out = new Set<string>();
  for (const m of stripInlineCode(text).matchAll(ASSIGNEE)) out.add(m[2]!);
  return [...out];
}

function stripFields(text: string): string {
  let out = text;
  for (const f of parseInlineFields(text).filter((f) => f.bracketed).sort((a, b) => b.start - a.start)) {
    out = out.slice(0, f.start) + out.slice(f.end);
  }
  return out.replace(/\s+/g, " ").trim();
}

export function parseTaskLine(text: string, line = 0): Task | null {
  const m = TASK.exec(text);
  if (!m) return null;
  const char = m[3]!;
  const body = m[5]!;
  const due = getField(body, "due")?.value;
  const done = getField(body, "done")?.value;
  return {
    line,
    status: STATUS_CHARS[char] ?? "other",
    char,
    text: stripFields(body),
    raw: text,
    due: due || undefined,
    done: done || undefined,
    assignees: extractAssignees(body),
    tags: extractInlineTags(body),
  };
}

export function parseTasks(markdown: string): Task[] {
  const out: Task[] = [];
  for (const l of scanLines(markdown)) {
    if (l.inCode) continue;
    const t = parseTaskLine(l.text, l.index);
    if (t) out.push(t);
  }
  return out;
}

export function parseAttnLine(text: string, line = 0): AttnPoint | null {
  const field = parseInlineFields(text).find((f) => f.key.toLowerCase() === "attn");
  if (!field) return null;
  const resolved = getField(text, "resolved")?.value;
  return {
    line,
    text: field.value.replace(/\s+/g, " ").trim(),
    raw: text,
    inline: field.bracketed,
    resolved: resolved || undefined,
    assignees: extractAssignees(field.value),
  };
}

export function parseAttnPoints(markdown: string): AttnPoint[] {
  const out: AttnPoint[] = [];
  for (const l of scanLines(markdown)) {
    if (l.inCode) continue;
    const a = parseAttnLine(l.text, l.index);
    if (a) out.push(a);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Line transforms used by the toolbar buttons. Each takes one line of text and
// returns its replacement (which may contain a newline for Attn → task).

/** Turn a line into an open task. Already-a-task lines are returned unchanged. */
export function makeTask(line: string): string {
  if (TASK.test(line)) return line;
  if (parseAttnLine(line)) return convertAttnToTask(line);
  const lm = LIST.exec(line);
  if (lm) return `${lm[1]}${lm[2]} [ ] ${lm[3]}`;
  const indent = /^\s*/.exec(line)![0];
  const rest = line.slice(indent.length);
  return `${indent}- [ ] ${rest}`;
}

export function setTaskStatus(line: string, status: Exclude<TaskStatus, "other">, today: Date = new Date()): string {
  const m = TASK.exec(line);
  if (!m) return line;
  let out = `${m[1]}${m[2]} [${CHAR_FOR[status]}]${m[4] || " "}${m[5]}`;
  out = status === "done" ? setBracketField(out, "done", toIsoDate(today)) : removeBracketField(out, "done");
  return out;
}

/** open → done → cancelled → deferred → open. Non-tasks become open tasks. */
export function cycleTaskStatus(line: string, today: Date = new Date()): string {
  const t = parseTaskLine(line);
  if (!t) return makeTask(line);
  const idx = t.status === "other" ? -1 : CYCLE.indexOf(t.status);
  return setTaskStatus(line, CYCLE[(idx + 1) % CYCLE.length]!, today);
}

/** Toggle between open and done (used by checkboxes in the preview). */
export function toggleTaskDone(line: string, today: Date = new Date()): string {
  const t = parseTaskLine(line);
  if (!t) return line;
  return setTaskStatus(line, t.status === "done" ? "open" : "done", today);
}

export function setDue(line: string, isoDate: string): string {
  return setBracketField(makeTask(line), "due", isoDate);
}

/**
 * Convert natural-language values of [due:: …] fields to ISO dates.
 * Unrecognised values are left as typed.
 */
export function convertDueFields(line: string, today: Date = new Date()): string {
  let out = line;
  const fields = parseInlineFields(line)
    .filter((f) => f.bracketed && f.key.toLowerCase() === "due" && !isIsoDate(f.value))
    .sort((a, b) => b.start - a.start);
  for (const f of fields) {
    const iso = parseNaturalDate(f.value, today);
    if (!iso) continue;
    const open = out[f.start];
    const close = out[f.end - 1];
    out = `${out.slice(0, f.start)}${open}${f.key}:: ${iso}${close}${out.slice(f.end)}`;
  }
  return out;
}

/** Turn a line into an Attn point (`Attn:: text`). */
export function makeAttn(line: string): string {
  if (parseAttnLine(line)) return line;
  const tm = TASK.exec(line);
  if (tm) return `${tm[1]}Attn:: ${tm[5]}`;
  const lm = LIST.exec(line);
  if (lm) return `${lm[1]}${lm[2]} Attn:: ${lm[3]}`;
  const indent = /^\s*/.exec(line)![0];
  return `${indent}Attn:: ${line.slice(indent.length)}`;
}

/** Add or remove [resolved:: date] on an Attn line. */
export function toggleAttnResolved(line: string, today: Date = new Date()): string {
  const a = parseAttnLine(line);
  if (!a) return line;
  return a.resolved ? removeBracketField(line, "resolved") : setBracketField(line, "resolved", toIsoDate(today));
}

/**
 * `Attn:: X` → `- [ ] X`. For an inline `[Attn:: X]`, the sentence keeps X as
 * plain text and a new task line `- [ ] X` is added below it.
 */
export function convertAttnToTask(line: string): string {
  const field = parseInlineFields(line).find((f) => f.key.toLowerCase() === "attn");
  if (!field) return line;
  const cleaned = removeBracketField(line, "resolved");
  const indent = /^\s*/.exec(line)![0];
  if (!field.bracketed) {
    // Keep the list marker of `- Attn:: X` / `1. Attn:: X`; plain lines get "-".
    const lm = LIST.exec(cleaned);
    const marker = lm && field.start > indent.length ? lm[2] : "-";
    const text = cleaned.slice(field.start).replace(/^[^:]*::\s*/, "");
    return `${indent}${marker} [ ] ${text}`.replace(/\s+$/, "");
  }
  const f2 = parseInlineFields(cleaned).find((f) => f.key.toLowerCase() === "attn")!;
  const sentence = cleaned.slice(0, f2.start) + f2.value + cleaned.slice(f2.end);
  return `${sentence}\n${indent}- [ ] ${f2.value}`;
}
