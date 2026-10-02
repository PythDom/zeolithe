import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  chordDiagramSvg,
  isChord,
  lookupFingerings,
  parseChord,
  parseShape,
  parseSheet,
  sheetChords,
  sheetSpelling,
  transposeChord,
  transposeSheet,
  type ChordDb,
} from "../src/chords";

const require = createRequire(import.meta.url);
const guitar = JSON.parse(readFileSync(require.resolve("@tombatossals/chords-db/lib/guitar.json"), "utf8")) as ChordDb;
const ukulele = JSON.parse(readFileSync(require.resolve("@tombatossals/chords-db/lib/ukulele.json"), "utf8")) as ChordDb;

describe("chord symbols", () => {
  it("recognises common chords and rejects words", () => {
    for (const c of ["C", "Am", "F#m7b5", "Bb/D", "Cadd9", "Gsus4", "D7sus4", "Emaj7", "E-", "C°7", "F#m7(b5)", "Bbadd13[x13333]", "A5"]) expect(isChord(c), c).toBe(true);
    for (const w of ["A man", "Bad", "Add", "Do", "verse", "Hello", "Be"]) expect(isChord(w), w).toBe(false);
    expect(parseChord("Bb/D")).toEqual({ root: "Bb", quality: "", bass: "D", shape: undefined });
    expect(parseChord("Bbadd13[x13333]")!.shape).toBe("x13333");
  });
});

const sheet = `[Verse 1]
Am        F         C    G
Hello darkness, my old friend
%c Am
I've [C]come to talk with [G]you again
A man walks down the street
Chorus:
| G  /  /  | D  x2 |`;

describe("parseSheet", () => {
  it("classifies lines", () => {
    expect(parseSheet(sheet).map((l) => l.kind)).toEqual(["section", "chords", "lyrics", "chords", "lyrics", "lyrics", "section", "chords"]);
  });
  it("finds chord columns and inline chords", () => {
    const lines = parseSheet(sheet);
    expect(lines[1]!.chords.map((c) => [c.symbol, c.start])).toEqual([["Am", 0], ["F", 10], ["C", 20], ["G", 25]]);
    expect(lines[4]!.chords.map((c) => c.symbol)).toEqual(["C", "G"]);
    expect(lines[3]!.text).toBe("Am");
    expect(sheetChords(sheet)).toEqual(["Am", "F", "C", "G", "D"]);
  });
});

describe("transpose", () => {
  it("transposes chords with sensible spelling", () => {
    expect(transposeChord("Am", 2)).toBe("Bm");
    expect(transposeChord("C", 1)).toBe("C#");
    expect(transposeChord("C", 1, "flats")).toBe("Db");
    expect(transposeChord("D", 1)).toBe("Eb");
    expect(transposeChord("Bb/D", -2, "flats")).toBe("Ab/C");
    expect(transposeChord("F#m7b5", 1)).toBe("Gm7b5");
    expect(transposeChord("Bbadd13[x13333]", 2)).toBe("Cadd13");
    expect(transposeChord("G", 12)).toBe("G");
  });
  it("prefers the spelling already used in the sheet", () => {
    expect(sheetSpelling("Bb  Eb  F")).toBe("flats");
    expect(transposeSheet("Bb  Eb  F", 1)).toBe("B   E   Gb");
    expect(sheetSpelling("A  C#m  F#")).toBe("sharps");
  });
  it("keeps chords above the same columns", () => {
    const src = "Am        F         C    G\nHello darkness, my old friend";
    const out = transposeSheet(src, 1);
    expect(out).toBe("Bbm       F#        C#   Ab\nHello darkness, my old friend");
    const cols = (l: string) => [...l.matchAll(/\S+/g)].map((m) => m.index);
    expect(cols(out.split("\n")[0]!)).toEqual(cols(src.split("\n")[0]!));
    // Growing chords eat spaces but keep at least one.
    expect(transposeSheet("C D E", 1, "flats")).toBe("Db Eb F");
    expect(transposeSheet("I've [C]come to [G]you", 2)).toBe("I've [D]come to [A]you");
    expect(transposeSheet(sheet, 0)).toBe(sheet);
    expect(transposeSheet(transposeSheet(sheet, 3), -3)).toBe(sheet);
  });
});

describe("fingerings and diagrams", () => {
  it("looks chords up in chords-db", () => {
    expect(lookupFingerings(guitar, "C", "guitar")[0]!.frets).toEqual([-1, 3, 2, 0, 1, 0]);
    expect(lookupFingerings(guitar, "C#m", "guitar").length).toBeGreaterThan(0);
    expect(lookupFingerings(guitar, "Db", "guitar")).toEqual(lookupFingerings(guitar, "C#", "guitar"));
    expect(lookupFingerings(guitar, "A#m7", "guitar")).toEqual(lookupFingerings(guitar, "Bbm7", "guitar"));
    expect(lookupFingerings(guitar, "C/G", "guitar").length).toBeGreaterThan(0);
    expect(lookupFingerings(guitar, "D/F#", "guitar").length).toBeGreaterThan(0);
    expect(lookupFingerings(ukulele, "Am", "ukulele")[0]!.frets).toHaveLength(4);
  });
  it("reads custom shapes", () => {
    expect(parseShape("x13333", 6)).toEqual({ frets: [-1, 1, 3, 3, 3, 3], baseFret: 1 });
    expect(parseShape("x 10 12 12 11 x", 6)).toEqual({ frets: [-1, 1, 3, 3, 2, -1], baseFret: 10 });
    expect(parseShape("x1333", 6)).toBeNull();
    expect(lookupFingerings(guitar, "Bbadd13[x13333]", "guitar")).toEqual([{ frets: [-1, 1, 3, 3, 3, 3], baseFret: 1 }]);
  });
  it("draws an SVG diagram", () => {
    const svg = chordDiagramSvg("C", lookupFingerings(guitar, "C", "guitar")[0]!);
    expect(svg).toMatch(/^<svg[^>]*viewBox/);
    expect(svg.match(/<line /g)!.length).toBe(6 + 5);
    expect(chordDiagramSvg("H7", null)).toContain("no diagram");
  });
});

describe("chord blocks", () => {
  it("transposes the right block in a note", async () => {
    const { transposeChordBlock, chordsFenceInstrument } = await import("../src/chords");
    const md = "# Song\n```js\nconst C = 1\n```\n```chords\nC  G\nla la\n```\n```chords-ukulele\nAm\n```\n";
    expect(transposeChordBlock(md, 1, 2)).toBe(md.replace("```chords-ukulele\nAm", "```chords-ukulele\nBm"));
    expect(transposeChordBlock(md, 0, 2)).toBe(md.replace("C  G\n", "D  A\n"));
    expect(chordsFenceInstrument("chords-ukulele")).toBe("ukulele");
    expect(chordsFenceInstrument("chords")).toBe("guitar");
    expect(chordsFenceInstrument("js")).toBeNull();
  });
});
