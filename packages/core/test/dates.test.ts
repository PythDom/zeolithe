import { describe, expect, it } from "vitest";
import { isIsoDate, parseNaturalDate } from "../src/dates";

// Thursday 2026-10-01
const today = new Date(2026, 9, 1);
const p = (s: string) => parseNaturalDate(s, today);

describe("parseNaturalDate", () => {
  it("handles keywords", () => {
    expect(p("today")).toBe("2026-10-01");
    expect(p("Tomorrow")).toBe("2026-10-02");
    expect(p("yesterday")).toBe("2026-09-30");
    expect(p("next week")).toBe("2026-10-05");
    expect(p("next month")).toBe("2026-11-01");
    expect(p("end of month")).toBe("2026-10-31");
    expect(p("eow")).toBe("2026-10-04");
  });
  it("handles weekdays as the next occurrence, never today", () => {
    expect(p("friday")).toBe("2026-10-02");
    expect(p("fri")).toBe("2026-10-02");
    expect(p("next friday")).toBe("2026-10-02");
    expect(p("thursday")).toBe("2026-10-08");
    expect(p("monday")).toBe("2026-10-05");
  });
  it("handles offsets", () => {
    expect(p("in 3 days")).toBe("2026-10-04");
    expect(p("+2w")).toBe("2026-10-15");
    expect(p("in 1 month")).toBe("2026-11-01");
  });
  it("handles month/day forms, rolling to next year when past", () => {
    expect(p("oct 15")).toBe("2026-10-15");
    expect(p("15 october")).toBe("2026-10-15");
    expect(p("sep 3")).toBe("2027-09-03");
    expect(p("3 sep 2026")).toBe("2026-09-03");
    expect(p("feb 30")).toBeNull();
  });
  it("passes ISO through and rejects junk", () => {
    expect(p("2026-12-24")).toBe("2026-12-24");
    expect(p("2026-02-30")).toBeNull();
    expect(p("soon")).toBeNull();
    expect(isIsoDate("2026-10-01")).toBe(true);
  });
});
