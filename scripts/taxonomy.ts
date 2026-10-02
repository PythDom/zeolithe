/**
 * Manage a vault's taxonomy (_system/Taxonomy.md) from the command line.
 *
 *   npm run taxonomy -- list                                  [--vault DIR]
 *   npm run taxonomy -- add category <Tag>         [--code NN]
 *   npm run taxonomy -- add sub <PARA> <Tag>       [--code NN]
 *   npm run taxonomy -- add para <Tag>             [--code NN] [--folder "NN Name"]
 *   npm run taxonomy -- rename category <NN> <NewTag>         [--notes]
 *   npm run taxonomy -- rename sub <PARA> <NN> <NewTag>       [--notes]
 *   npm run taxonomy -- rename para <NN> <NewTag>             [--notes]
 *   npm run taxonomy -- remove category <NN>
 *   npm run taxonomy -- remove sub <PARA> <NN>
 *   npm run taxonomy -- remove para <NN>
 *
 * --vault defaults to the current directory. --notes also renames the tag in
 * every note of the vault. Codes used by note IDs cannot be removed.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import {
  addEntry,
  buildNoteRecord,
  codeUsage,
  editTaxonomyNote,
  parseTaxonomy,
  removeEntry,
  renameEntry,
  renameInlineTag,
  splitFrontmatter,
  TAXONOMY_PATH,
  taxonomyTemplate,
  withFrontmatter,
  type Taxonomy,
  type TaxonomyKind,
} from "../packages/core/src/index";

const IGNORED = new Set([".obsidian", ".git", ".trash", ".stfolder", ".stversions", "node_modules"]);

// Output piped into `head` and closed early is not an error.
process.stdout.on("error", (e: NodeJS.ErrnoException) => e.code === "EPIPE" && process.exit(0));

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// --- arguments ----------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = new Map<string, string | true>();
const args: string[] = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]!;
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (key === "notes") flags.set(key, true);
    else if (next !== undefined) flags.set(key, (i++, next));
    else fail(`--${key} needs a value`);
  } else args.push(a);
}
const vault = String(flags.get("vault") ?? process.cwd());
const file = join(vault, ...TAXONOMY_PATH.split("/"));

// --- vault helpers ------------------------------------------------------------
function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!IGNORED.has(e.name)) out.push(...markdownFiles(join(dir, e.name)));
    } else if (e.name.toLowerCase().endsWith(".md")) out.push(join(dir, e.name));
  }
  return out;
}

function vaultIds(): string[] {
  return markdownFiles(vault)
    .map((f) => buildNoteRecord(relative(vault, f).split(sep).join("/"), readFileSync(f, "utf8")).id)
    .filter((x): x is string => !!x);
}

function renameTagInNotes(from: string, to: string): number {
  let changed = 0;
  for (const f of markdownFiles(vault)) {
    const text = readFileSync(f, "utf8");
    let next = renameInlineTag(text, from, to);
    const { data, hasFrontmatter } = splitFrontmatter(next);
    if (hasFrontmatter && Array.isArray(data.tags)) {
      const tags = data.tags.map((t) => {
        const s = String(t).replace(/^#/, "");
        return s === from ? to : s.startsWith(`${from}/`) ? to + s.slice(from.length) : t;
      });
      if (tags.some((t, i) => t !== (data.tags as unknown[])[i])) next = withFrontmatter(next, { ...data, tags });
    }
    if (next !== text) {
      writeFileSync(f, next);
      changed++;
    }
  }
  return changed;
}

function load(): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function save(edit: (t: Taxonomy) => Taxonomy) {
  const current = load();
  const next = current ? editTaxonomyNote(current, edit) : taxonomyTemplate(edit(parseTaxonomy("")));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, next);
}

function kindOf(word: string | undefined): TaxonomyKind {
  const k = (word ?? "").toLowerCase();
  if (k === "para") return "para";
  if (k === "category" || k === "cat" || k === "categories") return "category";
  if (k === "sub" || k === "subpara" || k === "sub-para") return "sub";
  return fail(`Expected para, category or sub (got "${word ?? ""}")`);
}

// --- commands -----------------------------------------------------------------
const [cmd, ...rest] = args;
try {
  switch (cmd) {
    case "list":
    case undefined: {
      const tax = parseTaxonomy(load());
      if (!existsSync(file)) console.log(`(no ${TAXONOMY_PATH} in ${vault} yet)`);
      const ids = vaultIds();
      const row = (code: string, tag: string, used: number, extra = "") =>
        `  ${code}  #${tag.padEnd(24)} ${String(used).padStart(4)} IDs${extra ? `  ${extra}` : ""}`;
      console.log("PARA (XX)");
      for (const p of tax.paras) console.log(row(p.code, p.tag, codeUsage(ids, "para", p.code), `${p.folder}/`));
      console.log("\nCategories (YY)");
      for (const c of tax.categories) console.log(row(c.code, c.tag, codeUsage(ids, "category", c.code)));
      for (const p of tax.paras) {
        const subs = tax.subParas[p.code] ?? [];
        if (!subs.length) continue;
        console.log(`\nSub-PARA (ZZ) · ${p.code} ${p.tag}`);
        for (const s of subs) console.log(row(s.code, s.tag, codeUsage(ids, "sub", s.code, p.code)));
      }
      for (const w of tax.warnings) console.log(`\n⚠ ${w}`);
      break;
    }
    case "add": {
      const kind = kindOf(rest[0]);
      const para = kind === "sub" ? rest[1] : undefined;
      const tag = kind === "sub" ? rest[2] : rest[1];
      if (!tag) fail("Missing tag");
      const code = flags.get("code") as string | undefined;
      const folder = flags.get("folder") as string | undefined;
      let added = "";
      save((t) => {
        const next = addEntry(t, kind, { code, tag, folder }, para);
        const list = kind === "para" ? next.paras : kind === "category" ? next.categories : next.subParas[para!]!;
        const e = list.find((x) => x.tag === tag.replace(/^#/, ""))!;
        added = `${e.code} · #${e.tag}${e.folder ? ` (${e.folder}/)` : ""}`;
        return next;
      });
      console.log(`✓ Added ${kind === "sub" ? `Sub-PARA under ${para}` : kind}: ${added}`);
      break;
    }
    case "rename": {
      const kind = kindOf(rest[0]);
      const [para, code, tag] = kind === "sub" ? [rest[1], rest[2], rest[3]] : [undefined, rest[1], rest[2]];
      if (!code || !tag) fail("Usage: rename <kind> [PARA] <code> <NewTag>");
      const tax = parseTaxonomy(load());
      const list = kind === "para" ? tax.paras : kind === "category" ? tax.categories : (tax.subParas[para!] ?? []);
      const old = list.find((e) => e.code === code)?.tag;
      save((t) => renameEntry(t, kind, code, tag, para));
      const to = tag.replace(/^#/, "");
      console.log(`✓ Renamed ${code}: #${old} → #${to}`);
      if (flags.has("notes") && old) console.log(`✓ Updated ${renameTagInNotes(old, to)} note(s)`);
      break;
    }
    case "remove": {
      const kind = kindOf(rest[0]);
      const [para, code] = kind === "sub" ? [rest[1], rest[2]] : [undefined, rest[1]];
      if (!code) fail("Usage: remove <kind> [PARA] <code>");
      save((t) => removeEntry(t, kind, code, vaultIds(), para));
      console.log(`✓ Removed ${kind} ${code}`);
      break;
    }
    default:
      fail(`Unknown command "${cmd}". Use list, add, rename or remove.`);
  }
} catch (e) {
  fail((e as Error).message);
}
