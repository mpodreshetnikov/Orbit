/** A stored `YYYY-MM-DD` at noon, so no time zone can move it to the day before. */
export function noonOf(day: string): Date {
  return new Date(`${day}T12:00:00`);
}
