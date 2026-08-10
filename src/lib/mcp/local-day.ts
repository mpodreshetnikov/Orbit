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
 * Start of `date` (YYYY-MM-DD) in `timeZone`, as a UTC ISO string.
 *
 * The offset is resolved iteratively because the correct offset depends on the
 * instant, and the instant depends on the offset -- one correction step settles
 * it, including across a DST boundary.
 */
export function localDayStartUtc(date: string, timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    return `${date}T00:00:00.000Z`;
  }

  const naive = Date.parse(`${date}T00:00:00.000Z`);
  let instant = naive - timezoneOffsetMinutes(timeZone, new Date(naive)) * 60_000;
  instant = naive - timezoneOffsetMinutes(timeZone, new Date(instant)) * 60_000;

  return new Date(instant).toISOString();
}

/** End of `date` in `timeZone` (inclusive), as a UTC ISO string. */
export function localDayEndUtc(date: string, timeZone: string): string {
  if (!isValidTimeZone(timeZone)) {
    return `${date}T23:59:59.999Z`;
  }

  const naive = Date.parse(`${date}T23:59:59.999Z`);
  let instant = naive - timezoneOffsetMinutes(timeZone, new Date(naive)) * 60_000;
  instant = naive - timezoneOffsetMinutes(timeZone, new Date(instant)) * 60_000;

  return new Date(instant).toISOString();
}
