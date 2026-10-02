/**
 * Chord sheets, compatible with the Obsidian "Chord Sheets" plugin:
 * ```chords blocks (also chords-guitar, chords-ukulele, chords-mandolin) with
 * chords over lyrics or inline in [brackets]. Lines starting with %c are chord
 * lines and %t lyrics, whatever they look like. A chord may carry its own
 * shape: Bbadd13[x13333] or D[x x 0 14 15 14].
 */

export type Instrument = "guitar" | "ukulele" | "mandolin";

export interface ParsedChord {
  root: string; // C, C#, Db…
  quality: string; // "", m, maj7, sus4, 7b9…
  bass?: string; // slash bass note
  /** Custom fingering written after the chord, e.g. "x13333". */
  shape?: string;
}

const NOTE = "[A-G](?:#|b)?";
const QUALITY = "(?:maj|min|mi|m|M|dim|aug|sus|add|°|ø|Δ|\\+|-)?(?:\\d{1,2})?(?:(?:maj|min|add|sus|dim|aug|no|omit|b|#|\\+|-|M)\\d{1,2})*(?:\\([^)\\s]*\\))?";
const CHORD_RE = new RegExp(`^(${NOTE})(${QUALITY})(?:\\/(${NOTE}))?(?:\\[([^\\]]*)\\])?$`);

export function parseChord(symbol: string): ParsedChord | null {
  const m = CHORD_RE.exec(symbol.trim());
  if (!m) return null;
  return { root: m[1]!, quality: m[2] ?? "", bass: m[3], shape: m[4] };
}

export function isChord(token: string): boolean {
  return parseChord(token) !== null;
}

/** Tokens allowed on a chord line besides chords: bars, repeats, N.C. … */
const FILLER = /^(\||\|\||\|:|:\||\/|-+|\.+|%|x\d+|\(x?\d+x?\)|\d+x|N\.?C\.?|\(|\)|\*+)$/i;

export type LineKind = "chords" | "lyrics" | "section" | "empty";

export interface ChordToken {
  symbol: string;
  /** Column of the symbol in the (marker-stripped) line text. */
  start: number;
  end: number;
}

export interface SheetLine {
  kind: LineKind;
  /** Line text without a %c / %t marker. */
  text: string;
  /** Chords with their columns (chord lines and inline [chords]). */
  chords: ChordToken[];
  /** Length of a stripped "%c " / "%t " marker. */
  marker: number;
}

const SECTION_WORD = /^\s*(?:intro|verse|chorus|bridge|outro|pre-?chorus|refrain|solo|interlude|couplet|instrumental)\b[^:]*:\s*$/i;

/** "[Verse 1]" (not a bracketed chord) or "Chorus:". */
function isSection(line: string): boolean {
  const b = /^\s*\[([^\]]+)\]\s*$/.exec(line);
  if (b) return !isChord(b[1]!.trim());
  return SECTION_WORD.test(line);
}

/** Chord symbols with their columns on a chord line, or null if not one. */
function chordTokens(text: string): ChordToken[] | null {
  const tokens: ChordToken[] = [];
  let any = false;
  for (const m of text.matchAll(/\S+/g)) {
    const tok = m[0];
    if (isChord(tok)) {
      tokens.push({ symbol: tok, start: m.index!, end: m.index! + tok.length });
      any = true;
    } else if (!FILLER.test(tok)) {
      return null;
    }
  }
  return any ? tokens : null;
}

/** Inline [chords] in a lyrics line. */
function inlineChords(text: string): ChordToken[] {
  const out: ChordToken[] = [];
  for (const m of text.matchAll(/\[([^\]\s]+)\]/g)) {
    if (isChord(m[1]!)) out.push({ symbol: m[1]!, start: m.index! + 1, end: m.index! + 1 + m[1]!.length });
  }
  return out;
}

export function parseSheet(text: string): SheetLine[] {
  return text.split("\n").map((raw): SheetLine => {
    const mk = /^%([ct])\s?/.exec(raw);
    const line = mk ? raw.slice(mk[0].length) : raw;
    const marker = mk ? mk[0].length : 0;
    if (!line.trim()) return { kind: "empty", text: line, chords: [], marker };
    if (mk?.[1] === "t") return { kind: "lyrics", text: line, chords: inlineChords(line), marker };
    if (mk?.[1] === "c") {
      const tokens: ChordToken[] = [];
      for (const m of line.matchAll(/\S+/g)) if (isChord(m[0])) tokens.push({ symbol: m[0], start: m.index!, end: m.index! + m[0].length });
      return { kind: "chords", text: line, chords: tokens, marker };
    }
    if (isSection(line)) return { kind: "section", text: line, chords: [], marker };
    const tokens = chordTokens(line);
    if (tokens) return { kind: "chords", text: line, chords: tokens, marker };
    return { kind: "lyrics", text: line, chords: inlineChords(line), marker };
  });
}

/** Distinct chord symbols in order of first appearance. */
export function sheetChords(text: string): string[] {
  const seen = new Set<string>();
  for (const l of parseSheet(text)) for (const c of l.chords) seen.add(c.symbol);
  return [...seen];
}

// ---------------------------------------------------------------------------
// Transposition

const SHARPS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
/** Usual spelling when the sheet shows no preference. */
const COMMON = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

export function noteIndex(note: string): number {
  const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[note[0]!.toUpperCase() as "C"]!;
  const acc = note.slice(1) === "#" ? 1 : note.slice(1) === "b" ? -1 : 0;
  return (base + acc + 12) % 12;
}

export type Spelling = "sharps" | "flats" | "common";

function spell(index: number, spelling: Spelling): string {
  const i = ((index % 12) + 12) % 12;
  return (spelling === "sharps" ? SHARPS : spelling === "flats" ? FLATS : COMMON)[i]!;
}

/** Sharps or flats, from the accidentals already used in a sheet. */
export function sheetSpelling(text: string): Spelling {
  let sharps = 0;
  let flats = 0;
  for (const l of parseSheet(text)) {
    for (const c of l.chords) {
      const p = parseChord(c.symbol)!;
      for (const n of [p.root, p.bass]) {
        if (n?.endsWith("#")) sharps++;
        if (n?.endsWith("b")) flats++;
      }
    }
  }
  return sharps > flats ? "sharps" : flats > sharps ? "flats" : "common";
}

export function transposeChord(symbol: string, semitones: number, spelling: Spelling = "common"): string {
  const p = parseChord(symbol);
  if (!p) return symbol;
  if (semitones % 12 === 0) return symbol;
  const root = spell(noteIndex(p.root) + semitones, spelling);
  const bass = p.bass ? `/${spell(noteIndex(p.bass) + semitones, spelling)}` : "";
  // A custom shape belongs to the original chord; it no longer applies.
  return `${root}${p.quality}${bass}`;
}

/** Remove up to `n` spaces from runs of 2+ spaces, earliest first. */
function shrinkSpaces(gap: string, n: number): string {
  let out = gap;
  for (let left = n; left > 0; left--) {
    const m = / {2,}/.exec(out);
    if (!m) break;
    out = out.slice(0, m.index) + out.slice(m.index + 1);
  }
  return out;
}

/**
 * Transpose every chord of a sheet. On chord lines the columns are kept so
 * chords stay above the same syllables: longer symbols eat following spaces,
 * shorter ones are padded.
 */
export function transposeSheet(text: string, semitones: number, spelling: Spelling = sheetSpelling(text)): string {
  const rawLines = text.split("\n");
  return parseSheet(text)
    .map((line, i) => {
      const raw = rawLines[i]!;
      const prefix = raw.slice(0, line.marker);
      if (!line.chords.length) return raw;
      if (line.kind === "lyrics") {
        let out = line.text;
        for (const c of [...line.chords].reverse()) out = out.slice(0, c.start) + transposeChord(c.symbol, semitones, spelling) + out.slice(c.end);
        return prefix + out;
      }
      let out = "";
      let col = 0; // column in the original line
      for (const c of line.chords) {
        const next = transposeChord(c.symbol, semitones, spelling);
        let gap = line.text.slice(col, c.start);
        // A previous chord that grew takes room from runs of spaces (keeping one
        // space each); one that shrank is padded.
        const overflow = out.length - col;
        if (overflow > 0) gap = shrinkSpaces(gap, overflow);
        else if (overflow < 0) gap = " ".repeat(-overflow) + gap;
        out += gap + next;
        col = c.end;
      }
      const tail = line.text.slice(col);
      const overflow = out.length - col;
      out += overflow > 0 ? tail.slice(Math.min(overflow, tail.length - tail.trimStart().length)) : " ".repeat(-overflow) + tail;
      return prefix + out.replace(/\s+$/, "");
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Fingerings and diagrams

export interface Fingering {
  /** Per string, low to high: -1 muted, 0 open, n = fret relative to baseFret. */
  frets: number[];
  fingers?: number[];
  baseFret: number;
  barres?: number[];
}

export const TUNINGS: Record<Instrument, string[]> = {
  guitar: ["E", "A", "D", "G", "B", "E"],
  ukulele: ["G", "C", "E", "A"],
  mandolin: ["G", "D", "A", "E"],
};

/**
 * Read a custom shape: "x13333" (one character per string) or
 * "x 10 12 12 11 x" (space-separated, for frets above 9).
 */
export function parseShape(shape: string, strings: number): Fingering | null {
  const parts = shape.includes(" ") ? shape.trim().split(/\s+/) : [...shape.trim()];
  if (parts.length !== strings) return null;
  const abs = parts.map((p) => (/^[xX-]$/.test(p) ? -1 : /^\d+$/.test(p) ? Number(p) : NaN));
  if (abs.some((n) => Number.isNaN(n))) return null;
  const fretted = abs.filter((n) => n > 0);
  const max = fretted.length ? Math.max(...fretted) : 0;
  const min = fretted.length ? Math.min(...fretted) : 0;
  const baseFret = max > 4 ? min : 1;
  return { frets: abs.map((n) => (n <= 0 ? n : n - baseFret + 1)), baseFret };
}

export interface DiagramColors {
  line: string;
  dot: string;
  text: string;
  /** Text drawn on dots (finger numbers). */
  onDot: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * A chord diagram as an SVG string: strings vertical (low to high, left to
 * right), nut at the top, dots for fingers, o/x above for open/muted.
 */
export function chordDiagramSvg(
  name: string,
  f: Fingering | null,
  instrument: Instrument = "guitar",
  colors: DiagramColors = { line: "currentColor", dot: "currentColor", text: "currentColor", onDot: "#fff" },
  width = 84,
): string {
  const strings = TUNINGS[instrument].length;
  const frets = 4;
  const h = Math.round(width * 1.32);
  const left = width * 0.2;
  const right = width * 0.9;
  const top = h * 0.3;
  const bottom = h * 0.9;
  const sx = (right - left) / (strings - 1);
  const fy = (bottom - top) / frets;
  const parts: string[] = [];
  parts.push(`<text x="${width / 2}" y="${h * 0.12}" text-anchor="middle" font-size="${width * 0.17}" font-weight="700" fill="${colors.text}">${esc(name)}</text>`);
  if (!f) {
    parts.push(`<text x="${width / 2}" y="${h * 0.6}" text-anchor="middle" font-size="${width * 0.12}" fill="${colors.text}" opacity="0.6">no diagram</text>`);
  } else {
    // Grid
    for (let s = 0; s < strings; s++) parts.push(`<line x1="${left + s * sx}" y1="${top}" x2="${left + s * sx}" y2="${bottom}" stroke="${colors.line}" stroke-width="1"/>`);
    for (let r = 0; r <= frets; r++) {
      const nut = r === 0 && f.baseFret === 1;
      parts.push(`<line x1="${left}" y1="${top + r * fy}" x2="${right}" y2="${top + r * fy}" stroke="${colors.line}" stroke-width="${nut ? 3.5 : 1}"/>`);
    }
    if (f.baseFret > 1) parts.push(`<text x="${left - width * 0.06}" y="${top + fy * 0.68}" text-anchor="end" font-size="${width * 0.12}" fill="${colors.text}">${f.baseFret}fr</text>`);
    const r = Math.min(sx, fy) * 0.4;
    // Barres
    for (const b of f.barres ?? []) {
      const on = f.frets.map((x, i) => (x === b ? i : -1)).filter((i) => i >= 0);
      if (on.length < 2) continue;
      const a = Math.min(...on);
      const z = Math.max(...on);
      const y = top + (b - 0.5) * fy;
      parts.push(`<rect x="${left + a * sx - r}" y="${y - r}" width="${(z - a) * sx + 2 * r}" height="${2 * r}" rx="${r}" fill="${colors.dot}"/>`);
    }
    // Dots and open/muted marks
    f.frets.forEach((fret, s) => {
      const x = left + s * sx;
      if (fret < 0) {
        const y = top - fy * 0.45;
        const d = r * 0.75;
        parts.push(`<path d="M${x - d} ${y - d} L${x + d} ${y + d} M${x + d} ${y - d} L${x - d} ${y + d}" stroke="${colors.text}" stroke-width="1.2"/>`);
      } else if (fret === 0) {
        parts.push(`<circle cx="${x}" cy="${top - fy * 0.45}" r="${r * 0.75}" fill="none" stroke="${colors.text}" stroke-width="1.2"/>`);
      } else if (fret <= frets) {
        const y = top + (fret - 0.5) * fy;
        parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${colors.dot}"/>`);
        const finger = f.fingers?.[s];
        if (finger) parts.push(`<text x="${x}" y="${y + r * 0.45}" text-anchor="middle" font-size="${r * 1.25}" fill="${colors.onDot}">${finger}</text>`);
      }
    });
    // Tuning under the grid
    TUNINGS[instrument].forEach((n, s) => parts.push(`<text x="${left + s * sx}" y="${bottom + fy * 0.62}" text-anchor="middle" font-size="${width * 0.1}" fill="${colors.text}" opacity="0.55">${n}</text>`));
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h + 6}" width="${width}" height="${h + 6}" font-family="Inter, 'Segoe UI', Roboto, sans-serif" role="img" aria-label="${esc(name)} chord diagram">${parts.join("")}</svg>`;
}

// ---------------------------------------------------------------------------
// Chord database lookup (chords-db format)

export interface ChordDb {
  keys: string[];
  suffixes: string[];
  chords: Record<string, { key: string; suffix: string; positions: Fingering[] }[]>;
}

const QUALITY_ALIASES: Record<string, string> = {
  "": "major",
  M: "major",
  maj: "major",
  m: "minor",
  min: "minor",
  mi: "minor",
  "-": "minor",
  "°": "dim",
  o: "dim",
  "°7": "dim7",
  o7: "dim7",
  ø: "m7b5",
  ø7: "m7b5",
  "+": "aug",
  "+7": "aug7",
  "7+": "aug7",
  sus: "sus4",
  M7: "maj7",
  Δ: "maj7",
  Δ7: "maj7",
  ma7: "maj7",
  "6/9": "69",
  "m6/9": "m69",
  min7: "m7",
  "-7": "m7",
  mM7: "mmaj7",
  mmaj7: "mmaj7",
  "7sus": "7sus4",
  add2: "add9",
  "2": "add9",
  "5": "major", // power chords: show the major shape rather than nothing
};

/** chords-db stores C# and F# under "Csharp" / "Fsharp" and uses one spelling per pitch. */
function dbKey(db: ChordDb, root: string): string | undefined {
  const i = noteIndex(root);
  const name = db.keys.find((k) => noteIndex(k) === i);
  return name?.replace("#", "sharp");
}

/** Fingerings for a chord: its custom shape, else the database (slash chords fall back to their base chord). */
export function lookupFingerings(db: ChordDb | undefined, symbol: string, instrument: Instrument): Fingering[] {
  const p = parseChord(symbol);
  if (!p) return [];
  const strings = TUNINGS[instrument].length;
  if (p.shape) {
    const custom = parseShape(p.shape, strings);
    if (custom) return [custom];
  }
  if (!db) return [];
  const key = dbKey(db, p.root);
  const list = key ? db.chords[key] : undefined;
  if (!list) return [];
  const suffix = QUALITY_ALIASES[p.quality] ?? p.quality;
  const find = (s: string) => list.find((c) => c.suffix === s)?.positions;
  if (p.bass) {
    const bass = db.keys.find((k) => noteIndex(k) === noteIndex(p.bass!)) ?? p.bass;
    const slash = find(`${suffix === "minor" ? "m" : suffix === "major" ? "" : `${suffix}`}/${bass}`);
    if (slash) return slash;
  }
  return find(suffix) ?? [];
}

// ---------------------------------------------------------------------------
// Chord blocks in a note

const CHORDS_FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*(chords(?:-(guitar|ukulele|mandolin))?)\s*$/i;

/** Instrument of a fence info string ("chords", "chords-ukulele"…), or null. */
export function chordsFenceInstrument(info: string, fallback: Instrument = "guitar"): Instrument | null {
  const m = /^chords(?:-(guitar|ukulele|mandolin))?$/i.exec(info.trim().split(/\s+/)[0] ?? "");
  if (!m) return null;
  return (m[1]?.toLowerCase() as Instrument | undefined) ?? fallback;
}

/** Rewrite the `index`-th chords block of a note with its chords transposed. */
export function transposeChordBlock(markdown: string, index: number, semitones: number): string {
  const lines = markdown.split("\n");
  let count = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = CHORDS_FENCE.exec(lines[i]!);
    if (!m) {
      // Skip other fenced blocks entirely.
      const other = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[i]!);
      if (other) {
        const fence = other[1]!;
        for (i++; i < lines.length && !lines[i]!.trim().startsWith(fence); i++);
      }
      continue;
    }
    count++;
    const fence = m[2]!;
    let end = i + 1;
    while (end < lines.length && !lines[end]!.trim().startsWith(fence)) end++;
    if (count === index) {
      const body = lines.slice(i + 1, end).join("\n");
      lines.splice(i + 1, end - i - 1, ...transposeSheet(body, semitones).split("\n"));
      return lines.join("\n");
    }
    i = end;
  }
  return markdown;
}
