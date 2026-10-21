import type { Database } from "@db";

type DoseEventStatus = Database["public"]["Enums"]["med_dose_event_status"];

/** The columns `fetchDosesForDay` selects. Narrower than the row on purpose: a presenter that can
 * only see what is displayed cannot quietly start depending on something the query does not ask
 * for. */
export type DoseEventForDisplay = {
  id: string;
  actual_at: string;
  status: DoseEventStatus;
  planned_intake: unknown;
  regimen: { custom_name: string } | null;
};

export type DoseState = "due" | "taken" | "skipped" | "missed";

export type DoseCard = {
  id: string;
  /** Local wall-clock time of the dose, as the phone's own locale writes it. */
  time: string;
  name: string;
  /** `null` when one unit is to be taken: printing "1" beside a medication's name says nothing. */
  amount: string | null;
  state: DoseState;
};

const STATE_BY_STATUS: Record<DoseEventStatus, DoseState> = {
  scheduled: "due",
  sent: "due",
  // Still to be taken, just later than first planned — the card belongs with the due ones.
  snoozed: "due",
  taken: "taken",
  skipped: "skipped",
  missed: "missed",
  // Excluded by the query; mapped so this record stays total if that ever changes.
  cancelled: "skipped",
};

/**
 * The planned amount for one intake, when there is one worth showing.
 *
 * Reads `planned_intake.intake.amount`, the shape `src/types/regimen.ts` defines. Deliberately does
 * not touch `unit_strength`: `ADR-260907-cvj` records that strength is per unit and a per-intake
 * total is stored nowhere, so a client that multiplied them would be inventing a number the rest of
 * the product refuses to keep.
 */
function amountOf(plannedIntake: unknown): string | null {
  if (typeof plannedIntake !== "object" || plannedIntake === null) {
    return null;
  }
  const { intake } = plannedIntake as { intake?: unknown };
  if (typeof intake !== "object" || intake === null) {
    return null;
  }
  const { amount } = intake as { amount?: unknown };
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 1) {
    return null;
  }
  return String(amount);
}

function timeOf(actualAt: string): string {
  const at = new Date(actualAt);
  if (Number.isNaN(at.getTime())) {
    return "--:--";
  }
  return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Turn a day's dose events into what the list draws.
 *
 * Pure, so the mapping is testable without a device: every decision about what the screen says is
 * here, and the screen itself only lays the result out.
 */
export function presentDoses(events: readonly DoseEventForDisplay[]): DoseCard[] {
  return events.map((event) => ({
    id: event.id,
    time: timeOf(event.actual_at),
    name: event.regimen?.custom_name ?? "—",
    amount: amountOf(event.planned_intake),
    state: STATE_BY_STATUS[event.status] ?? "due",
  }));
}

/** How many of the day's doses are still to be taken. Drawn in the header, so it is worth a name. */
export function countDue(cards: readonly DoseCard[]): number {
  return cards.filter((card) => card.state === "due").length;
}
