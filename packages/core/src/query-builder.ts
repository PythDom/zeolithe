/**
 * Build Dataview queries from a simple form. The generated text is plain DQL,
 * so the same block works in Zeolite and in Obsidian with Dataview.
 */

export type QueryTarget = "tasks" | "attn" | "notes" | "table";
export type TaskStatusFilter = "open" | "done" | "cancelled" | "deferred" | "any";
export type DueFilter = "any" | "overdue" | "today" | "week" | "next" | "has" | "none";
export type AttnFilter = "open" | "resolved" | "any";
export type QuerySort = "due" | "name" | "created-desc" | "created" | "id" | "none";
export type QueryGroup = "none" | "file" | "due" | "folder";

export interface QuerySpec {
  target: QueryTarget;
  /** Notes having any of these tags (no '#'). */
  tags: string[];
  /** Restrict to a folder (vault-relative), "" for the whole vault. */
  folder: string;
  /** Exclude archived notes (the Archives folder). */
  excludeFolder?: string;
  status: TaskStatusFilter;
  due: DueFilter;
  /** Days ahead for due = "next". */
  dueDays: number;
  attn: AttnFilter;
  /** Person without '@'. */
  person: string;
  /** Text the task/Attn/note name must contain (case-insensitive). */
  text: string;
  /** ID prefix such as "01.02" (notes and table). */
  idPrefix: string;
  /** Extra columns for the table target. */
  columns: string[];
  sort: QuerySort;
  group: QueryGroup;
  limit: number;
}

export const DEFAULT_QUERY: QuerySpec = {
  target: "tasks",
  tags: [],
  folder: "",
  excludeFolder: "",
  status: "open",
  due: "any",
  dueDays: 7,
  attn: "open",
  person: "",
  text: "",
  idPrefix: "",
  columns: ["id", "file.tags", "created"],
  sort: "due",
  group: "file",
  limit: 0,
};

const q = (s: string) => `"${s.replace(/["\\]/g, "\\$&")}"`;

function fromClause(spec: QuerySpec): string {
  const parts: string[] = [];
  const tags = spec.tags.map((t) => `#${t.replace(/^#/, "")}`);
  if (tags.length === 1) parts.push(tags[0]!);
  else if (tags.length > 1) parts.push(`(${tags.join(" OR ")})`);
  if (spec.folder.trim()) parts.push(q(spec.folder.trim().replace(/\/+$/, "")));
  if (spec.excludeFolder?.trim()) parts.push(`-${q(spec.excludeFolder.trim().replace(/\/+$/, ""))}`);
  if (parts.length === 0) return "";
  // A source list starting with an exclusion needs something to subtract from.
  if (parts.length === 1 && parts[0]!.startsWith("-")) return `FROM "" AND ${parts[0]}`;
  return `FROM ${parts.join(" AND ")}`;
}

function dueCondition(spec: QuerySpec): string | null {
  switch (spec.due) {
    case "overdue":
      return "due AND due < date(today)";
    case "today":
      return "due = date(today)";
    case "week":
      return "due AND due <= date(today) + dur(7 days)";
    case "next":
      return `due AND due >= date(today) AND due <= date(today) + dur(${Math.max(1, spec.dueDays)} days)`;
    case "has":
      return "due";
    case "none":
      return "!due";
    default:
      return null;
  }
}

const STATUS: Record<Exclude<TaskStatusFilter, "any">, string> = {
  open: 'status = " "',
  done: "completed",
  cancelled: 'status = "-"',
  deferred: 'status = ">"',
};

export function buildQuery(spec: QuerySpec): string {
  const lines: string[] = [];
  const where: string[] = [];
  const person = spec.person.trim().replace(/^@/, "");
  const text = spec.text.trim();

  if (spec.target === "tasks") {
    lines.push("TASK");
    if (spec.status !== "any") where.push(STATUS[spec.status]);
    const due = dueCondition(spec);
    if (due) where.push(due);
    if (person) where.push(`contains(text, ${q(`@${person}`)})`);
    if (text) where.push(`icontains(text, ${q(text)})`);
  } else if (spec.target === "attn") {
    lines.push("LIST Attn");
    where.push("Attn");
    if (spec.attn === "open") where.push("!resolved");
    if (spec.attn === "resolved") where.push("resolved");
    if (person) where.push(`contains(Attn, ${q(`@${person}`)})`);
    if (text) where.push(`icontains(Attn, ${q(text)})`);
  } else {
    if (spec.target === "notes") lines.push("LIST");
    else lines.push(`TABLE ${(spec.columns.length ? spec.columns : ["id"]).join(", ")}`);
    if (spec.idPrefix.trim()) where.push(`startswith(id, ${q(spec.idPrefix.trim())})`);
    if (text) where.push(`icontains(file.name, ${q(text)})`);
  }

  const from = fromClause(spec);
  if (from) lines.push(from);
  if (where.length) lines.push(`WHERE ${where.join(" AND ")}`);

  const sort: Record<Exclude<QuerySort, "none">, string> = {
    due: spec.target === "tasks" ? "due ASC" : "file.name ASC",
    name: "file.name ASC",
    "created-desc": "file.ctime DESC",
    created: "file.ctime ASC",
    id: "id ASC",
  };
  if (spec.sort !== "none") lines.push(`SORT ${sort[spec.sort]}`);

  const group: Record<Exclude<QueryGroup, "none">, string> = { file: "file.link", due: "due", folder: "file.folder" };
  if (spec.group !== "none" && !(spec.group === "due" && spec.target !== "tasks")) lines.push(`GROUP BY ${group[spec.group]}`);
  if (spec.limit > 0) lines.push(`LIMIT ${spec.limit}`);
  return lines.join("\n");
}

/** Wrap a query in a fenced block ready to insert into a note. */
export function queryBlock(query: string): string {
  return "```dataview\n" + query + "\n```";
}
