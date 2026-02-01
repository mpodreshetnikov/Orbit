/**
 * Adapters between Medication (form) and MedRegimen (API) so we can keep
 * MedicationForm and use regimen hooks for create/update.
 */
import type { Medication, CreateMedicationInput, UpdateMedicationInput, MedicationSchedule } from "@/types";
import type {
  MedRegimen,
  CreateMedRegimenInput,
  UpdateMedRegimenInput,
  MedSchedule,
  MedDuration,
  PlannedIntake,
  RegimenInventory,
} from "@/types/regimen";

function mapDurationToMed(duration: MedRegimen["duration"]): MedicationSchedule["duration"] {
  const type = duration?.type ?? "endless";
  const start_date = (duration as { start_date?: string }).start_date ?? new Date().toISOString().slice(0, 10);
  if (type === "until_date") {
    return { start_date, end_type: "end_date", end_date: (duration as { end_date?: string }).end_date };
  }
  if (type === "for_days") {
    const days = (duration as { days?: number }).days ?? 0;
    return { start_date, end_type: "days_from_start", days_count: days };
  }
  return { start_date, end_type: "endless" };
}

function mapScheduleToMed(
  schedule: MedSchedule | null,
  duration?: MedDuration
): MedicationSchedule | null {
  if (!schedule) return null;
  const mode = (schedule as { mode?: string }).mode;
  const medDuration = duration ? mapDurationToMed(duration) : { start_date: new Date().toISOString().slice(0, 10), end_type: "endless" as const };
  if (mode === "one_off") {
    const due_at = (schedule as { due_at?: string }).due_at;
    if (!due_at) return null;
    const start_date = due_at.slice(0, 10);
    return {
      frequency: { type: "daily" },
      duration: { start_date, end_type: "endless" },
      reminder_times: [{ time: due_at.slice(11, 16) || "09:00", amount: 1 }],
    };
  }
  if (mode === "daily_times") {
    const times = (schedule as { times?: string[] }).times ?? [];
    const amounts = (schedule as { amounts?: number[] }).amounts;
    return {
      frequency: { type: "daily" },
      duration: medDuration,
      reminder_times: times.map((time, i) => ({
        time,
        amount: amounts != null && amounts[i] != null ? Math.max(1, amounts[i]) : 1,
      })),
    };
  }
  if (mode === "days_of_week") {
    const times = (schedule as { times?: string[] }).times ?? [];
    const days_of_week = (schedule as { days_of_week?: number[] }).days_of_week ?? [];
    return {
      frequency: { type: "days_of_week", days: days_of_week },
      duration: medDuration,
      reminder_times: times.map((time) => ({ time, amount: 1 })),
    };
  }
  return {
    frequency: { type: "daily" },
    duration: medDuration,
    reminder_times: [{ time: "09:00", amount: 1 }],
  };
}

export function regimenToMedication(regimen: MedRegimen): Medication {
  const schedule = regimen.schedule as MedSchedule;
  const duration = regimen.duration as MedDuration;
  const isOneOff = schedule?.mode === "one_off";
  const dueAt = (schedule as { due_at?: string })?.due_at;
  const amount = regimen.dose_definition?.intake?.amount ?? 1;
  const medSchedule = mapScheduleToMed(regimen.schedule as MedSchedule, duration);
  if (medSchedule && isOneOff && dueAt) {
    medSchedule.reminder_times = [{ time: dueAt.slice(11, 16) || "09:00", amount }];
  } else if (medSchedule && schedule?.mode === "daily_times") {
    const times = (schedule as { times?: string[] }).times ?? [];
    const amounts = (schedule as { amounts?: number[] }).amounts;
    medSchedule.reminder_times = times.map((time, i) => ({
      time,
      amount: amounts != null && amounts[i] != null ? Math.max(1, amounts[i]) : amount,
    }));
  }
  const inv = regimen.inventory as RegimenInventory | null | undefined;
  const adviceType = regimen.intake_advice_type ?? "none";
  const intakeAdvice =
    adviceType === "none" ? null : adviceType === "custom" ? "custom" : adviceType;
  return {
    id: regimen.id,
    person_id: regimen.person_id,
    name: regimen.custom_name,
    kind: isOneOff ? "one_time" : "regular",
    unit: regimen.intake_unit,
    dose_per_unit: null,
    intake_advice: intakeAdvice,
    intake_advice_custom: regimen.intake_advice_text ?? null,
    scheduled_at: isOneOff && dueAt ? dueAt : null,
    one_time_amount: amount,
    schedule: medSchedule,
    inventory_enabled: inv?.enabled ?? false,
    inventory_current: inv?.current_amount ?? null,
    inventory_refill_threshold: inv?.refill_threshold_amount ?? null,
    status: regimen.status,
    notes: regimen.notes,
    created_at: regimen.created_at,
    updated_at: regimen.updated_at,
  };
}

function mapDurationFromMed(duration: MedicationSchedule["duration"]): MedDuration {
  if (!duration) return { type: "endless" };
  if (duration.end_type === "end_date" && duration.end_date)
    return { type: "until_date", end_date: duration.end_date };
  if (duration.end_type === "days_from_start" && duration.days_count != null)
    return { type: "for_days", days: duration.days_count, start_date: duration.start_date };
  return { type: "endless" };
}

export function createMedicationInputToRegimenInput(data: CreateMedicationInput): CreateMedRegimenInput {
  const isOneOff = data.kind === "one_time";
  const amount = isOneOff ? (data.one_time_amount ?? 1) : (data.schedule?.reminder_times?.[0]?.amount ?? 1);
  const unit = data.unit ?? "pill";
  const dose_definition: PlannedIntake = {
    intake: { amount, unit },
    active: [],
  };
  let schedule: MedSchedule;
  let duration: MedDuration = { type: "endless" };
  if (isOneOff && data.scheduled_at) {
    schedule = { mode: "one_off", due_at: data.scheduled_at };
  } else if (data.schedule?.reminder_times?.length) {
    const times = data.schedule.reminder_times.map((r) => r.time);
    const amounts = data.schedule.reminder_times.map((r) => Math.max(1, Number(r.amount) || 1));
    schedule = { mode: "daily_times", times, amounts };
    duration = mapDurationFromMed(data.schedule.duration);
  } else {
    schedule = { mode: "daily_times", times: ["09:00"] };
  }
  const inventory: RegimenInventory | null =
    data.inventory_enabled
      ? {
          enabled: true,
          current_amount: data.inventory_current ?? 0,
          refill_threshold_amount: data.inventory_refill_threshold ?? undefined,
          unit,
          auto_decrement_on_taken: true,
        }
      : null;
  const advice = data.intake_advice?.trim() || null;
  const intake_advice_type =
    !advice || advice === "__none__" ? "none" : advice === "custom" ? "custom" : advice;
  const intake_advice_text =
    intake_advice_type === "custom" ? (data.intake_advice_custom?.trim() || null) : null;
  return {
    person_id: data.person_id,
    custom_name: data.name.trim(),
    status: "active",
    intake_unit: data.unit ?? "pill",
    dose_definition,
    intake_advice_type,
    intake_advice_text,
    schedule,
    duration,
    inventory,
    notes: data.notes ?? null,
  };
}

export function updateMedicationInputToRegimenInput(data: UpdateMedicationInput): UpdateMedRegimenInput {
  const out: UpdateMedRegimenInput = {};
  if (data.name !== undefined) out.custom_name = data.name.trim();
  if (data.status !== undefined) out.status = data.status;
  if (data.unit !== undefined) out.intake_unit = data.unit;
  if (data.notes !== undefined) out.notes = data.notes ?? null;
  const unit = data.unit ?? "pill";
  if (data.kind === "one_time" && data.scheduled_at) {
    out.schedule = { mode: "one_off", due_at: data.scheduled_at };
    out.duration = { type: "endless" };
    const oneTimeAmount = Math.max(1, Math.floor(Number(data.one_time_amount)) || 1);
    out.dose_definition = { intake: { amount: oneTimeAmount, unit }, active: [] };
  } else if (data.schedule !== undefined && data.schedule) {
    const s = data.schedule;
    const times = s.reminder_times?.map((r) => r.time) ?? [];
    const amounts = s.reminder_times?.map((r) => Math.max(1, Math.floor(Number(r.amount)) || 1)) ?? [];
    out.schedule = { mode: "daily_times", times, amounts } as MedSchedule;
    out.duration = mapDurationFromMed(s.duration);
    const amount = amounts[0] ?? Math.max(1, Math.floor(Number(s.reminder_times?.[0]?.amount)) || 1);
    out.dose_definition = { intake: { amount, unit }, active: [] };
  }
  if (data.inventory_enabled !== undefined || data.inventory_current !== undefined || data.inventory_refill_threshold !== undefined) {
    out.inventory = {
      enabled: data.inventory_enabled ?? false,
      current_amount: data.inventory_current ?? 0,
      refill_threshold_amount: data.inventory_refill_threshold ?? undefined,
      unit,
      auto_decrement_on_taken: true,
    };
  }
  if (data.intake_advice !== undefined) {
    const advice = data.intake_advice?.trim() || null;
    out.intake_advice_type =
      !advice || advice === "__none__" ? "none" : advice === "custom" ? "custom" : advice;
    out.intake_advice_text =
      out.intake_advice_type === "custom" ? (data.intake_advice_custom?.trim() || null) : null;
  }
  if (data.intake_advice_custom !== undefined) {
    out.intake_advice_text = data.intake_advice_custom?.trim() || null;
  }
  return out;
}
