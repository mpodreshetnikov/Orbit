import { getEffectiveStatus, type MedRegimen, type MedRegimenStatus } from "@orbit-types/regimen";

export type StatusFilter = "all" | MedRegimenStatus;

export const STATUS_FILTERS: readonly StatusFilter[] = [
  "all",
  "active",
  "paused",
  "completed",
  "archived",
];

function isOneOffCourse(regimen: MedRegimen): boolean {
  return (regimen.schedule as { mode?: string } | null)?.mode === "one_off";
}

/**
 * The status a course is shown with: a one-off intake reads as completed, and an active course past
 * its end date reads as completed too (`getEffectiveStatus`, shared with the web app).
 */
export function displayStatus(regimen: MedRegimen, today?: string): MedRegimenStatus {
  return isOneOffCourse(regimen) ? "completed" : getEffectiveStatus(regimen, { today });
}

/**
 * The list the medications screen draws: filtered by status and by a name search, with finished
 * courses and one-off intakes after the running ones. The web medications page's rule.
 */
export function filterRegimens(
  regimens: readonly MedRegimen[],
  options: { status: StatusFilter; query: string; today?: string },
): MedRegimen[] {
  const query = options.query.trim().toLocaleLowerCase("ru");
  const matching = regimens.filter(
    (regimen) =>
      (options.status === "all" || displayStatus(regimen, options.today) === options.status) &&
      (query === "" || regimen.custom_name.toLocaleLowerCase("ru").includes(query)),
  );
  const finished = (regimen: MedRegimen) =>
    displayStatus(regimen, options.today) === "completed" ? 1 : 0;
  return [...matching].sort((a, b) => finished(a) - finished(b));
}
