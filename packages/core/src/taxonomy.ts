import { scanLines } from "./lines";

export interface TaxonomyEntry {
  /** Two-digit code, e.g. "05". */
  code: string;
  /** Tag without '#', e.g. "Typhoon". */
  tag: string;
  /** Vault folder (PARA only), e.g. "01 Projets". */
  folder?: string;
}

export interface Taxonomy {
  paras: TaxonomyEntry[];
  categories: TaxonomyEntry[];
  /** Sub-PARAs keyed by PARA code. */
  subParas: Record<string, TaxonomyEntry[]>;
  warnings: string[];
}

type Section = "para" | "category" | "sub" | null;

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/**
 * Parse the taxonomy note (`_system/Taxonomy.md`).
 *
 * Sections are recognised by their heading: one containing "(XX)" holds the
 * PARAs, "(YY)" the categories, "(ZZ)" the Sub-PARAs. Inside the Sub-PARA
 * section, each "### NN Name" heading starts the list for PARA NN.
 * Table rows are `| NN | #Tag | optional folder |`.
 */
export function parseTaxonomy(markdown: string): Taxonomy {
  const tax: Taxonomy = { paras: [], categories: [], subParas: {}, warnings: [] };
  let section: Section = null;
  let subPara: string | null = null;

  for (const l of scanLines(markdown)) {
    if (l.inCode) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(l.text);
    if (h) {
      const level = h[1]!.length;
      const title = h[2]!;
      if (level <= 2) {
        section = /\(XX\)/i.test(title) ? "para" : /\(YY\)/i.test(title) ? "category" : /\(ZZ\)/i.test(title) ? "sub" : null;
        subPara = null;
      } else if (section === "sub") {
        const m = /^(\d{2})\b/.exec(title);
        subPara = m ? m[1]! : null;
        if (subPara) tax.subParas[subPara] ??= [];
      }
      continue;
    }
    if (!section || !l.text.trim().startsWith("|")) continue;
    const [code, tagCell, folderCell] = cells(l.text);
    if (!code || !/^\d{2}$/.test(code) || !tagCell?.startsWith("#")) continue;
    const entry: TaxonomyEntry = { code, tag: tagCell.slice(1).trim() };
    if (!entry.tag) continue;

    let list: TaxonomyEntry[];
    if (section === "para") {
      entry.folder = folderCell?.replace(/`/g, "").replace(/\/+$/, "").trim() || `${code} ${entry.tag}`;
      list = tax.paras;
    } else if (section === "category") {
      list = tax.categories;
    } else {
      if (!subPara) continue;
      list = tax.subParas[subPara]!;
    }
    if (list.some((e) => e.code === code)) {
      tax.warnings.push(`Duplicate code ${code} (${entry.tag}) on line ${l.index + 1}; ignored.`);
      continue;
    }
    list.push(entry);
  }

  for (const p of Object.keys(tax.subParas)) {
    if (!tax.paras.some((e) => e.code === p)) tax.warnings.push(`Sub-PARA list for unknown PARA ${p}.`);
  }
  return tax;
}

export function findPara(tax: Taxonomy, code: string) {
  return tax.paras.find((e) => e.code === code);
}
export function findCategory(tax: Taxonomy, code: string) {
  return tax.categories.find((e) => e.code === code);
}
export function findSubPara(tax: Taxonomy, para: string, code: string) {
  return tax.subParas[para]?.find((e) => e.code === code);
}

/** The PARA used for archiving: the one tagged "Archives" (or code 04). */
export function archivePara(tax: Taxonomy): TaxonomyEntry | undefined {
  return tax.paras.find((e) => e.tag.toLowerCase() === "archives") ?? findPara(tax, "04");
}

/** PARAs that can receive new numbered notes (those with Sub-PARAs). */
export function numberablePara(tax: Taxonomy): TaxonomyEntry[] {
  return tax.paras.filter((p) => (tax.subParas[p.code]?.length ?? 0) > 0);
}

/** Every tag defined by the taxonomy. */
export function taxonomyTags(tax: Taxonomy): string[] {
  return [
    ...tax.paras.map((e) => e.tag),
    ...tax.categories.map((e) => e.tag),
    ...Object.values(tax.subParas).flat().map((e) => e.tag),
  ];
}
