/**
 * Trigger regeneration of medication dose events (Today's intakes).
 * Call after creating or editing a regimen.
 * - personId: when provided, regenerates events for that person only (use when
 *   adding/editing a regimen for a person that may not be linked to the current user).
 * - timezone: client timezone so events are generated in the user's local time.
 */
export async function regenerateMedicationEvents(
  timezone?: string,
  personId?: string
): Promise<void> {
  const body: { timezone?: string; person_id?: string } = {};
  if (timezone) body.timezone = timezone;
  if (personId) body.person_id = personId;
  const res = await fetch("/api/medications/regenerate-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? "Regenerate events failed");
  }
}

export function getClientTimezone(): string | undefined {
  if (typeof Intl === "undefined" || !Intl.DateTimeFormat) return undefined;
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
