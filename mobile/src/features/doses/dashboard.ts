import { clockTime, doseName, isOneOff, isOpen, type DayDose, type DoseStatus } from "./model";

export type Slot = { time: string; doses: DayDose[] };

export type Dashboard = {
  /** Doses still to act on, plus the ones acted on a moment ago, grouped by time. */
  pending: Slot[];
  /** The day's settled doses: taken, skipped, and past ones nobody marked. */
  completed: Slot[];
  completedCount: number;
  /** Today's doses whose time has passed with nothing recorded. */
  overdueIds: ReadonlySet<string>;
};

/** The time a dose sits at once it is settled: when it was taken, if it was. */
function effectiveTime(dose: DayDose): string {
  return dose.taken_at ?? dose.actual_at;
}

function bySlot(doses: DayDose[], timeOf: (dose: DayDose) => string): Slot[] {
  const slots = new Map<string, DayDose[]>();
  for (const dose of doses) {
    const time = clockTime(timeOf(dose));
    slots.set(time, [...(slots.get(time) ?? []), dose]);
  }
  return [...slots.entries()]
    .map(([time, list]) => ({
      time,
      // Same order within a slot from one day to the next: by time, then name, then course.
      doses: [...list].sort(
        (a, b) =>
          timeOf(a).localeCompare(timeOf(b)) ||
          doseName(a).localeCompare(doseName(b), "ru", { sensitivity: "base" }) ||
          a.regimen_id.localeCompare(b.regimen_id),
      ),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Split one day's doses into what the screen draws.
 *
 * The web dashboard's rule (`src/components/medications/medication-dashboard.tsx`), so a dose sits in
 * the same section on both surfaces: open doses ahead of now are pending; on today, an open or missed
 * regular dose whose time has passed is pending too and marked overdue; everything settled, and past
 * doses nobody marked, goes to the completed section. A dose acted on a moment ago stays where it was,
 * showing its new state, until `recentlyActed` lets go of it — the list does not jump under a thumb.
 *
 * One deliberate difference: "today" is the phone's local day. The web compares UTC date prefixes,
 * which moves an early-morning dose to the wrong day east of Greenwich.
 */
export function buildDashboard(
  doses: readonly DayDose[],
  options: { now: Date; isToday: boolean; recentlyActed: ReadonlySet<string> },
): Dashboard {
  const nowIso = options.now.toISOString();
  const overdue = options.isToday
    ? doses.filter(
        (dose) =>
          (isOpen(dose.status) || dose.status === "missed") &&
          dose.actual_at < nowIso &&
          !isOneOff(dose),
      )
    : [];
  const overdueIds = new Set(overdue.map((dose) => dose.id));
  const ahead = doses.filter((dose) => isOpen(dose.status) && dose.actual_at >= nowIso);
  const pendingIds = new Set([...ahead, ...overdue].map((dose) => dose.id));

  const settled = doses.filter(
    (dose) =>
      !pendingIds.has(dose.id) &&
      (dose.status === "taken" ||
        dose.status === "skipped" ||
        ((isOpen(dose.status) || dose.status === "missed") && dose.actual_at < nowIso)),
  );
  const completed = settled.filter((dose) => !options.recentlyActed.has(dose.id));
  const justActed = settled.filter((dose) => options.recentlyActed.has(dose.id));

  const pendingList = [...ahead, ...overdue, ...justActed];
  return {
    pending: bySlot(pendingList, options.isToday ? (dose) => dose.actual_at : effectiveTime),
    completed: bySlot(completed, effectiveTime),
    completedCount: completed.length,
    overdueIds,
  };
}

/** The day's list with one dose moved to a new state, as the server is about to have it. Used for the
 * optimistic update, so the row changes the instant it is tapped rather than a round trip later. */
export function withStatus(
  doses: readonly DayDose[],
  id: string,
  status: DoseStatus,
  takenAt: string | null,
): DayDose[] {
  return doses.map((dose) => (dose.id === id ? { ...dose, status, taken_at: takenAt } : dose));
}
