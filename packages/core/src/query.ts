/**
 * A subset of Dataview's query language (DQL), evaluated over NoteRecords.
 *
 *   TASK | LIST [WITHOUT ID] [expr] | TABLE [WITHOUT ID] expr [AS "name"], …
 *   FROM  #tag | "folder" | [[note]]   combined with AND, OR, -, !, ( )
 *   WHERE expr          (repeatable; combined with AND)
 *   SORT  expr [ASC|DESC], …
 *   GROUP BY expr
 *   LIMIT n
 *
 * Expressions: AND/OR/!, = != < <= > >=, + - * /, literals, fields (file.name,
 * due, status, …) and functions date(), dur(), contains(), icontains(),
 * startswith(), endswith(), lower(), upper(), length(), default().
 *
 * Zeolithe extension: `LIST Attn` lists individual Attn points (with their own
 * `resolved` field) instead of notes.
 */
import { toIsoDate } from "./dates";
import { parseInlineFields } from "./fields";
import { scanLines } from "./lines";
import type { NoteRecord } from "./note-record";
import type { AttnPoint, Task } from "./tasks";

export class QueryError extends Error {}

// ---------------------------------------------------------------------------
// Values

export interface Dur {
  dur: { days: number; months: number };
}
export interface LinkValue {
  link: string;
  name: string;
}
export type Value = string | number | boolean | null | Value[] | Dur | LinkValue;

const isDur = (v: unknown): v is Dur => typeof v === "object" && v !== null && "dur" in v;
export const isLink = (v: unknown): v is LinkValue => typeof v === "object" && v !== null && "link" in v;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function truthy(v: Value): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== false && v !== "" && v !== 0;
}

function scalar(v: Value): string | number | boolean | null {
  if (isLink(v)) return v.name;
  if (isDur(v)) return v.dur.months * 30 + v.dur.days;
  if (Array.isArray(v)) return v.map((x) => String(scalar(x))).join(", ");
  return v;
}

function compare(a: Value, b: Value): number {
  const x = scalar(a);
  const y = scalar(b);
  if (x === null && y === null) return 0;
  if (x === null) return -1;
  if (y === null) return 1;
  if (typeof x === "number" && typeof y === "number") return x - y;
  const sx = String(x);
  const sy = String(y);
  return sx < sy ? -1 : sx > sy ? 1 : 0;
}

function addDur(date: string, d: Dur, sign: 1 | -1): string {
  const [y, m, day] = date.slice(0, 10).split("-").map(Number) as [number, number, number];
  const r = new Date(y, m - 1 + sign * d.dur.months, day + sign * d.dur.days);
  return toIsoDate(r);
}

export function displayValue(v: Value): string {
  if (v === null || v === undefined) return "";
  if (isLink(v)) return v.name;
  if (isDur(v)) return `${v.dur.months ? `${v.dur.months} months ` : ""}${v.dur.days} days`.trim();
  if (Array.isArray(v)) return v.map(displayValue).join(", ");
  return String(v);
}

// ---------------------------------------------------------------------------
// Tokenizer

type Tok =
  | { t: "kw"; v: string; raw?: string }
  | { t: "id"; v: string }
  | { t: "str"; v: string }
  | { t: "num"; v: number }
  | { t: "tag"; v: string }
  | { t: "link"; v: string }
  | { t: "op"; v: string }
  | { t: "raw"; fn: string; v: string };

const KEYWORDS = new Set([
  "TASK", "LIST", "TABLE", "FROM", "WHERE", "SORT", "GROUP", "BY", "LIMIT",
  "ASC", "DESC", "ASCENDING", "DESCENDING", "AND", "OR", "AS", "WITHOUT", "ID",
  "FLATTEN", "CALENDAR",
]);

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\s+/.exec(rest))) {
      i += m[0].length;
    } else if ((m = /^(date|dur)\s*\(/i.exec(rest))) {
      // date(today) / dur(7 days): keep the raw argument text.
      const close = src.indexOf(")", i + m[0].length);
      if (close < 0) throw new QueryError(`Missing ")" after ${m[1]}(`);
      out.push({ t: "raw", fn: m[1]!.toLowerCase(), v: src.slice(i + m[0].length, close).trim().replace(/^"|"$/g, "") });
      i = close + 1;
    } else if ((m = /^"((?:[^"\\]|\\.)*)"/.exec(rest))) {
      out.push({ t: "str", v: m[1]!.replace(/\\(.)/g, "$1") });
      i += m[0].length;
    } else if ((m = /^\[\[([^\]]*)\]\]/.exec(rest))) {
      out.push({ t: "link", v: m[1]!.split("|")[0]!.trim() });
      i += m[0].length;
    } else if ((m = /^#[\p{L}\p{N}_\-/]+/u.exec(rest))) {
      out.push({ t: "tag", v: m[0].slice(1) });
      i += m[0].length;
    } else if ((m = /^\d+(\.\d+)?/.exec(rest))) {
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
    } else if ((m = /^[\p{L}_][\p{L}\p{N}_]*(\.[\p{L}_][\p{L}\p{N}_]*)*/u.exec(rest))) {
      const up = m[0].toUpperCase();
      out.push(KEYWORDS.has(up) ? { t: "kw", v: up, raw: m[0] } : { t: "id", v: m[0] });
      i += m[0].length;
    } else if ((m = /^(!=|<=|>=|&&|\|\||[=<>!+\-*/(),&|])/.exec(rest))) {
      const op = m[0] === "&&" || m[0] === "&" ? "AND" : m[0] === "||" || m[0] === "|" ? "OR" : m[0];
      out.push(op === "AND" || op === "OR" ? { t: "kw", v: op } : { t: "op", v: op });
      i += m[0].length;
    } else {
      throw new QueryError(`Unexpected character "${rest[0]}"`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Parser

type Expr =
  | { k: "lit"; v: Value }
  | { k: "id"; name: string }
  | { k: "call"; fn: string; args: Expr[] }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "not"; e: Expr }
  | { k: "neg"; e: Expr };

type Source =
  | { k: "tag"; tag: string }
  | { k: "folder"; path: string }
  | { k: "link"; target: string }
  | { k: "and" | "or"; l: Source; r: Source }
  | { k: "not"; s: Source };

export interface Query {
  type: "TASK" | "LIST" | "TABLE";
  withoutId: boolean;
  fields: { expr: Expr; name: string }[];
  from?: Source;
  where: Expr[];
  sort: { expr: Expr; desc: boolean }[];
  groupBy?: Expr;
  limit?: number;
}

const CLAUSES = new Set(["FROM", "WHERE", "SORT", "GROUP", "LIMIT", "FLATTEN"]);

class Parser {
  private i = 0;
  constructor(
    private toks: Tok[],
    private src: string,
  ) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }
  private next(): Tok {
    const t = this.toks[this.i++];
    if (!t) throw new QueryError("Unexpected end of query");
    return t;
  }
  private isKw(v: string) {
    const t = this.peek();
    return t?.t === "kw" && t.v === v;
  }
  private isOp(v: string) {
    const t = this.peek();
    return t?.t === "op" && t.v === v;
  }
  private atClause() {
    const t = this.peek();
    return !t || (t.t === "kw" && CLAUSES.has(t.v));
  }
  private expectKw(v: string) {
    if (!this.isKw(v)) throw new QueryError(`Expected ${v}`);
    this.i++;
  }

  parse(): Query {
    const head = this.next();
    if (head.t !== "kw" || !["TASK", "LIST", "TABLE"].includes(head.v)) {
      throw new QueryError(`A query starts with TASK, LIST or TABLE${head.t === "kw" && head.v === "CALENDAR" ? " (CALENDAR is not supported)" : ""}`);
    }
    const q: Query = { type: head.v as Query["type"], withoutId: false, fields: [], where: [], sort: [] };
    if (q.type !== "TASK" && this.isKw("WITHOUT")) {
      this.i++;
      this.expectKw("ID");
      q.withoutId = true;
    }
    if (q.type === "LIST" && !this.atClause()) {
      const start = this.i;
      q.fields.push({ expr: this.expr(), name: this.text(start) });
    }
    if (q.type === "TABLE" && !this.atClause()) {
      do {
        const start = this.i;
        const expr = this.expr();
        let name = this.text(start);
        if (this.isKw("AS")) {
          this.i++;
          const t = this.next();
          if (t.t !== "str" && t.t !== "id") throw new QueryError("Expected a name after AS");
          name = String(t.v);
        }
        q.fields.push({ expr, name });
      } while (this.isOp(",") && ++this.i);
    }
    while (this.peek()) {
      const t = this.next();
      if (t.t !== "kw") throw new QueryError(`Unexpected "${"v" in t ? t.v : ""}"; expected FROM, WHERE, SORT, GROUP BY or LIMIT`);
      if (t.v === "FROM") q.from = this.source();
      else if (t.v === "WHERE") q.where.push(this.expr());
      else if (t.v === "SORT") {
        do {
          const expr = this.expr();
          let desc = false;
          if (this.isKw("DESC") || this.isKw("DESCENDING")) (desc = true), this.i++;
          else if (this.isKw("ASC") || this.isKw("ASCENDING")) this.i++;
          q.sort.push({ expr, desc });
        } while (this.isOp(",") && ++this.i);
      } else if (t.v === "GROUP") {
        this.expectKw("BY");
        q.groupBy = this.expr();
      } else if (t.v === "LIMIT") {
        const n = this.next();
        if (n.t !== "num") throw new QueryError("LIMIT needs a number");
        q.limit = n.v;
      } else if (t.v === "FLATTEN") {
        throw new QueryError("FLATTEN is not supported yet");
      } else {
        throw new QueryError(`Unexpected ${t.v}`);
      }
    }
    return q;
  }

  /** Source text of the tokens consumed since `start` (for column names). */
  private text(start: number): string {
    return this.toks
      .slice(start, this.i)
      .map((t) => (t.t === "str" ? `"${t.v}"` : t.t === "raw" ? `${t.fn}(${t.v})` : t.t === "tag" ? `#${t.v}` : t.t === "link" ? `[[${t.v}]]` : t.t === "kw" ? (t.raw ?? t.v) : String(t.v)))
      .join(" ")
      .replace(/\s*([(),.])\s*/g, "$1")
      .replace(/,/g, ", ");
  }

  // FROM sources
  private source(): Source {
    let l = this.sourceAnd();
    while (this.isKw("OR")) {
      this.i++;
      l = { k: "or", l, r: this.sourceAnd() };
    }
    return l;
  }
  private sourceAnd(): Source {
    let l = this.sourceUnary();
    while (this.isKw("AND")) {
      this.i++;
      l = { k: "and", l, r: this.sourceUnary() };
    }
    return l;
  }
  private sourceUnary(): Source {
    if (this.isOp("-") || this.isOp("!")) {
      this.i++;
      return { k: "not", s: this.sourceUnary() };
    }
    const t = this.next();
    if (t.t === "tag") return { k: "tag", tag: t.v };
    if (t.t === "str") return { k: "folder", path: t.v.replace(/\/+$/, "") };
    if (t.t === "link") return { k: "link", target: t.v };
    if (t.t === "op" && t.v === "(") {
      const s = this.source();
      if (!this.isOp(")")) throw new QueryError('Missing ")" in FROM');
      this.i++;
      return s;
    }
    throw new QueryError('FROM expects #tag, "folder" or [[note]]');
  }

  // Expressions
  expr(): Expr {
    let l = this.and();
    while (this.isKw("OR")) {
      this.i++;
      l = { k: "bin", op: "OR", l, r: this.and() };
    }
    return l;
  }
  private and(): Expr {
    let l = this.cmp();
    while (this.isKw("AND")) {
      this.i++;
      l = { k: "bin", op: "AND", l, r: this.cmp() };
    }
    return l;
  }
  private cmp(): Expr {
    let l = this.add();
    const t = this.peek();
    if (t?.t === "op" && ["=", "!=", "<", "<=", ">", ">="].includes(t.v)) {
      this.i++;
      l = { k: "bin", op: t.v, l, r: this.add() };
    }
    return l;
  }
  private add(): Expr {
    let l = this.mul();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.next() as { v: string }).v;
      l = { k: "bin", op, l, r: this.mul() };
    }
    return l;
  }
  private mul(): Expr {
    let l = this.unary();
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.next() as { v: string }).v;
      l = { k: "bin", op, l, r: this.unary() };
    }
    return l;
  }
  private unary(): Expr {
    if (this.isOp("!")) {
      this.i++;
      return { k: "not", e: this.unary() };
    }
    if (this.isOp("-")) {
      this.i++;
      return { k: "neg", e: this.unary() };
    }
    return this.primary();
  }
  private primary(): Expr {
    const t = this.next();
    switch (t.t) {
      case "str":
        return { k: "lit", v: t.v };
      case "num":
        return { k: "lit", v: t.v };
      case "raw":
        return { k: "call", fn: t.fn, args: [{ k: "lit", v: t.v }] };
      case "link":
        return { k: "lit", v: { link: t.v, name: t.v } };
      case "tag":
        return { k: "lit", v: `#${t.v}` };
      case "id": {
        const low = t.v.toLowerCase();
        if (low === "true" || low === "false") return { k: "lit", v: low === "true" };
        if (low === "null") return { k: "lit", v: null };
        if (this.isOp("(")) {
          this.i++;
          const args: Expr[] = [];
          if (!this.isOp(")")) {
            do args.push(this.expr());
            while (this.isOp(",") && ++this.i);
          }
          if (!this.isOp(")")) throw new QueryError(`Missing ")" after ${t.v}(`);
          this.i++;
          return { k: "call", fn: low, args };
        }
        return { k: "id", name: t.v };
      }
      case "kw":
        // Allow keywords that are also common field names.
        if (t.v === "ID") return { k: "id", name: "id" };
        throw new QueryError(`Unexpected ${t.v}`);
      case "op":
        if (t.v === "(") {
          const e = this.expr();
          if (!this.isOp(")")) throw new QueryError('Missing ")"');
          this.i++;
          return e;
        }
    }
    throw new QueryError(`Unexpected "${"v" in t ? t.v : "?"}" in ${this.src.length > 60 ? "query" : `"${this.src}"`}`);
  }
}

export function parseQuery(src: string): Query {
  const toks = tokenize(src);
  if (toks.length === 0) throw new QueryError("Empty query");
  return new Parser(toks, src.trim()).parse();
}

// ---------------------------------------------------------------------------
// Rows

type Fields = Map<string, Value>;

interface Row {
  record: NoteRecord;
  fields: Fields;
  task?: Task;
  attn?: AttnPoint;
}

function setField(map: Fields, key: string, value: Value) {
  map.set(key.toLowerCase(), value);
}

function fileFields(r: NoteRecord): Fields {
  const f: Fields = new Map();
  const tags = r.tags.map((t) => `#${t}`);
  const created = r.created ? r.created.slice(0, 10) : null;
  setField(f, "file.name", r.name);
  setField(f, "file.path", r.path);
  setField(f, "file.folder", r.folder);
  setField(f, "file.link", { link: r.path, name: r.name });
  setField(f, "file.tags", tags);
  setField(f, "file.etags", tags);
  setField(f, "file.ctime", r.created ?? null);
  setField(f, "file.cday", created);
  setField(f, "file.mtime", r.created ?? null);
  setField(f, "file.mday", created);
  setField(f, "file.tasks", r.tasks.length);
  return f;
}

function toValue(v: unknown): Value {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 16);
  if (Array.isArray(v)) return v.map(toValue);
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return v as Value;
}

function noteFields(r: NoteRecord): Fields {
  const f = fileFields(r);
  // Inline fields anywhere in the note (multiple values become a list).
  for (const l of scanLines(r.body)) {
    if (l.inCode) continue;
    for (const field of parseInlineFields(l.text)) {
      const k = field.key.toLowerCase();
      const prev = f.get(k);
      if (prev === undefined) f.set(k, field.value);
      else f.set(k, Array.isArray(prev) ? [...prev, field.value] : [prev, field.value]);
    }
  }
  for (const [k, v] of Object.entries(r.frontmatter)) setField(f, k, toValue(v));
  if (r.id) setField(f, "id", r.id);
  return f;
}

const STATUS_CHAR: Record<string, string> = { open: " ", done: "x", cancelled: "-", deferred: ">" };

function taskFields(r: NoteRecord, t: Task, base: Fields): Fields {
  const f = new Map(base);
  for (const field of parseInlineFields(t.raw)) setField(f, field.key, field.value);
  setField(f, "text", t.raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s?/, ""));
  setField(f, "status", t.status === "other" ? t.char : STATUS_CHAR[t.status]!);
  setField(f, "completed", t.status === "done");
  setField(f, "fullyCompleted", t.status === "done");
  setField(f, "checked", t.status !== "open");
  setField(f, "due", t.due ?? null);
  setField(f, "done", t.done ?? null);
  setField(f, "completion", t.done ?? null);
  setField(f, "tags", t.tags.map((x) => `#${x}`));
  setField(f, "line", t.line);
  setField(f, "assignees", t.assignees);
  setField(f, "link", { link: r.path, name: r.name });
  return f;
}

function attnFields(r: NoteRecord, a: AttnPoint, base: Fields): Fields {
  const f = new Map(base);
  setField(f, "attn", a.text);
  setField(f, "resolved", a.resolved ?? null);
  setField(f, "assignees", a.assignees);
  setField(f, "text", a.text);
  setField(f, "line", a.line);
  return f;
}

// ---------------------------------------------------------------------------
// Evaluation

function lookup(fields: Fields, name: string): Value {
  const v = fields.get(name.toLowerCase());
  return v === undefined ? null : v;
}

function evalExpr(e: Expr, row: Fields, today: Date): Value {
  switch (e.k) {
    case "lit":
      return e.v;
    case "id":
      return lookup(row, e.name);
    case "not":
      return !truthy(evalExpr(e.e, row, today));
    case "neg": {
      const v = evalExpr(e.e, row, today);
      return typeof v === "number" ? -v : null;
    }
    case "bin": {
      if (e.op === "AND") return truthy(evalExpr(e.l, row, today)) && truthy(evalExpr(e.r, row, today));
      if (e.op === "OR") return truthy(evalExpr(e.l, row, today)) || truthy(evalExpr(e.r, row, today));
      const l = evalExpr(e.l, row, today);
      const r = evalExpr(e.r, row, today);
      switch (e.op) {
        case "=":
          return compare(l, r) === 0 && (l === null) === (r === null);
        case "!=":
          return compare(l, r) !== 0 || (l === null) !== (r === null);
        case "<":
        case "<=":
        case ">":
        case ">=": {
          if (l === null || r === null) return false;
          const c = compare(l, r);
          return e.op === "<" ? c < 0 : e.op === "<=" ? c <= 0 : e.op === ">" ? c > 0 : c >= 0;
        }
        case "+":
        case "-": {
          const sign = e.op === "+" ? 1 : -1;
          if (typeof l === "string" && ISO_DATE.test(l) && isDur(r)) return addDur(l, r, sign);
          if (typeof l === "number" && typeof r === "number") return l + sign * r;
          if (e.op === "+" && (typeof l === "string" || typeof r === "string")) return `${displayValue(l)}${displayValue(r)}`;
          return null;
        }
        case "*":
          return typeof l === "number" && typeof r === "number" ? l * r : null;
        case "/":
          return typeof l === "number" && typeof r === "number" && r !== 0 ? l / r : null;
      }
      return null;
    }
    case "call":
      return callFn(e.fn, e.args.map((a) => evalExpr(a, row, today)), today);
  }
}

function parseDur(s: string): Dur {
  let days = 0;
  let months = 0;
  const re = /(\d+)\s*(d|days?|w|wks?|weeks?|m|mos?|months?|y|yrs?|years?)\b/gi;
  let any = false;
  for (const m of s.matchAll(re)) {
    any = true;
    const n = Number(m[1]);
    const u = m[2]!.toLowerCase();
    if (u.startsWith("d")) days += n;
    else if (u.startsWith("w")) days += 7 * n;
    else if (u.startsWith("y")) months += 12 * n;
    else months += n;
  }
  if (!any) throw new QueryError(`Cannot read duration "${s}"`);
  return { dur: { days, months } };
}

function callFn(fn: string, args: Value[], today: Date): Value {
  const s = (v: Value) => displayValue(v);
  const a0 = args[0] ?? null;
  const a1 = args[1] ?? null;
  switch (fn) {
    case "date": {
      const raw = s(a0).trim().toLowerCase();
      const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      if (raw === "today" || raw === "now") return toIsoDate(t);
      if (raw === "tomorrow") return addDur(toIsoDate(t), { dur: { days: 1, months: 0 } }, 1);
      if (raw === "yesterday") return addDur(toIsoDate(t), { dur: { days: 1, months: 0 } }, -1);
      if (ISO_DATE.test(raw)) return raw.slice(0, 10);
      throw new QueryError(`Cannot read date "${raw}"`);
    }
    case "dur":
      return parseDur(s(a0));
    case "contains":
    case "icontains": {
      const ci = fn === "icontains";
      const norm = (v: Value) => (ci ? s(v).toLowerCase() : s(v));
      if (Array.isArray(a0)) return a0.some((x) => norm(x) === norm(a1) || norm(x) === norm(`#${s(a1)}`));
      return norm(a0).includes(norm(a1));
    }
    case "startswith":
      return s(a0).startsWith(s(a1));
    case "endswith":
      return s(a0).endsWith(s(a1));
    case "lower":
      return s(a0).toLowerCase();
    case "upper":
      return s(a0).toUpperCase();
    case "length":
      return Array.isArray(a0) ? a0.length : s(a0).length;
    case "default":
      return a0 === null ? a1 : a0;
    case "link":
      return { link: s(a0), name: s(a0) };
  }
  throw new QueryError(`Unknown function ${fn}()`);
}

function matchSource(s: Source, r: NoteRecord): boolean {
  switch (s.k) {
    case "tag": {
      const t = s.tag.toLowerCase();
      return r.tags.some((x) => x.toLowerCase() === t || x.toLowerCase().startsWith(`${t}/`));
    }
    case "folder":
      return s.path === "" || r.path === `${s.path}.md` || r.path.startsWith(`${s.path}/`);
    case "link":
      return r.links.some((l) => l.target === s.target || l.target.split("/").pop() === s.target);
    case "and":
      return matchSource(s.l, r) && matchSource(s.r, r);
    case "or":
      return matchSource(s.l, r) || matchSource(s.r, r);
    case "not":
      return !matchSource(s.s, r);
  }
}

// ---------------------------------------------------------------------------
// Results

export interface ResultRow {
  path: string;
  name: string;
  /** Values of the LIST expression or TABLE columns. */
  values: Value[];
  task?: Task;
  attn?: AttnPoint;
}

export interface QueryResult {
  kind: "task" | "list" | "table" | "attn";
  /** Column headers (TABLE), including the leading file column unless WITHOUT ID. */
  headers: string[];
  withoutId: boolean;
  groups: { key?: Value; rows: ResultRow[] }[];
  count: number;
}

export function runQuery(source: string, notes: NoteRecord[], today: Date = new Date()): QueryResult {
  const q = parseQuery(source);
  const attnList = q.type === "LIST" && q.fields.length === 1 && q.fields[0]!.expr.k === "id" && q.fields[0]!.expr.name.toLowerCase() === "attn";

  const rows: Row[] = [];
  for (const r of notes) {
    if (q.from && !matchSource(q.from, r)) continue;
    const base = noteFields(r);
    if (q.type === "TASK") for (const t of r.tasks) rows.push({ record: r, fields: taskFields(r, t, base), task: t });
    else if (attnList) for (const a of r.attn) rows.push({ record: r, fields: attnFields(r, a, base), attn: a });
    else rows.push({ record: r, fields: base });
  }

  let filtered = rows.filter((row) => q.where.every((w) => truthy(evalExpr(w, row.fields, today))));
  if (q.sort.length) {
    filtered = [...filtered].sort((a, b) => {
      for (const s of q.sort) {
        const c = compare(evalExpr(s.expr, a.fields, today), evalExpr(s.expr, b.fields, today));
        if (c !== 0) return s.desc ? -c : c;
      }
      return 0;
    });
  } else if (q.type !== "TASK" && !attnList) {
    filtered = [...filtered].sort((a, b) => a.record.name.localeCompare(b.record.name));
  }
  if (q.limit !== undefined) filtered = filtered.slice(0, q.limit);

  const toResult = (row: Row): ResultRow => ({
    path: row.record.path,
    name: row.record.name,
    values: attnList ? [] : q.fields.map((f) => evalExpr(f.expr, row.fields, today)),
    task: row.task,
    attn: row.attn,
  });

  let groups: QueryResult["groups"];
  if (q.groupBy) {
    const map = new Map<string, { key: Value; rows: ResultRow[] }>();
    for (const row of filtered) {
      const key = evalExpr(q.groupBy, row.fields, today);
      const id = displayValue(key);
      if (!map.has(id)) map.set(id, { key, rows: [] });
      map.get(id)!.rows.push(toResult(row));
    }
    groups = [...map.values()].sort((a, b) => compare(a.key, b.key));
  } else {
    groups = [{ rows: filtered.map(toResult) }];
  }

  return {
    kind: q.type === "TASK" ? "task" : attnList ? "attn" : q.type === "TABLE" ? "table" : "list",
    headers: q.type === "TABLE" ? [...(q.withoutId ? [] : ["File"]), ...q.fields.map((f) => f.name)] : [],
    withoutId: q.withoutId,
    groups,
    count: filtered.length,
  };
}
