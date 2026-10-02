/** Dates are handled as local calendar dates in ISO form (YYYY-MM-DD). */

export type IsoDate = string;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function toIsoDate(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local timestamp without seconds, e.g. 2026-10-02T14:31. */
export function toIsoMinute(d: Date): string {
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${toIsoDate(d)}T${h}:${min}`;
}

export function isIsoDate(s: string): boolean {
  if (!ISO.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return target;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function matchPrefix(word: string, list: string[], min = 3): number {
  if (word.length < min) return -1;
  return list.findIndex((w) => w.startsWith(word));
}

/**
 * Convert an English natural-language date to ISO, relative to `today`.
 * Returns null when the text is not recognised. ISO input is returned as is.
 *
 * Supported: today, tomorrow, yesterday, <weekday>, next <weekday>,
 * this <weekday>, next week (Monday), next month, end of month, end of week,
 * in N day(s)/week(s)/month(s), +Nd/+Nw/+Nm, "oct 15", "15 oct", "15 october 2027".
 */
export function parseNaturalDate(input: string, today: Date = new Date()): IsoDate | null {
  const text = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (text === "") return null;
  if (ISO.test(text)) return isIsoDate(text) ? text : null;

  switch (text) {
    case "today":
    case "tod":
      return toIsoDate(today);
    case "tomorrow":
    case "tom":
      return toIsoDate(addDays(today, 1));
    case "yesterday":
      return toIsoDate(addDays(today, -1));
    case "next week":
      return toIsoDate(addDays(today, ((8 - today.getDay()) % 7) || 7));
    case "next month":
      return toIsoDate(addMonths(today, 1));
    case "end of month":
    case "eom":
      return toIsoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    case "end of week":
    case "eow":
      return toIsoDate(addDays(today, (7 - today.getDay()) % 7));
  }

  let m = /^(?:in )?\+?(\d+) ?(d|days?|w|weeks?|m|months?)$/.exec(text);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2]![0];
    if (unit === "d") return toIsoDate(addDays(today, n));
    if (unit === "w") return toIsoDate(addDays(today, 7 * n));
    return toIsoDate(addMonths(today, n));
  }

  m = /^(next |this )?([a-z]+)$/.exec(text);
  if (m) {
    const wd = matchPrefix(m[2]!, WEEKDAYS);
    if (wd >= 0) {
      // "friday", "this friday" and "next friday" all mean the next occurrence,
      // never today.
      const delta = (wd - today.getDay() + 7) % 7 || 7;
      return toIsoDate(addDays(today, delta));
    }
  }

  // "oct 15", "october 15 2027", "15 oct", "15 october 2027"
  m = /^([a-z]+) (\d{1,2})(?:,? (\d{4}))?$/.exec(text) ?? null;
  let monthWord: string | undefined;
  let dayStr: string | undefined;
  let yearStr: string | undefined;
  if (m) {
    [, monthWord, dayStr, yearStr] = m;
  } else {
    const m2 = /^(\d{1,2}) ([a-z]+)(?: (\d{4}))?$/.exec(text);
    if (m2) [, dayStr, monthWord, yearStr] = m2;
  }
  if (monthWord && dayStr) {
    const month = matchPrefix(monthWord, MONTHS);
    if (month < 0) return null;
    const day = Number(dayStr);
    let year = yearStr ? Number(yearStr) : today.getFullYear();
    let candidate = new Date(year, month, day);
    if (candidate.getMonth() !== month) return null;
    if (!yearStr && candidate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      year += 1;
      candidate = new Date(year, month, day);
    }
    return toIsoDate(candidate);
  }
  return null;
}
