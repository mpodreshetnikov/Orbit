/**
 * Trigger regeneration of medication dose events (Today's intakes) for the
 * current user. Call after creating or editing a regimen.
 * Pass client timezone so events are generated in the user's local time.
 */
export async function regenerateMedicationEvents(timezone?: string): Promise<void> {
  const res = await fetch("/api/medications/regenerate-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(timezone ? { timezone } : {}),
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
