/**
 * Filing many notes at once (importing .md files, or numbering the notes
 * that have no ID yet): a PARA / Category / Sub-PARA suggested from the
 * closest numbered notes, and sequence numbers handed out across the batch.
 */
import { findCategory, findSubPara, numberablePara, type Taxonomy } from "./taxonomy";
import { formatId, idPrefix, MAX_SEQ, parseId } from "./ids";

export interface Filing {
  para: string;
  category: string;
  sub: string;
}

export interface FilingSuggestion extends Filing {
  /** Share of the neighbours' weight behind this choice (0–1). */
  confidence: number;
  /** The closest notes that voted for it, best first. */
  basis: string[];
}

/**
 * Suggest where a note belongs: the PARA / Category / Sub-PARA most of its
 * closest numbered notes share, weighted by how close they are. Only codes
 * still in the taxonomy are suggested; null when no neighbour has an ID.
 */
export function suggestFiling(
  neighbours: { path: string; score: number }[],
  idOf: (path: string) => string | undefined,
  tax: Taxonomy,
  take = 8,
): FilingSuggestion | null {
  const usable = new Set(numberablePara(tax).map((p) => p.code));
  const votes = new Map<string, { filing: Filing; weight: number; basis: string[] }>();
  let total = 0;
  let counted = 0;
  for (const n of neighbours) {
    if (counted >= take) break;
    const raw = idOf(n.path);
    const id = raw ? parseId(raw) : null;
    if (!id || !usable.has(id.para) || !findCategory(tax, id.category) || !findSubPara(tax, id.para, id.sub)) continue;
    counted++;
    const key = idPrefix(id.para, id.category, id.sub);
    const v = votes.get(key) ?? { filing: { para: id.para, category: id.category, sub: id.sub }, weight: 0, basis: [] };
    v.weight += n.score;
    v.basis.push(n.path);
    votes.set(key, v);
    total += n.score;
  }
  let best: { filing: Filing; weight: number; basis: string[] } | undefined;
  for (const v of votes.values()) if (!best || v.weight > best.weight) best = v;
  if (!best || total <= 0) return null;
  return { ...best.filing, confidence: best.weight / total, basis: best.basis };
}

export interface NumberRequest extends Filing {
  key: string;
  /** A number chosen by hand (1–999); otherwise the next free one. */
  seq?: number;
}

export interface NumberResult {
  id?: string;
  error?: string;
}

/**
 * IDs for a batch, in order: numbers typed by hand are kept (if free), the
 * others get the next free number of their series, counting the numbers
 * already given to earlier notes of the batch.
 */
export function allocateIds(rows: NumberRequest[], existingIds: Iterable<string>): Map<string, NumberResult> {
  const taken = new Set(existingIds);
  const out = new Map<string, NumberResult>();
  // Hand-typed numbers first, so that automatic ones go around them.
  for (const r of rows) {
    if (r.seq === undefined) continue;
    if (!Number.isInteger(r.seq) || r.seq < 1 || r.seq > MAX_SEQ) {
      out.set(r.key, { error: "Type a number from 001 to 999." });
      continue;
    }
    const id = formatId({ para: r.para, category: r.category, sub: r.sub, seq: r.seq });
    if (taken.has(id)) out.set(r.key, { error: `${id} is already used.` });
    else {
      taken.add(id);
      out.set(r.key, { id });
    }
  }
  for (const r of rows) {
    if (r.seq !== undefined) continue;
    const prefix = idPrefix(r.para, r.category, r.sub);
    let seq = 0;
    for (const s of taken) {
      const id = parseId(s);
      if (id && idPrefix(id.para, id.category, id.sub) === prefix) seq = Math.max(seq, id.seq);
    }
    if (seq >= MAX_SEQ) {
      out.set(r.key, { error: `No numbers left for ${prefix}.` });
      continue;
    }
    const id = formatId({ para: r.para, category: r.category, sub: r.sub, seq: seq + 1 });
    taken.add(id);
    out.set(r.key, { id });
  }
  return out;
}

/** A title for an imported note: its file name, or its first heading when the name says nothing. */
export function importTitle(fileName: string, text: string): string {
  const base = fileName.replace(/\.md$/i, "").trim();
  if (base && !/^(untitled|sans titre|note|new note|nouvelle note)( \d+)?$/i.test(base)) return base;
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(text.replace(/^---\n[\s\S]*?\n---\n?/, ""));
  return heading?.[1] ?? (base || "Imported note");
}

/** Point links in `text` at an attachment's new name (it got " 1" etc. on import). */
export function renameAttachmentLinks(text: string, from: string, to: string): string {
  if (from === to) return text;
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const encoded = encodeURI(from).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .replace(new RegExp(`(\\[\\[(?:[^\\]|]*/)?)${esc}(?=[\\]|#])`, "g"), `$1${to}`)
    .replace(new RegExp(`(\\]\\((?:[^)]*/)?)(?:${esc}|${encoded})(?=\\))`, "g"), `$1${encodeURI(to)}`);
}
