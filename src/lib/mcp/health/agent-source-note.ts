/**
 * Default checkup note when the owner did not supply their own text.
 *
 * Always client-neutral: OAuth `client_name` is unreliable across hosts (Grok Bot's
 * DCR commonly registers as "Cursor", Claude as "Claude"), so a brand stamp would
 * mislabel again. «Добавлено агентом» is correct for every MCP connector.
 *
 * Call sites pass this as `notes` into `addProposedCheckups` so the legacy Claude
 * fallback inside that helper is never used on the MCP write path.
 */
export function formatAgentSourceNote(
  evidence?: { title: string; record_date: string | null } | null,
): string {
  if (evidence) {
    const datePart = evidence.record_date ? ` от ${evidence.record_date}` : "";
    return `Добавлено агентом по записи «${evidence.title}»${datePart}.`;
  }
  return "Добавлено агентом.";
}
