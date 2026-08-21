/**
 * Converts a local calendar day to the UTC instants that bound it.
 *
 * Naively appending `T00:00:00.000Z` to a `YYYY-MM-DD` treats the day as UTC,
 * which is wrong for everyone outside it. A 00:30 Europe/Berlin dose belongs to
 * the requested local day but falls on the previous UTC date, so a "what do I
 * take today?" query would miss it and pick up doses from the following local
 * day instead.
 */

/**
 * Offset, in minutes, between the given timezone and UTC at the given instant.
 * Positive east of UTC. Uses `Intl` rather than a date library, since the app
 * has none and this is the whole requirement.
 */
export function timezoneOffsetMinutes(timeZone: string, at: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(at).map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  // `Date.UTC` of the wall-clock reading in that zone, minus the real instant,
  // is the zone's offset.
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === "24" ? "0" : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return Math.round((asUtc - at.getTime()) / 60_000);
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The instant at which `naive` -- a wall-clock reading parsed as if it were UTC
 * -- actually occurs in `timeZone`.
 *
 * The offset is resolved iteratively because the correct offset depends on the
 * instant, and the instant depends on the offset -- one correction step settles
 * it, including across a DST boundary.
 */
function wallClockToInstant(naive: number, timeZone: string): number {
  let instant = naive - timezoneOffsetMinutes(timeZone, new Date(naive)) * 60_000;
  instant = naive - timezoneOffsetMinutes(timeZone, new Date(instant)) * 60_000;
  return instant;
}

/** Start of `date` (YYYY-MM-DD) in `timeZone`, as a UTC ISO string. */
export function localDayStartUtc(date: string, timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    return `${date}T00:00:00.000Z`;
  }

  return new Date(wallClockToInstant(Date.parse(`${date}T00:00:00.000Z`), timeZone)).toISOString();
}

/** End of `date` in `timeZone` (inclusive), as a UTC ISO string. */
export function localDayEndUtc(date: string, timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    return `${date}T23:59:59.999Z`;
  }

  return new Date(wallClockToInstant(Date.parse(`${date}T23:59:59.999Z`), timeZone)).toISOString();
}

/** A local date and time with no zone, e.g. `2026-08-19T23:10` or `2026-08-19 23:10:00`. */
const WALL_CLOCK_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2}(\.\d{1,3})?)?$/;

/**
 * Reads a zone-less local date and time as the UTC instant it names in
 * `timeZone`, or null when the input is not one.
 *
 * `new Date("2026-08-19T23:10:00")` would resolve it against the *server's*
 * zone -- UTC in production -- so a user east of UTC would have the intake
 * filed hours off, possibly on the wrong local day.
 */
export function localDateTimeUtc(wallClock: string, timeZone: string): string | null {
  const match = WALL_CLOCK_PATTERN.exec(wallClock.trim());
  if (!match) {
    return null;
  }

  const [, date, hourMinute, seconds] = match;
  const naive = Date.parse(`${date}T${hourMinute}${seconds ?? ":00"}Z`);
  if (Number.isNaN(naive)) {
    return null;
  }

  // `Date.parse` rolls a nonexistent calendar date forward rather than
  // refusing it: "2026-02-30T12:00" comes back as March 2. Filing an intake on
  // a day the caller did not name is worse than rejecting the input, so
  // require the date to survive the round trip.
  if (new Date(naive).toISOString().slice(0, 10) !== date) {
    return null;
  }

  if (!isValidTimeZone(timeZone)) {
    return new Date(naive).toISOString();
  }

  return new Date(wallClockToInstant(naive, timeZone)).toISOString();
}
