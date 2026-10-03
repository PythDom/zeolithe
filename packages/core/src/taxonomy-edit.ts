/**
 * Editing the taxonomy note. Changes rewrite only the tables of the note
 * (PARA, Categories, one table per Sub-PARA list); the rest of the text is
 * kept as written. Codes used by note IDs cannot be removed or changed,
 * because IDs never change.
 */
import { parseId } from "./ids";
import { scanLines } from "./lines";
import { isValidTag } from "./tags";
import { parseTaxonomy, type Taxonomy, type TaxonomyEntry } from "./taxonomy";

export type TaxonomyKind = "para" | "category" | "sub";

export class TaxonomyEditError extends Error {}

const CODE = /^\d{2}$/;

function listOf(tax: Taxonomy, kind: TaxonomyKind, para?: string): TaxonomyEntry[] {
  if (kind === "para") return tax.paras;
  if (kind === "category") return tax.categories;
  if (!para) throw new TaxonomyEditError("A Sub-PARA needs its PARA code.");
  if (!tax.paras.some((p) => p.code === para)) throw new TaxonomyEditError(`Unknown PARA ${para}.`);
  return tax.subParas[para] ?? [];
}

function cloneTax(tax: Taxonomy): Taxonomy {
  return {
    paras: tax.paras.map((e) => ({ ...e })),
    categories: tax.categories.map((e) => ({ ...e })),
    subParas: Object.fromEntries(Object.entries(tax.subParas).map(([k, v]) => [k, v.map((e) => ({ ...e }))])),
    warnings: [],
  };
}

function setList(tax: Taxonomy, kind: TaxonomyKind, list: TaxonomyEntry[], para?: string) {
  const sorted = [...list].sort((a, b) => a.code.localeCompare(b.code));
  if (kind === "para") tax.paras = sorted;
  else if (kind === "category") tax.categories = sorted;
  else tax.subParas[para!] = sorted;
}

/** Lowest free code, starting at `from` (default 00). */
export function suggestCode(tax: Taxonomy, kind: TaxonomyKind, para?: string, from = 0): string {
  const used = new Set(listOf(tax, kind, para).map((e) => e.code));
  for (let n = from; n <= 99; n++) {
    const c = String(n).padStart(2, "0");
    if (!used.has(c)) return c;
  }
  throw new TaxonomyEditError("All codes 00–99 are used.");
}

/** How many note IDs use a code. */
export function codeUsage(ids: Iterable<string>, kind: TaxonomyKind, code: string, para?: string): number {
  let n = 0;
  for (const s of ids) {
    const id = parseId(s);
    if (!id) continue;
    if (kind === "para" && id.para === code) n++;
    else if (kind === "category" && id.category === code) n++;
    else if (kind === "sub" && id.para === para && id.sub === code) n++;
  }
  return n;
}

export interface EntryInput {
  code?: string;
  tag: string;
  folder?: string;
}

export function addEntry(tax: Taxonomy, kind: TaxonomyKind, input: EntryInput, para?: string): Taxonomy {
  const list = listOf(tax, kind, para);
  const tag = input.tag.trim().replace(/^#/, "");
  const code = input.code?.trim() || suggestCode(tax, kind, para);
  if (!CODE.test(code)) throw new TaxonomyEditError(`Code "${code}" must be two digits (00–99).`);
  if (!isValidTag(tag)) throw new TaxonomyEditError(`"${tag}" is not a valid tag (letters, digits, _ - /; not only digits).`);
  const clash = list.find((e) => e.code === code);
  if (clash) throw new TaxonomyEditError(`Code ${code} is already #${clash.tag}.`);
  if (list.some((e) => e.tag.toLowerCase() === tag.toLowerCase())) throw new TaxonomyEditError(`#${tag} is already in this list.`);
  const next = cloneTax(tax);
  const entry: TaxonomyEntry = { code, tag };
  if (kind === "para") entry.folder = input.folder?.trim().replace(/\/+$/, "") || `${code} ${tag}`;
  setList(next, kind, [...list, entry], para);
  return next;
}

export function renameEntry(tax: Taxonomy, kind: TaxonomyKind, code: string, newTag: string, para?: string): Taxonomy {
  const list = listOf(tax, kind, para);
  const tag = newTag.trim().replace(/^#/, "");
  if (!isValidTag(tag)) throw new TaxonomyEditError(`"${tag}" is not a valid tag.`);
  if (!list.some((e) => e.code === code)) throw new TaxonomyEditError(`No entry with code ${code}.`);
  if (list.some((e) => e.code !== code && e.tag.toLowerCase() === tag.toLowerCase())) throw new TaxonomyEditError(`#${tag} is already in this list.`);
  const next = cloneTax(tax);
  setList(next, kind, list.map((e) => (e.code === code ? { ...e, tag } : { ...e })), para);
  return next;
}

/** Change the vault folder of a PARA (where its numbered notes go). */
export function setParaFolder(tax: Taxonomy, code: string, folder: string): Taxonomy {
  const clean = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!clean) throw new TaxonomyEditError("The folder name cannot be empty.");
  if (/[:*?"<>|#^[\]]/.test(clean) || clean.split("/").some((p) => !p.trim() || p.startsWith("."))) {
    throw new TaxonomyEditError(`"${clean}" cannot be used as a folder name.`);
  }
  if (!tax.paras.some((e) => e.code === code)) throw new TaxonomyEditError(`No PARA with code ${code}.`);
  const other = tax.paras.find((e) => e.code !== code && e.folder?.toLowerCase() === clean.toLowerCase());
  if (other) throw new TaxonomyEditError(`"${clean}" is already the folder of #${other.tag}.`);
  const next = cloneTax(tax);
  next.paras = next.paras.map((e) => (e.code === code ? { ...e, folder: clean } : e));
  return next;
}

/** Remove an entry; refused while note IDs still use its code. */
export function removeEntry(tax: Taxonomy, kind: TaxonomyKind, code: string, ids: Iterable<string>, para?: string): Taxonomy {
  const list = listOf(tax, kind, para);
  if (!list.some((e) => e.code === code)) throw new TaxonomyEditError(`No entry with code ${code}.`);
  const used = codeUsage(ids, kind, code, para);
  if (used > 0) throw new TaxonomyEditError(`Code ${code} is used by ${used} note ID${used > 1 ? "s" : ""}; it cannot be removed.`);
  const next = cloneTax(tax);
  setList(next, kind, list.filter((e) => e.code !== code), para);
  if (kind === "para") delete next.subParas[code];
  return next;
}

// ---------------------------------------------------------------------------
// Writing the note

function table(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i]!)).join(" | ")} |`;
  return [line(headers), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...rows.map(line)];
}

const paraTable = (tax: Taxonomy) => table(["Code", "Tag", "Folder"], tax.paras.map((e) => [e.code, `#${e.tag}`, `\`${e.folder}/\``]));
const plainTable = (list: TaxonomyEntry[]) => table(["Code", "Tag"], list.map((e) => [e.code, `#${e.tag}`]));

type Kind = "para" | "category" | "sub" | null;

function sectionKind(title: string): Kind {
  return /\(XX\)/i.test(title) ? "para" : /\(YY\)/i.test(title) ? "category" : /\(ZZ\)/i.test(title) ? "sub" : null;
}

/** A blank taxonomy note with the standard sections. */
export function taxonomyTemplate(tax: Taxonomy): string {
  return serializeInto(
    [
      "# Taxonomy",
      "",
      "Codes used to build note identifiers `XX.YY.ZZ.NNN` (PARA . Category . Sub-PARA . sequence).",
      "Manage it from Zeolite (Manage taxonomy) or edit the tables directly.",
      "",
      "## PARA (XX)",
      "",
      "## Categories (YY)",
      "",
      "## Sub-PARA (ZZ)",
      "",
    ].join("\n"),
    tax,
  );
}

/**
 * Write `tax` into an existing taxonomy note, replacing only its tables.
 * Missing sections and Sub-PARA headings are added.
 */
export function serializeInto(markdown: string, tax: Taxonomy): string {
  const lines = markdown.split("\n");
  const scanned = scanLines(markdown);

  // Locate sections (level ≤ 2 headings) and Sub-PARA headings (level 3+).
  interface Block {
    kind: Kind;
    para?: string;
    start: number; // heading line
    end: number; // exclusive
  }
  const blocks: Block[] = [];
  let current: Block | null = null;
  let sub: Block | null = null;
  const close = (b: Block | null, at: number) => b && (b.end = at);
  for (const l of scanned) {
    if (l.inCode) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(l.text);
    if (!h) continue;
    const level = h[1]!.length;
    if (level <= 2) {
      close(sub, l.index);
      close(current, l.index);
      sub = null;
      current = { kind: sectionKind(h[2]!), start: l.index, end: lines.length };
      blocks.push(current);
    } else if (current?.kind === "sub") {
      close(sub, l.index);
      const m = /^(\d{2})\b/.exec(h[2]!);
      sub = m ? { kind: "sub", para: m[1], start: l.index, end: current.end } : null;
      if (sub) blocks.push(sub);
    }
  }
  if (sub) sub.end = current?.end ?? lines.length;

  // Replacement plan: [start, end) line ranges → new lines. Applied bottom-up.
  const edits: { start: number; end: number; insert: string[] }[] = [];

  /** Range of the first table in [from, to), or null. */
  const findTable = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      if (lines[i]!.trim().startsWith("|")) {
        let j = i;
        while (j < to && lines[j]!.trim().startsWith("|")) j++;
        return { start: i, end: j };
      }
    }
    return null;
  };

  const replaceTableIn = (b: { start: number; end: number }, newTable: string[], limit?: number) => {
    const to = limit ?? b.end;
    const t = findTable(b.start + 1, to);
    if (t) edits.push({ start: t.start, end: t.end, insert: newTable });
    else edits.push({ start: b.start + 1, end: b.start + 1, insert: ["", ...newTable] });
  };

  const sections = new Map<Kind, Block>();
  // Top-level sections are the blocks without a PARA code (first one wins).
  for (const b of blocks) if (b.kind && !b.para && !sections.has(b.kind)) sections.set(b.kind, b);

  const appendAtEnd: string[] = [];
  const paraSec = sections.get("para");
  if (paraSec) replaceTableIn(paraSec, paraTable(tax));
  else appendAtEnd.push("", "## PARA (XX)", "", ...paraTable(tax));

  const catSec = sections.get("category");
  if (catSec) replaceTableIn(catSec, plainTable(tax.categories));
  else appendAtEnd.push("", "## Categories (YY)", "", ...plainTable(tax.categories));

  const subSec = sections.get("sub");
  const subHeads = blocks.filter((b) => b.kind === "sub" && b.para);
  const subLines: string[] = [];
  for (const p of tax.paras) {
    const list = tax.subParas[p.code] ?? [];
    const head = subHeads.find((b) => b.para === p.code);
    if (head) {
      const t = findTable(head.start + 1, head.end);
      if (list.length) replaceTableIn(head, plainTable(list));
      else if (t) edits.push({ start: t.start, end: t.end, insert: ["No Sub-PARAs."] });
    } else if (list.length) {
      subLines.push("", `### ${p.code} ${p.tag}`, "", ...plainTable(list));
    }
  }
  if (subSec) {
    if (subLines.length) {
      // Insert new Sub-PARA lists at the end of the section, before trailing blank lines.
      let at = subSec.end;
      while (at > subSec.start + 1 && lines[at - 1]!.trim() === "") at--;
      edits.push({ start: at, end: at, insert: subLines });
    }
  } else if (subLines.length) {
    appendAtEnd.push("", "## Sub-PARA (ZZ)", ...subLines);
  }

  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) lines.splice(e.start, e.end - e.start, ...e.insert);
  let out = lines.join("\n");
  if (appendAtEnd.length) out = out.replace(/\s*$/, "\n") + appendAtEnd.join("\n") + "\n";
  return out;
}

/** Parse, apply an edit, and write back — the usual round trip. */
export function editTaxonomyNote(markdown: string, edit: (tax: Taxonomy) => Taxonomy): string {
  const tax = parseTaxonomy(markdown);
  return serializeInto(markdown, edit(tax));
}
