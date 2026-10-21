import type { MedicationUnit } from "@orbit-types/medication";
import type { MedRegimen, MedSchedule } from "@orbit-types/regimen";
import { t } from "@/lib/i18n";

const UNITS = new Set<string>([
  "pill",
  "ml",
  "drops",
  "inhalation",
  "patch",
  "other",
  "iu",
  "ampoule",
  "capsule",
  "application",
  "gram",
  "injection",
  "milligram",
  "spray",
  "portion",
  "tablespoon",
  "teaspoon",
  "unit",
  "suppository",
]);

/** A stored unit, or `other` when the column holds something the app has no word for. */
export function asUnit(value: string | null | undefined): MedicationUnit {
  return value != null && UNITS.has(value) ? (value as MedicationUnit) : "other";
}

/** "1 таблетка", "2 таблетки" — as the web app's `formatAmountWithUnit` prints it,
 * from the same catalogue entry. */
export function formatAmountWithUnit(amount: number, unit: MedicationUnit): string {
  const key = `medications.unit${unit.charAt(0).toUpperCase()}${unit.slice(1)}`;
  return `${amount} ${t(key, { count: amount })}`;
}

/** The "when to take it" line, or null when there is nothing to say. Mirrors the web dashboard. */
export function intakeAdviceLabel(
  regimen: { intake_advice_type?: string | null; intake_advice_text?: string | null } | null,
): string | null {
  const type = regimen?.intake_advice_type;
  if (!type || type === "none") {
    return null;
  }
  if (type === "custom") {
    return regimen?.intake_advice_text?.trim() || null;
  }
  const key = `medications.intakeAdvice${type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
  const label = t(key);
  return label === key ? null : label;
}

const DAY_SUFFIX = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * One line saying when a course is taken: "Ежедневно в 09:00, 21:00".
 *
 * The web app's `formatRegimenScheduleSummary` (`src/components/medications/regimen-card.tsx`),
 * carried over rather than shared because it lives in a web component file. The two must say the
 * same thing for the same schedule; the tests pin the wording.
 */
export function scheduleSummary(
  regimen: Pick<MedRegimen, "schedule" | "intake_unit">,
): string | null {
  const schedule = regimen.schedule as MedSchedule | null;
  if (!schedule) {
    return null;
  }
  switch (schedule.mode) {
    case "one_off": {
      if (!schedule.due_at) {
        return null;
      }
      const due = new Date(schedule.due_at);
      return Number.isNaN(due.getTime())
        ? null
        : due.toLocaleString("ru", { dateStyle: "medium", timeStyle: "short" });
    }
    case "daily_times":
      return schedule.times?.length
        ? `${t("medications.frequencyDaily")} ${t("medications.scheduleAt")} ${schedule.times.join(", ")}`
        : null;
    case "interval_hours": {
      const every = schedule.interval?.every;
      if (every == null) {
        return null;
      }
      const base = `${t("medications.every")} ${every} ${t("medications.hours")}`;
      const amount = schedule.amount;
      return amount != null && amount > 1
        ? `${base} · ${formatAmountWithUnit(amount, asUnit(regimen.intake_unit))}`
        : base;
    }
    case "interval_days": {
      const every = schedule.interval?.every;
      if (every == null) {
        return null;
      }
      const times = schedule.times?.length
        ? schedule.times.join(", ")
        : (schedule.time_of_day ?? "09:00");
      return `${t("medications.every")} ${every} ${t("medications.days")} ${t("medications.scheduleAt")} ${times}`;
    }
    case "days_of_week": {
      const days = schedule.days_of_week;
      if (!days?.length) {
        return null;
      }
      const names = [...days]
        .sort((a, b) => a - b)
        .map((day) => t(`medications.day${DAY_SUFFIX[day === 7 ? 0 : day] ?? "Sun"}`))
        .join(", ");
      const times = schedule.times?.length
        ? ` ${t("medications.scheduleAt")} ${schedule.times.join(", ")}`
        : "";
      return `${names}${times}`;
    }
    default:
      return null;
  }
}

/** Whether the course's stock has fallen to its refill threshold. */
export function isLowInventory(regimen: Pick<MedRegimen, "inventory">): boolean {
  const inventory = regimen.inventory;
  return Boolean(
    inventory?.enabled &&
    inventory.refill_threshold_amount != null &&
    inventory.current_amount != null &&
    inventory.current_amount <= inventory.refill_threshold_amount,
  );
}
