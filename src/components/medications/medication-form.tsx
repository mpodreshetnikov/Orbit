"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import type { MedicationKind, MedicationUnit } from "@/types";
import { MEDICATION_UNITS, INTAKE_ADVICE_OPTIONS, medicationUnitKey } from "@/types";
import { getUnitIcon, getUnitLabel } from "./medication-units";
import type {
  MedRegimen,
  MedSchedule,
  MedDuration,
  CreateMedRegimenInput,
  UpdateMedRegimenInput,
  PlannedIntake,
  RegimenInventory,
} from "@/types/regimen";

interface MedicationFormPropsBase {
  mode: "create" | "edit";
  initial?: MedRegimen | null;
  personId: string;
  defaultKind?: MedicationKind;
  isPending?: boolean;
  onCancel?: () => void;
}

interface MedicationFormPropsCreate extends MedicationFormPropsBase {
  mode: "create";
  onSubmit: (data: CreateMedRegimenInput) => void | Promise<void>;
}

interface MedicationFormPropsEdit extends MedicationFormPropsBase {
  mode: "edit";
  onSubmit: (data: UpdateMedRegimenInput) => void | Promise<void>;
}

type MedicationFormProps = MedicationFormPropsCreate | MedicationFormPropsEdit;

const DEFAULT_SCHEDULE: MedSchedule = {
  mode: "daily_times",
  times: ["09:00"],
  amounts: [1],
};

const DEFAULT_DURATION: MedDuration = { type: "endless" };

// Preset intake times: morning (9AM), midday (12), late afternoon (3PM), evening (8PM), night (11PM), plus extras for 6–10
const PRESET_INTAKE_TIMES: string[] = [
  "09:00", // morning
  "12:00", // midday
  "15:00", // late afternoon
  "20:00", // evening
  "23:00", // night
  "07:00", // early morning
  "10:00", // mid morning
  "14:00", // afternoon
  "18:00", // late evening
  "21:00", // before bed
];

/** Order for 1–5 intakes: 1=morning, 2=morning+evening, 3=morning+late afternoon+evening, 4=+midday, 5=+night */
const INTAKES_1_TO_5_TIMES: string[] = ["09:00", "20:00", "15:00", "12:00", "23:00"];

function getReminderSlotsForIntakesPerDay(n: number): { time: string; amount: number }[] {
  if (n < 1 || n > 10) return [{ time: "09:00", amount: 1 }];
  if (n <= 5) {
    const times = INTAKES_1_TO_5_TIMES.slice(0, n).sort();
    return times.map((time) => ({ time, amount: 1 }));
  }
  const ordered = [...PRESET_INTAKE_TIMES].sort();
  return ordered.slice(0, n).map((time) => ({ time, amount: 1 }));
}

function getInitialSchedule(initial: MedRegimen | null | undefined, defaultKind: MedicationKind | undefined): MedSchedule {
  if (!initial?.schedule) {
    return defaultKind === "one_time"
      ? { mode: "one_off", due_at: "" }
      : DEFAULT_SCHEDULE;
  }
  const s = initial.schedule;
  if (s.mode === "one_off") return { ...s };
  if (s.mode === "daily_times") return { mode: "daily_times", times: s.times ?? ["09:00"], amounts: s.amounts ?? [1] };
  if (s.mode === "interval_hours") return { mode: "interval_hours", interval: { every: s.interval?.every ?? 1 }, amount: Math.max(1, (s as { amount?: number }).amount ?? 1) };
  if (s.mode === "interval_days") {
    const sd = s as { interval?: { every?: number }; time_of_day?: string; times?: string[]; amounts?: number[] };
    const times = sd.times?.length ? sd.times : [sd.time_of_day ?? "09:00"];
    const amounts = sd.amounts?.length ? sd.amounts : times.map(() => 1);
    return { mode: "interval_days", interval: { every: sd.interval?.every ?? 1 }, times, amounts };
  }
  if (s.mode === "days_of_week") return { mode: "days_of_week", days_of_week: (s as { days_of_week?: number[] }).days_of_week ?? [1, 2, 3, 4, 5], times: (s as { times?: string[] }).times ?? ["09:00"] };
  return DEFAULT_SCHEDULE;
}

function getInitialDuration(initial: MedRegimen | null | undefined): MedDuration {
  if (!initial?.duration) return DEFAULT_DURATION;
  const d = initial.duration;
  if (d.type === "until_date") return { type: "until_date", end_date: d.end_date ?? "" };
  if (d.type === "for_days") return { type: "for_days", days: d.days ?? 1, start_date: (d as { start_date?: string }).start_date };
  return { type: "endless" };
}

function getInitialStartDate(initial: MedRegimen | null | undefined): string {
  if (initial?.duration?.type === "for_days" && (initial.duration as { start_date?: string }).start_date)
    return (initial.duration as { start_date: string }).start_date;
  return new Date().toISOString().slice(0, 10);
}

const mapLegacyIntakeAdvice = (v: string | null | undefined): string => {
  if (!v) return "";
  const legacyToNew: Record<string, string> = {
    before_breakfast: "before_meal", before_lunch: "before_meal", before_dinner: "before_meal",
    before_bed: "before_bed", with_breakfast: "with_meal", with_lunch: "with_meal", with_dinner: "with_meal",
    after_breakfast: "after_meal", after_lunch: "after_meal", after_dinner: "after_meal",
  };
  return legacyToNew[v] ?? (["before_meal", "with_meal", "after_meal", "before_bed", "morning_fasting", "custom"].includes(v) ? v : "");
};

export function MedicationForm({
  mode,
  initial,
  personId,
  defaultKind,
  onSubmit,
  isPending = false,
  onCancel,
}: MedicationFormProps) {
  const t = useTranslations();
  const [name, setName] = useState(() => initial?.custom_name ?? "");
  const [kind, setKind] = useState<MedicationKind>(() => {
    if (initial?.schedule?.mode === "one_off") return "one_time";
    return defaultKind ?? "regular";
  });
  const [unit, setUnit] = useState<MedicationUnit>(() => initial?.intake_unit ?? "pill");
  const [dosePerUnit, setDosePerUnit] = useState(() => "");
  const [intakeAdvice, setIntakeAdvice] = useState(() =>
    mapLegacyIntakeAdvice(initial?.intake_advice_type ?? null) || (initial?.intake_advice_type === "none" ? "" : (initial?.intake_advice_type ?? ""))
  );
  const [intakeAdviceCustom, setIntakeAdviceCustom] = useState(() =>
    initial?.intake_advice_text ?? ""
  );
  const [schedule, setSchedule] = useState<MedSchedule>(() =>
    getInitialSchedule(initial, defaultKind)
  );
  const [duration, setDuration] = useState<MedDuration>(() =>
    getInitialDuration(initial)
  );
  const [startDate, setStartDate] = useState(() => getInitialStartDate(initial));
  const [inventoryEnabled, setInventoryEnabled] = useState(() =>
    initial?.inventory?.enabled ?? false
  );
  const [inventoryCurrent, setInventoryCurrent] = useState(() =>
    (initial?.inventory?.current_amount ?? "").toString()
  );
  const [inventoryRefillThreshold, setInventoryRefillThreshold] = useState(() =>
    (initial?.inventory?.refill_threshold_amount ?? "").toString()
  );
  const [notes, setNotes] = useState(() => initial?.notes ?? "");
  const [scheduleError, setScheduleError] = useState("");
  const [basicErrorType, setBasicErrorType] = useState<"" | "name" | "scheduled_at">("");
  const [oneTimeAmount, setOneTimeAmount] = useState(() =>
    Math.max(1, Number(initial?.dose_definition?.intake?.amount) || 1)
  );
  const [scheduledAt, setScheduledAt] = useState(() => {
    const due = (initial?.schedule as { mode?: string; due_at?: string })?.due_at;
    if (due) {
      const d = new Date(due);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    return "";
  });
  const isMobile = useIsMobile();
  const totalWizardSteps = kind === "one_time" ? 2 : 4;
  const [wizardStep, setWizardStep] = useState(0);

  useEffect(() => {
    setWizardStep((s) => Math.min(s, totalWizardSteps - 1));
  }, [kind, totalWizardSteps]);

  const buildDoseDefinition = (amount: number): PlannedIntake => ({
    intake: { amount, unit },
    active: [],
  });

  const buildInventory = (): RegimenInventory | null =>
    inventoryEnabled
      ? {
          enabled: true,
          current_amount: Number(inventoryCurrent) || 0,
          refill_threshold_amount: inventoryRefillThreshold ? Number(inventoryRefillThreshold) : undefined,
          unit,
          auto_decrement_on_taken: true,
        }
      : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isMobile && currentStep < totalWizardSteps - 1) return;
    setScheduleError("");
    setBasicErrorType("");
    if (!name.trim()) {
      setBasicErrorType("name");
      return;
    }
    const advice = intakeAdvice?.trim() || null;
    const intake_advice_type = !advice || advice === "__none__" ? "none" : advice === "custom" ? "custom" : advice;
    const intake_advice_text = intake_advice_type === "custom" ? (intakeAdviceCustom.trim() || null) : null;

    if (kind === "one_time") {
      const scheduledAtISO = scheduledAt ? new Date(scheduledAt).toISOString() : "";
      if (!scheduledAtISO && mode === "create") {
        setBasicErrorType("scheduled_at");
        return;
      }
      const payload = {
        ...(mode === "create" ? { person_id: personId } : {}),
        custom_name: name.trim(),
        intake_unit: unit,
        dose_definition: buildDoseDefinition(Math.max(1, oneTimeAmount)),
        intake_advice_type: "none" as const,
        intake_advice_text: null as string | null,
        schedule: { mode: "one_off" as const, due_at: scheduledAtISO },
        duration: { type: "endless" as const },
        inventory: null,
        notes: notes.trim() || null,
      };
      if (mode === "create") {
        (onSubmit as (d: CreateMedRegimenInput) => void)(payload as CreateMedRegimenInput);
      } else {
        (onSubmit as (d: UpdateMedRegimenInput) => void)(payload as UpdateMedRegimenInput);
      }
      return;
    }

    if (duration.type === "for_days" && (!duration.days || duration.days < 1)) {
      setScheduleError(t("medications.daysCountRequired"));
      return;
    }

    const amount = schedule.mode === "daily_times" && schedule.amounts?.length
      ? Math.max(1, schedule.amounts[0] ?? 1)
      : schedule.mode === "interval_hours"
        ? Math.max(1, (schedule as { amount?: number }).amount ?? 1)
        : schedule.mode === "interval_days" && (schedule as { amounts?: number[] }).amounts?.length
          ? Math.max(1, (schedule as { amounts: number[] }).amounts[0] ?? 1)
          : schedule.mode === "days_of_week"
            ? 1
            : 1;

    const durationToSubmit: MedDuration =
      duration.type === "for_days"
        ? { type: "for_days", days: duration.days ?? 1, start_date: startDate }
        : duration;

    if (mode === "create") {
      (onSubmit as (d: CreateMedRegimenInput) => void)({
        person_id: personId,
        custom_name: name.trim(),
        status: "active",
        intake_unit: unit,
        dose_definition: buildDoseDefinition(amount),
        intake_advice_type,
        intake_advice_text,
        schedule,
        duration: durationToSubmit,
        inventory: buildInventory(),
        notes: notes.trim() || null,
      });
    } else {
      (onSubmit as (d: UpdateMedRegimenInput) => void)({
        custom_name: name.trim(),
        intake_unit: unit,
        dose_definition: buildDoseDefinition(amount),
        intake_advice_type,
        intake_advice_text,
        schedule,
        duration: durationToSubmit,
        inventory: buildInventory(),
        notes: notes.trim() || null,
      });
    }
  };

  const updateReminderTime = (index: number, field: "time" | "amount", value: string | number) => {
    setSchedule((prev) => {
      if (prev.mode !== "daily_times" && prev.mode !== "interval_days") return prev;
      const times = [...(prev.times ?? [])];
      const amounts = [...(prev.amounts ?? [])];
      if (field === "time") times[index] = value as string;
      else amounts[index] = Math.max(1, value as number);
      return { ...prev, times, amounts };
    });
  };

  const addReminderTime = () => {
    setSchedule((prev) => {
      if (prev.mode !== "daily_times" && prev.mode !== "interval_days") return prev;
      const amount = Math.max(1, prev.amounts?.[0] ?? 1);
      return {
        ...prev,
        times: [...(prev.times ?? []), "08:00"],
        amounts: [...(prev.amounts ?? []), amount],
      };
    });
  };

  const removeReminderTime = (index: number) => {
    setSchedule((prev) => {
      if (prev.mode !== "daily_times" && prev.mode !== "interval_days") return prev;
      const times = (prev.times ?? []).filter((_, i) => i !== index);
      const amounts = (prev.amounts ?? []).filter((_, i) => i !== index);
      return { ...prev, times: times.length ? times : ["09:00"], amounts: amounts.length ? amounts : [1] };
    });
  };

  const setScheduleMode = (next: MedSchedule) => {
    setSchedule(next);
  };

  const setDurationUpdate = (updates: Partial<MedDuration> & { end_type?: "endless" | "end_date" | "days_from_start"; end_date?: string; days_count?: number }) => {
    const { end_type, end_date, days_count, ...rest } = updates as MedDuration & { end_type?: string; end_date?: string; days_count?: number };
    if (end_type === "endless") setDuration({ type: "endless" });
    else if (end_type === "end_date" && end_date != null) setDuration({ type: "until_date", end_date });
    else if (end_type === "days_from_start" && days_count != null) setDuration({ type: "for_days", days: days_count, start_date: startDate });
    else if (Object.keys(rest).length) setDuration((prev) => ({ ...prev, ...rest } as MedDuration));
  };

  const toggleDayOfWeek = (d: number) => {
    setSchedule((prev) => {
      if (prev.mode !== "days_of_week") return prev;
      const days = (prev.days_of_week ?? []).includes(d)
        ? (prev.days_of_week ?? []).filter((x) => x !== d)
        : [...(prev.days_of_week ?? []), d].sort((a, b) => a - b);
      return { ...prev, days_of_week: days };
    });
  };

  const DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

  const reminderSlots = schedule.mode === "daily_times" || schedule.mode === "interval_days"
    ? ((schedule as { times?: string[]; amounts?: number[] }).times ?? []).map((time, i) => ({ time, amount: ((schedule as { amounts?: number[] }).amounts ?? [])[i] ?? 1 }))
    : [];

  const currentStep = Math.min(wizardStep, totalWizardSteps - 1);

  const wizardStepSectionKeys: string[] =
    kind === "one_time"
      ? ["sectionBasic", "sectionOther"]
      : ["sectionBasic", "sectionSchedule", "sectionStock", "sectionOther"];
  const currentStepSectionKey = wizardStepSectionKeys[currentStep] ?? "sectionBasic";
  const mobileStepTitle = isMobile
    ? `${t("medications.wizardStepLabel", { current: currentStep + 1, total: totalWizardSteps })}: ${t(`medications.${currentStepSectionKey}`)}`
    : null;

  const handleNext = () => {
    if (currentStep === 0) {
      if (!name.trim()) {
        setBasicErrorType("name");
        return;
      }
      if (kind === "one_time" && !scheduledAt.trim()) {
        setBasicErrorType("scheduled_at");
        return;
      }
      setBasicErrorType("");
    }
    if (
      kind === "regular" &&
      currentStep === 1 &&
      duration.type === "for_days" &&
      (!duration.days || duration.days < 1)
    ) {
      setScheduleError(t("medications.daysCountRequired"));
      return;
    }
    setScheduleError("");
    setWizardStep((s) => Math.min(s + 1, totalWizardSteps - 1));
  };

  const basicErrorMessage =
    basicErrorType === "name"
      ? t("medications.validationNameRequired")
      : basicErrorType === "scheduled_at"
        ? t("medications.validationScheduledAtRequired")
        : "";

  const sectionWrapClass = isMobile
    ? "space-y-4"
    : "rounded-lg border bg-muted/30 dark:bg-muted/10 p-4 space-y-4";

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "space-y-6",
        isMobile && "pb-40",
        kind === "one_time" && "min-h-[min(28rem,80vh)]"
      )}
    >
      {mobileStepTitle != null && (
        <h2 className="text-base font-semibold text-foreground" aria-live="polite">
          {mobileStepTitle}
        </h2>
      )}
      <div className={cn(isMobile && wizardStep !== 0 && "hidden")}>
      <section className={sectionWrapClass}>
        {!isMobile && (
          <h3 className="text-sm font-semibold text-foreground">
            {t("medications.sectionBasic")}
          </h3>
        )}
        <div className="space-y-2">
          <Label htmlFor="name">{t("medications.name")}</Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => {
              setBasicErrorType("");
              setName(e.target.value);
            }}
            placeholder={t("medications.namePlaceholder")}
            required
            aria-invalid={basicErrorType === "name"}
            aria-describedby={basicErrorType === "name" ? "name-error" : undefined}
            className={cn(basicErrorType === "name" && "border-destructive focus-visible:ring-destructive")}
          />
          {basicErrorType === "name" && (
            <p id="name-error" className="text-sm text-destructive" role="alert">
              {basicErrorMessage}
            </p>
          )}
        </div>
        <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
          <div className="space-y-2">
            <Label>{t("medications.unit")}</Label>
            <Select value={unit} onValueChange={(v) => setUnit(v as MedicationUnit)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...MEDICATION_UNITS]
                  .sort((a, b) =>
                    t(medicationUnitKey(a), { count: 1 }).localeCompare(t(medicationUnitKey(b), { count: 1 }))
                  )
                  .map((u) => {
                    const Icon = getUnitIcon(u);
                    return (
                      <SelectItem key={u} value={u}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          {t(medicationUnitKey(u), { count: 1 })}
                        </span>
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dosePerUnit">
              {t("medications.dosePerUnit")}{" "}
              <span className="text-muted-foreground font-normal">{t("common.optional")}</span>
            </Label>
            <Input
              id="dosePerUnit"
              value={dosePerUnit}
              onChange={(e) => setDosePerUnit(e.target.value)}
              placeholder={t("medications.dosePerUnitPlaceholder")}
            />
          </div>
        </div>
        {kind === "one_time" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="one-time-amount">{t("medications.oneTimeAmount")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="one-time-amount"
                  type="number"
                  min={1}
                  step={1}
                  value={oneTimeAmount}
                  onChange={(e) =>
                    setOneTimeAmount(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="w-24"
                />
                <span className="text-muted-foreground text-sm">
                  {getUnitLabel(unit, t)}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="scheduled-at">{t("medications.scheduledAt")}</Label>
              <Input
                id="scheduled-at"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => {
                  setBasicErrorType("");
                  setScheduledAt(e.target.value);
                }}
                aria-invalid={basicErrorType === "scheduled_at"}
                className={cn(basicErrorType === "scheduled_at" && "border-destructive focus-visible:ring-destructive")}
              />
              {basicErrorType === "scheduled_at" && (
                <p className="text-sm text-destructive" role="alert">
                  {basicErrorMessage}
                </p>
              )}
            </div>
          </>
        )}
      </section>
      </div>

      {kind === "regular" && (
        <div className={cn(isMobile && wizardStep !== 1 && "hidden")}>
        <section className={sectionWrapClass}>
          {!isMobile && (
            <h3 className="text-sm font-semibold text-foreground">
              {t("medications.sectionSchedule")}
            </h3>
          )}
          <div className="space-y-2">
            <Label>{t("medications.frequency")}</Label>
            <Select
              value={schedule.mode}
              onValueChange={(v) => {
                if (v === "daily_times") setScheduleMode({ mode: "daily_times", times: ["09:00"], amounts: [1] });
                else if (v === "interval_hours") setScheduleMode({ mode: "interval_hours", interval: { every: schedule.mode === "interval_hours" ? (schedule as { interval?: { every?: number } }).interval?.every ?? 1 : 1 }, amount: schedule.mode === "interval_hours" ? Math.max(1, (schedule as { amount?: number }).amount ?? 1) : 1 });
                else if (v === "interval_days") {
                  const prev = schedule.mode === "interval_days" ? schedule as { times?: string[]; amounts?: number[]; interval?: { every?: number } } : null;
                  setScheduleMode({ mode: "interval_days", interval: { every: prev?.interval?.every ?? 1 }, times: prev?.times?.length ? prev.times : ["09:00"], amounts: prev?.amounts?.length ? prev.amounts : [1] });
                }
                else if (v === "days_of_week") setScheduleMode({ mode: "days_of_week", days_of_week: schedule.mode === "days_of_week" ? (schedule as { days_of_week?: number[] }).days_of_week ?? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5], times: schedule.mode === "days_of_week" ? (schedule as { times?: string[] }).times ?? ["09:00"] : ["09:00"] });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily_times">{t("medications.frequencyDaily")}</SelectItem>
                <SelectItem value="interval_hours">{t("medications.everyXHours")}</SelectItem>
                <SelectItem value="interval_days">{t("medications.everyXDays")}</SelectItem>
                <SelectItem value="days_of_week">{t("medications.frequencyDaysOfWeek")}</SelectItem>
              </SelectContent>
            </Select>
            {(schedule.mode === "interval_hours" || schedule.mode === "interval_days") && (
              <div className="space-y-2 mt-2">
                <div className="flex gap-2 items-center flex-wrap">
                  <Input
                    type="number"
                    min={1}
                    value={(schedule as { interval?: { every?: number } }).interval?.every ?? 1}
                    onChange={(e) => {
                      const every = Number(e.target.value) || 1;
                      if (schedule.mode === "interval_hours") setSchedule({ ...schedule, interval: { every }, amount: (schedule as { amount?: number }).amount ?? 1 });
                      else setSchedule({ ...schedule, interval: { every }, times: (schedule as { times?: string[] }).times ?? ["09:00"], amounts: (schedule as { amounts?: number[] }).amounts ?? [1] });
                    }}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">
                    {schedule.mode === "interval_hours" ? t("medications.hours") : t("medications.days")}
                  </span>
                </div>
                {schedule.mode === "interval_hours" && (
                  <div className="flex gap-2 items-center">
                    <Label className="text-sm">{t("medications.amountPerIntake")}</Label>
                    <Input
                      type="number"
                      min={1}
                      className="w-24"
                      value={Math.max(1, (schedule as { amount?: number }).amount ?? 1)}
                      onChange={(e) => setSchedule({ ...schedule, amount: Math.max(1, Number(e.target.value) || 1) })}
                    />
                    <span className="text-sm text-muted-foreground">{getUnitLabel(unit, t)}</span>
                  </div>
                )}
              </div>
            )}
            {schedule.mode === "days_of_week" && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {([0, 1, 2, 3, 4, 5, 6] as const).map((d) => {
                  const isSelected = (schedule as { days_of_week?: number[] }).days_of_week?.includes(d) ?? false;
                  return (
                    <Toggle
                      key={d}
                      variant="outline"
                      size="sm"
                      pressed={isSelected}
                      onPressedChange={() => toggleDayOfWeek(d)}
                      className={cn(
                        "min-w-9",
                        isSelected
                          ? "bg-primary text-primary-foreground border-primary font-semibold hover:bg-primary/90 hover:text-primary-foreground"
                          : "bg-muted/50 text-muted-foreground border-muted-foreground/20"
                      )}
                    >
                      {t(`medications.day${DAY_KEYS[d]}`)}
                    </Toggle>
                  );
                })}
              </div>
            )}
          </div>

          <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
            <div className="space-y-2">
              <Label>{t("medications.startDate")}</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  const v = e.target.value;
                  setStartDate(v);
                  if (duration.type === "for_days") {
                    setDuration({ type: "for_days", days: duration.days ?? 1, start_date: v });
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("medications.endType")}</Label>
              <Select
                value={duration.type === "endless" ? "endless" : duration.type === "until_date" ? "end_date" : "days_from_start"}
                onValueChange={(v) => {
                  setScheduleError("");
                  if (v === "endless") setDuration({ type: "endless" });
                  else if (v === "end_date") setDuration({ type: "until_date", end_date: duration.type === "until_date" ? duration.end_date : "" });
                  else setDuration({ type: "for_days", days: duration.type === "for_days" ? duration.days : 1, start_date: startDate });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="endless">{t("medications.endTypeEndless")}</SelectItem>
                  <SelectItem value="end_date">{t("medications.endTypeEndDate")}</SelectItem>
                  <SelectItem value="days_from_start">{t("medications.endTypeDaysFromStart")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {duration.type === "until_date" && (
            <div className="space-y-2">
              <Label>
                {t("medications.endDate")}{" "}
                <span className="text-muted-foreground font-normal">{t("common.optional")}</span>
              </Label>
              <Input
                type="date"
                value={duration.end_date ?? ""}
                onChange={(e) => setDuration({ type: "until_date", end_date: e.target.value })}
              />
            </div>
          )}
          {duration.type === "for_days" && (
            <div className="space-y-2">
              <Label htmlFor="med-days-count">{t("medications.daysFromStartCount")}</Label>
              <Input
                id="med-days-count"
                type="number"
                min={1}
                required
                aria-invalid={!!scheduleError}
                aria-describedby={scheduleError ? "med-days-count-error" : undefined}
                value={duration.days ?? ""}
                onChange={(e) => {
                  setScheduleError("");
                  const n = e.target.value ? Number(e.target.value) : undefined;
                  setDuration({ type: "for_days", days: n ?? 1, start_date: startDate });
                }}
              />
              {scheduleError && (
                <p id="med-days-count-error" className="text-sm text-destructive" role="alert">
                  {scheduleError}
                </p>
              )}
            </div>
          )}

          {(schedule.mode === "daily_times" || schedule.mode === "interval_days") && (
          <div className="space-y-2">
            <Label>{t("medications.reminderTimes")}</Label>
            <div className="space-y-1.5">
              <span className="text-sm text-muted-foreground">{t("medications.quickSetIntakes")}</span>
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <Button
                    key={num}
                    type="button"
                    variant={reminderSlots.length === num ? "default" : "outline"}
                    size="sm"
                    className="min-w-8"
                    onClick={() => {
                      const nextSlots = getReminderSlotsForIntakesPerDay(num);
                      const currentAmount = (schedule as { amounts?: number[] }).amounts?.[0] ?? 1;
                      const amount = Math.max(1, Number(currentAmount) || 1);
                      if (schedule.mode === "daily_times") {
                        setSchedule({ mode: "daily_times", times: nextSlots.map((s) => s.time), amounts: nextSlots.map(() => amount) });
                      } else {
                        setSchedule({ ...schedule, times: nextSlots.map((s) => s.time), amounts: nextSlots.map(() => amount) });
                      }
                    }}
                  >
                    {num}
                  </Button>
                ))}
              </div>
            </div>
            {reminderSlots.map((slot, i) => (
              <div key={i} className="flex gap-2 items-center flex-wrap">
                <Input
                  type="time"
                  value={slot.time}
                  onChange={(e) => updateReminderTime(i, "time", e.target.value)}
                  className="min-w-[9rem] w-36 sm:w-28 shrink-0"
                />
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={slot.amount}
                    onChange={(e) =>
                      updateReminderTime(i, "amount", Math.max(1, Number(e.target.value) || 1))
                    }
                    className="w-20"
                  />
                  <span className="text-muted-foreground text-sm whitespace-nowrap">
                    {getUnitLabel(unit, t)}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeReminderTime(i)}
                  disabled={reminderSlots.length <= 1}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addReminderTime}>
              <Plus className="h-4 w-4 mr-1" />
              {t("medications.addReminder")}
            </Button>
          </div>
          )}

          <div className="space-y-2">
            <Label>
              {t("medications.intakeAdvice")}{" "}
              <span className="text-muted-foreground font-normal">{t("common.optional")}</span>
            </Label>
            <Select
              value={intakeAdvice || "__none__"}
              onValueChange={(v) => setIntakeAdvice(v === "__none__" ? "" : v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("medications.intakeAdvice")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  {t("medications.intakeAdviceNone")}
                </SelectItem>
                {INTAKE_ADVICE_OPTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {t(`medications.intakeAdvice${a === "custom" ? "Custom" : a.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("")}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {intakeAdvice === "custom" && (
              <Input
                value={intakeAdviceCustom}
                onChange={(e) => setIntakeAdviceCustom(e.target.value)}
                placeholder={t("medications.intakeAdviceCustom")}
                className="mt-2"
              />
            )}
          </div>
        </section>
        </div>
      )}

      {kind === "regular" && (
        <div className={cn(isMobile && wizardStep !== 2 && "hidden")}>
        <section className={sectionWrapClass}>
          {!isMobile && (
            <h3 className="text-sm font-semibold text-foreground">
              {t("medications.sectionStock")}{" "}
              <span className="text-muted-foreground font-normal">{t("common.optional")}</span>
            </h3>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="inventoryEnabled"
              checked={inventoryEnabled}
              onCheckedChange={(checked) => setInventoryEnabled(Boolean(checked))}
            />
            <Label htmlFor="inventoryEnabled">{t("medications.inventoryEnabled")}</Label>
          </div>
          {inventoryEnabled && (
            <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
              <div className="space-y-2">
                <Label className="block">
                  <span className="block">{t("medications.inventoryCurrent")} ({getUnitLabel(unit, t)})</span>
                  <span className="block text-muted-foreground font-normal text-xs">{t("common.optional")}</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={inventoryCurrent}
                  onChange={(e) => setInventoryCurrent(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="block">
                  <span className="block">{t("medications.inventoryRefillThreshold")} ({getUnitLabel(unit, t)})</span>
                  <span className="block text-muted-foreground font-normal text-xs">{t("common.optional")}</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  value={inventoryRefillThreshold}
                  onChange={(e) => setInventoryRefillThreshold(e.target.value)}
                />
              </div>
            </div>
          )}
        </section>
        </div>
      )}

      <div className={cn(isMobile && wizardStep !== (kind === "one_time" ? 1 : 3) && "hidden")}>
      <section className={sectionWrapClass}>
        {!isMobile && (
          <h3 className="text-sm font-semibold text-foreground">
            {t("medications.sectionOther")}
          </h3>
        )}
        <div className="space-y-2">
          <Label htmlFor="notes">
            {t("medications.notes")}{" "}
            <span className="text-muted-foreground font-normal">{t("common.optional")}</span>
          </Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t("medications.notesPlaceholder")}
            rows={2}
          />
        </div>
      </section>
      </div>

      {isMobile ? (
        <div
          className="fixed left-0 right-0 z-[70] flex gap-2 flex-wrap items-center p-4 bg-background border-t shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] dark:shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.3)] bottom-[calc(3.5rem+max(0.5rem,env(safe-area-inset-bottom)))]"
        >
          {currentStep > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setWizardStep((s) => s - 1)}
            >
              {t("common.back")}
            </Button>
          ) : null}
          {currentStep < totalWizardSteps - 1 ? (
            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleNext();
              }}
            >
              {t("common.next")}
            </Button>
          ) : (
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {mode === "create" ? t("common.add") : t("common.save")}
            </Button>
          )}
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex gap-2 flex-wrap">
          <Button type="submit" disabled={isPending || !name.trim()}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {mode === "create" ? t("common.add") : t("common.save")}
          </Button>
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
