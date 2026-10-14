import { describe, expect, it } from "vitest";
import { lineDiff, normaliseText, sameContent } from "../src/sync";

const enc = (s: string) => new TextEncoder().encode(s);

describe("comparing versions", () => {
  it("ignores invisible differences in notes, not in other files", () => {
    expect(normaliseText("﻿# T\r\nline  \r\n\r\n")).toBe("# T\nline");
    expect(sameContent("a.md", enc("# T\r\nText \r\n"), enc("# T\nText\n"))).toBe(true);
    expect(sameContent("a.md", enc("# T\nText"), enc("# T\nText!"))).toBe(false);
    expect(sameContent("a.png", enc("x\r\n"), enc("x\n"))).toBe(false);
    expect(sameContent("a.png", enc("same"), enc("same"))).toBe(true);
  });

  it("lists the lines removed and added", () => {
    const d = lineDiff("# T\none\ntwo\nthree\n", "# T\none\n2\nthree\nfour\n");
    expect(d.map((l) => `${l.kind[0]} ${l.text}`)).toEqual(["s # T", "s one", "r two", "a 2", "s three", "a four"]);
    expect(lineDiff("a\r\nb", "a\nb").every((l) => l.kind === "same")).toBe(true);
  });
});
