export function formatSession(session: Record<string, unknown> | null): string {
  if (!session) return "No active session";
  return JSON.stringify(session, null, 2);
}

export function toIsoFromInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
