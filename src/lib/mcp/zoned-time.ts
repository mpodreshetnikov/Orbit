import { isValidTimeZone, localDateTimeUtc, timezoneOffsetMinutes } from "./local-day";

/**
 * The output half of this server's timezone contract.
 *
 * `local-day.ts` turns a caller's local day into the UTC instants that bound
 * it. This module does the other direction: it renders an instant the database
 * holds back into the wall clock the person actually keeps, and it never does
 * so without saying which zone that is.
 *
 * The defect it exists to prevent is not hypothetical. A course scheduled for
 * 22:00 in a zone seven hours ahead is stored as `15:00+00:00`, and every tool
 * used to print that instant unconverted -- `2026-08-24 15:00`, offset sliced
 * off, directly beneath a header naming the local timezone the range had been
 * resolved in. A regimen's own `schedule.times` are local wall-clock strings,
 * so one payload carried two frames with nothing declaring which was which. An
 * assistant reading it told the user their 22:00 dose "is at 15:00" and refused
 * to move it (`T-0027`).
 *
 * So: a timestamp rendered for a caller is converted and carries its offset, or
 * it does not go out. `2026-08-24 22:00 +07:00` is readable by a person and
 * unambiguous to a model; `structuredContent` keeps the original ISO instant
 * and gains a `_local` sibling, so nothing that already parses these payloads
 * has to change.
 */

/** `+07:00`, `-03:30`, `+00:00`. */
export function offsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const total = Math.abs(offsetMinutes);
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function instantOf(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function partsInZone(instant: Date, timeZone: string): Record<string, string> {
  // en-CA gives ISO-ordered numeric fields, which is what both renderings below
  // want; the locale is never user-visible.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
}

/**
 * A zone this server is willing to render in. An unrecognised name falls back
 * to UTC here rather than throwing, because these functions are called while
 * composing a reply; the tools reject an unknown zone at their own boundary,
 * where the caller can still be told about it.
 */
function renderableZone(timeZone: string | null | undefined): string {
  return timeZone && isValidTimeZone(timeZone) ? timeZone : "UTC";
}

/**
 * The wall clock in `timeZone`, as ISO 8601 carrying its offset:
 * `2026-08-24T22:00:00+07:00`. Null when the input is not a timestamp.
 */
export function zonedIso(value: string | Date, timeZone: string): string | null {
  const instant = instantOf(value);
  if (!instant) {
    return null;
  }

  const zone = renderableZone(timeZone);
  const parts = partsInZone(instant, zone);
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const offset = offsetLabel(timezoneOffsetMinutes(zone, instant));

  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}${offset}`;
}

/**
 * The compact rendering for a text summary: `2026-08-24 22:00 +07:00`.
 *
 * Seconds are dropped because none of these are second-precision events to a
 * reader, and the offset stays because dropping it is the whole defect.
 * Falls back to the raw value when it cannot be parsed, so a malformed row
 * still shows something rather than "null".
 */
export function formatZoned(value: string | Date, timeZone: string): string {
  const iso = zonedIso(value, timeZone);
  if (!iso) {
    return typeof value === "string" ? value : "unknown time";
  }

  const [date, rest] = iso.split("T");
  return `${date} ${rest.slice(0, 5)} ${rest.slice(8)}`;
}

/**
 * The local calendar date in `timeZone`: `2026-08-24`.
 *
 * `instant.slice(0, 10)` is the UTC date, which is a different day for anyone
 * far enough east or west -- a 23:30 weigh-in east of UTC is filed on the
 * following date, and the person is told they weighed themselves tomorrow.
 */
export function zonedDate(value: string | Date, timeZone: string): string {
  const iso = zonedIso(value, timeZone);
  return iso ? iso.slice(0, 10) : typeof value === "string" ? value.slice(0, 10) : "unknown date";
}

/**
 * Copies `row`, adding a `<key>_local` sibling for each named timestamp.
 *
 * Additive on purpose: the ISO instants a payload already carries are correct
 * and something downstream may parse them, so the local reading is offered
 * beside them rather than in place of them. A null timestamp stays null.
 */
export function withZonedTimestamps<T extends Record<string, unknown>>(
  row: T,
  timeZone: string,
  keys: readonly string[],
): T & Record<string, unknown> {
  const additions: Record<string, string | null> = {};

  for (const key of keys) {
    const value = row[key];
    additions[`${key}_local`] = typeof value === "string" ? zonedIso(value, timeZone) : null;
  }

  return { ...row, ...additions };
}

/** ISO 8601 date-time carrying an explicit zone: a trailing `Z`, or `+hh:mm`/`-hhmm`. */
export const HAS_UTC_OFFSET = /(z|[+-]\d{2}:?\d{2})$/i;

export type InstantParse =
  | { ok: true; instant: string; zoneApplied: boolean }
  | { ok: false; zoneApplied: boolean };

/**
 * Reads a timestamp a caller supplied, the one way this server accepts them.
 *
 * A string carrying an offset or `Z` is taken at face value; an offset-less
 * wall clock is read in `timeZone`; anything else is refused. Bare `new Date`
 * would read the wall clock in the *server's* zone -- UTC in production, so
 * hours off for everyone else -- and would also accept junk like `"0"`.
 *
 * `zoneApplied` tells the caller whether the answer depended on `timeZone`, so
 * a confirmation can say which zone it read the request in.
 */
export function instantFromInput(value: string, timeZone: string): InstantParse {
  const trimmed = value.trim();

  if (HAS_UTC_OFFSET.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime())
      ? { ok: false, zoneApplied: false }
      : { ok: true, instant: parsed.toISOString(), zoneApplied: false };
  }

  const instant = localDateTimeUtc(trimmed, timeZone);
  return instant ? { ok: true, instant, zoneApplied: true } : { ok: false, zoneApplied: true };
}
