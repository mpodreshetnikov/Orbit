"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useIsMobile } from "@/hooks/use-media-query";
import { Button } from "@/components/ui/button";
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
import type {
  Medication,
  MedicationKind,
  MedicationUnit,
  MedicationSchedule,
  MedicationScheduleFrequency,
  CreateMedicationInput,
  UpdateMedicationInput,
} from "@/types";
import { MEDICATION_UNITS, INTAKE_ADVICE_OPTIONS, medicationUnitKey } from "@/types";
import { getUnitIcon, getUnitLabel } from "./medication-units";

interface MedicationFormProps {
  mode: "create" | "edit";
  initial?: Medication | null;
  personId: string;
  defaultKind?: MedicationKind;
  onSubmit: (data: CreateMedicationInput | UpdateMedicationInput) => void | Promise<void>;
  isPending?: boolean;
  onCancel?: () => void;
}

const DEFAULT_SCHEDULE: MedicationSchedule = {
  frequency: { type: "daily" },
  duration: {
    start_date: new Date().toISOString().slice(0, 10),
    end_type: "endless",
  },
  reminder_times: [{ time: "08:00", amount: 1 }],
};

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
  const [name, setName] = useState(() => initial?.name ?? "");
  const [kind, setKind] = useState<MedicationKind>(
    () => initial?.kind ?? defaultKind ?? "regular"
  );
  const [unit, setUnit] = useState<MedicationUnit>(() => initial?.unit ?? "pill");
  const [dosePerUnit, setDosePerUnit] = useState(() => initial?.dose_per_unit ?? "");
  const mapLegacyIntakeAdvice = (v: string | null | undefined): string => {
    if (!v) return "";
    const legacyToNew: Record<string, string> = {
      before_breakfast: "before_meal",
      before_lunch: "before_meal",
      before_dinner: "before_meal",
      before_bed: "before_bed",
      with_breakfast: "with_meal",
      with_lunch: "with_meal",
      with_dinner: "with_meal",
      after_breakfast: "after_meal",
      after_lunch: "after_meal",
      after_dinner: "after_meal",
    };
    return legacyToNew[v] ?? (["before_meal", "with_meal", "after_meal", "before_bed", "morning_fasting", "custom"].includes(v) ? v : "");
  };
  const [intakeAdvice, setIntakeAdvice] = useState(() =>
    mapLegacyIntakeAdvice(initial?.intake_advice as string) || ""
  );
  const [intakeAdviceCustom, setIntakeAdviceCustom] = useState(() =>
    initial?.intake_advice_custom ?? ""
  );
  const [schedule, setSchedule] = useState<MedicationSchedule>(() =>
    initial?.schedule ?? DEFAULT_SCHEDULE
  );
  const [inventoryEnabled, setInventoryEnabled] = useState(() =>
    initial?.inventory_enabled ?? false
  );
  const [inventoryCurrent, setInventoryCurrent] = useState(() =>
    initial?.inventory_current?.toString() ?? ""
  );
  const [inventoryRefillThreshold, setInventoryRefillThreshold] = useState(() =>
    initial?.inventory_refill_threshold?.toString() ?? ""
  );
  const [notes, setNotes] = useState(() => initial?.notes ?? "");
  const [scheduleError, setScheduleError] = useState("");
  const [basicErrorType, setBasicErrorType] = useState<"" | "name" | "scheduled_at">("");
  const [oneTimeAmount, setOneTimeAmount] = useState(() =>
    initial?.kind === "one_time" && initial?.one_time_amount != null
      ? Number(initial.one_time_amount)
      : 1
  );
  const [scheduledAt, setScheduledAt] = useState(() => {
    if (initial?.kind === "one_time" && initial?.scheduled_at) {
      const d = new Date(initial.scheduled_at);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const h = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      return `${y}-${m}-${day}T${h}:${min}`;
    }
    return "";
  });
  const isMobile = useIsMobile();
  const totalWizardSteps = kind === "one_time" ? 2 : 4;
  const [wizardStep, setWizardStep] = useState(0);

  useEffect(() => {
    setWizardStep((s) => Math.min(s, totalWizardSteps - 1));
  }, [kind, totalWizardSteps]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isMobile && currentStep < totalWizardSteps - 1) {
      return;
    }
    setScheduleError("");
    setBasicErrorType("");
    if (!name.trim()) {
      setBasicErrorType("name");
      return;
    }
    if (kind === "one_time") {
      const scheduledAtISO =
        scheduledAt ? new Date(scheduledAt).toISOString() : null;
      if (mode === "create") {
        (onSubmit as (d: CreateMedicationInput) => void)({
          person_id: personId,
          name: name.trim(),
          kind: "one_time",
          unit,
          dose_per_unit: dosePerUnit.trim() || null,
          intake_advice: null,
          intake_advice_custom: null,
          scheduled_at: scheduledAtISO,
          one_time_amount: Math.max(1, oneTimeAmount),
          inventory_enabled: false,
          inventory_current: null,
          inventory_refill_threshold: null,
          notes: notes.trim() || null,
        });
      } else {
        (onSubmit as (d: UpdateMedicationInput) => void)({
          name: name.trim(),
          kind: "one_time",
          unit,
          dose_per_unit: dosePerUnit.trim() || null,
          intake_advice: null,
          intake_advice_custom: null,
          scheduled_at: scheduledAtISO,
          one_time_amount: Math.max(1, oneTimeAmount),
          inventory_enabled: false,
          inventory_current: null,
          inventory_refill_threshold: null,
          notes: notes.trim() || null,
        });
      }
      return;
    }
    if (
      kind === "regular" &&
      schedule.duration.end_type === "days_from_start" &&
      (!schedule.duration.days_count || schedule.duration.days_count < 1)
    ) {
      setScheduleError(t("medications.daysCountRequired"));
      return;
    }
    if (mode === "create") {
      (onSubmit as (d: CreateMedicationInput) => void)({
        person_id: personId,
        name: name.trim(),
        kind: "regular",
        unit,
        dose_per_unit: dosePerUnit.trim() || null,
        intake_advice: intakeAdvice || null,
        intake_advice_custom: intakeAdviceCustom.trim() || null,
        schedule,
        inventory_enabled: inventoryEnabled,
        inventory_current: inventoryCurrent ? Number(inventoryCurrent) : null,
        inventory_refill_threshold: inventoryRefillThreshold
          ? Number(inventoryRefillThreshold)
          : null,
        notes: notes.trim() || null,
      });
    } else {
      (onSubmit as (d: UpdateMedicationInput) => void)({
        name: name.trim(),
        kind: "regular",
        unit,
        dose_per_unit: dosePerUnit.trim() || null,
        intake_advice: intakeAdvice || null,
        intake_advice_custom: intakeAdviceCustom.trim() || null,
        schedule,
        inventory_enabled: inventoryEnabled,
        inventory_current: inventoryCurrent ? Number(inventoryCurrent) : null,
        inventory_refill_threshold: inventoryRefillThreshold
          ? Number(inventoryRefillThreshold)
          : null,
        notes: notes.trim() || null,
      });
    }
  };

  const updateReminderTime = (index: number, field: "time" | "amount", value: string | number) => {
    setSchedule((prev) => {
      const next = [...prev.reminder_times];
      next[index] = { ...next[index], [field]: value };
      return { ...prev, reminder_times: next };
    });
  };

  const addReminderTime = () => {
    setSchedule((prev) => {
      const amount = Math.max(1, Number(prev.reminder_times[0]?.amount) || 1);
      return {
        ...prev,
        reminder_times: [...prev.reminder_times, { time: "08:00", amount }],
      };
    });
  };

  const removeReminderTime = (index: number) => {
    setSchedule((prev) => ({
      ...prev,
      reminder_times: prev.reminder_times.filter((_, i) => i !== index),
    }));
  };

  const setFrequency = (f: MedicationScheduleFrequency) => {
    setSchedule((prev) => ({ ...prev, frequency: f }));
  };

  const setDuration = (updates: Partial<MedicationSchedule["duration"]>) => {
    setSchedule((prev) => ({
      ...prev,
      duration: { ...prev.duration, ...updates },
    }));
  };

  const toggleDayOfWeek = (d: number) => {
    setSchedule((prev) => {
      if (prev.frequency.type !== "days_of_week") return prev;
      const days = prev.frequency.days.includes(d)
        ? prev.frequency.days.filter((x) => x !== d)
        : [...prev.frequency.days, d].sort((a, b) => a - b);
      return { ...prev, frequency: { ...prev.frequency, days } };
    });
  };

  const DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

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
      schedule.duration.end_type === "days_from_start" &&
      (!schedule.duration.days_count || schedule.duration.days_count < 1)
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
                    t(medicationUnitKey(a)).localeCompare(t(medicationUnitKey(b)))
                  )
                  .map((u) => {
                    const Icon = getUnitIcon(u);
                    return (
                      <SelectItem key={u} value={u}>
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          {t(medicationUnitKey(u))}
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
              value={schedule.frequency.type}
              onValueChange={(v) => {
                if (v === "daily") setFrequency({ type: "daily" });
                else if (v === "interval")
                  setFrequency({
                    type: "interval",
                    every: schedule.frequency.type === "interval" ? schedule.frequency.every : 1,
                    unit: schedule.frequency.type === "interval" ? schedule.frequency.unit : "day",
                  });
                else if (v === "days_of_week")
                  setFrequency({
                    type: "days_of_week",
                    days: schedule.frequency.type === "days_of_week" ? schedule.frequency.days : [1, 2, 3, 4, 5],
                  });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">{t("medications.frequencyDaily")}</SelectItem>
                <SelectItem value="interval">{t("medications.frequencyInterval")}</SelectItem>
                <SelectItem value="days_of_week">{t("medications.frequencyDaysOfWeek")}</SelectItem>
              </SelectContent>
            </Select>
            {schedule.frequency.type === "interval" && (
              <div className="flex gap-2 mt-2">
                <Input
                  type="number"
                  min={1}
                  value={schedule.frequency.every}
                  onChange={(e) =>
                    setFrequency({
                      ...schedule.frequency,
                      every: Number(e.target.value) || 1,
                    } as MedicationScheduleFrequency)
                  }
                  className="w-24"
                />
                <Select
                  value={schedule.frequency.unit}
                  onValueChange={(v) =>
                    setFrequency({
                      ...schedule.frequency,
                      unit: v as "hour" | "day",
                    } as MedicationScheduleFrequency)
                  }
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hour">{t("medications.hours")}</SelectItem>
                    <SelectItem value="day">{t("medications.days")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {schedule.frequency.type === "days_of_week" && (() => {
              const freq = schedule.frequency;
              return (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {([0, 1, 2, 3, 4, 5, 6] as const).map((d) => {
                  const isSelected = freq.days.includes(d);
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
              );
            })()}
          </div>

          <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
            <div className="space-y-2">
              <Label>{t("medications.startDate")}</Label>
              <Input
                type="date"
                value={schedule.duration.start_date}
                onChange={(e) => setDuration({ start_date: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("medications.endType")}</Label>
              <Select
                value={schedule.duration.end_type}
                onValueChange={(v) => {
                  setScheduleError("");
                  setDuration({
                    end_type: v as "endless" | "end_date" | "days_from_start",
                  });
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
          {schedule.duration.end_type === "end_date" && (
            <div className="space-y-2">
              <Label>
                {t("medications.endDate")}{" "}
                <span className="text-muted-foreground font-normal">{t("common.optional")}</span>
              </Label>
              <Input
                type="date"
                value={schedule.duration.end_date ?? ""}
                onChange={(e) => setDuration({ end_date: e.target.value })}
              />
            </div>
          )}
          {schedule.duration.end_type === "days_from_start" && (
            <div className="space-y-2">
              <Label htmlFor="med-days-count">{t("medications.daysFromStartCount")}</Label>
              <Input
                id="med-days-count"
                type="number"
                min={1}
                required
                aria-invalid={!!scheduleError}
                aria-describedby={scheduleError ? "med-days-count-error" : undefined}
                value={schedule.duration.days_count ?? ""}
                onChange={(e) => {
                  setScheduleError("");
                  setDuration({ days_count: e.target.value ? Number(e.target.value) : undefined });
                }}
              />
              {scheduleError && (
                <p id="med-days-count-error" className="text-sm text-destructive" role="alert">
                  {scheduleError}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label>{t("medications.reminderTimes")}</Label>
            <div className="space-y-1.5">
              <span className="text-sm text-muted-foreground">{t("medications.quickSetIntakes")}</span>
              <div className="flex flex-wrap gap-1.5">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <Button
                    key={num}
                    type="button"
                    variant={schedule.reminder_times.length === num ? "default" : "outline"}
                    size="sm"
                    className="min-w-8"
                    onClick={() =>
                      setSchedule((prev) => {
                        const nextSlots = getReminderSlotsForIntakesPerDay(num);
                        const currentAmount = prev.reminder_times[0]?.amount ?? 1;
                        const amount = Math.max(1, Number(currentAmount) || 1);
                        return {
                          ...prev,
                          reminder_times: nextSlots.map((slot) => ({ ...slot, amount })),
                        };
                      })
                    }
                  >
                    {num}
                  </Button>
                ))}
              </div>
            </div>
            {schedule.reminder_times.map((slot, i) => (
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
                  disabled={schedule.reminder_times.length <= 1}
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
            <input
              type="checkbox"
              id="inventoryEnabled"
              checked={inventoryEnabled}
              onChange={(e) => setInventoryEnabled(e.target.checked)}
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
