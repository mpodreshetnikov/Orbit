export function selectSuggestedTitle(rawTitle: unknown, fallback: string): string {
  if (typeof rawTitle !== "string") return fallback;
  const trimmed = rawTitle.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}
