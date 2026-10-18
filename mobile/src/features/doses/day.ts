/**
 * The bounds of one local day, as instants.
 *
 * The phone's own timezone decides where a day starts, which is the whole point: a dose planned for
 * 23:30 belongs to the evening the owner is living in, not to whatever date UTC has reached. Kept
 * pure and separate so that boundary — the thing timezone bugs hide in — is testable without a
 * device. `T-0027` records the same concern for the MCP surface.
 */
export function localDayBounds(now: Date): { startIso: string; endIso: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  // Constructed from the calendar fields rather than by adding 24 hours, so a day that is 23 or 25
  // hours long across a daylight-saving change still ends where the calendar says it does.
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/**
 * How long until the local day ends.
 *
 * The screen holds one day's doses, so it has to know when that day stops being today — a phone left
 * in the foreground overnight would otherwise keep yesterday's list on screen under today's heading.
 * Returns at least 1 so a caller passing an instant exactly at midnight still schedules forward
 * rather than firing in a loop.
 */
export function msUntilNextLocalDay(now: Date): number {
  const { endIso } = localDayBounds(now);
  return Math.max(1, new Date(endIso).getTime() - now.getTime());
}
