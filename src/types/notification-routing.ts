/**
 * Who a reminder is sent to, and when: the rules the web settings page and the iOS settings
 * screen read the same way.
 */

/** A routing row as either client reads it: whether one person's reminders reach this account. */
export interface RoutingChoice {
  person_id: string;
  enabled: boolean;
  custom_prefix: string | null;
}

/**
 * Whether reminders about a person reach the account. A person with no row of their own is on
 * when it is the account's own person and off otherwise, as the notification cron decides.
 */
export function routingEnabled(
  row: RoutingChoice | undefined,
  personOwnerId: string | null | undefined,
  userId: string | null,
): boolean {
  if (row) return row.enabled;
  return userId != null && personOwnerId === userId;
}

/** The row to store: the account's own person never carries a prefix, a blank one is none. */
export function routingUpsert(
  personId: string,
  enabled: boolean,
  prefix: string,
  isOwnPerson: boolean,
): RoutingChoice {
  const trimmed = prefix.trim();
  return {
    person_id: personId,
    enabled,
    custom_prefix: isOwnPerson || !trimmed ? null : trimmed,
  };
}

/** "9:5" → "09:05"; blank or unreadable parts fall back to nine o'clock. */
export function normalizeReminderTime(value: string): string {
  const [h, m] = (value.trim() || "09:00").split(":").map(Number);
  const hours = Number.isFinite(h) ? h! : 9;
  const minutes = Number.isFinite(m) ? m! : 0;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
