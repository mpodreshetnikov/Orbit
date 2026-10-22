"use client";

import React from "react";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Trash2, ChevronDown, Check } from "lucide-react";
import { useIsMobile } from "@/hooks/use-media-query";
import { useRegimens } from "@/hooks/use-regimens";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import type { MedicationKind, MedicationUnit } from "@/types";
import { MEDICATION_UNITS, INTAKE_ADVICE_OPTIONS, medicationUnitKey } from "@/types";
import { getUnitIcon, getUnitLabel } from "./medication-units";
import type {
  MedRegimen,
  MedSchedule,
  MedScheduleDaysOfWeek,
  MedDuration,
  CreateMedRegimenInput,
  UpdateMedRegimenInput,
  AddOneTimeToExistingPayload,
} from "@/types/regimen";
import { firstUnitStrength, toPositiveAmount } from "@/types/regimen";
import {
  courseToAddTo,
  getInitialDuration,
  getInitialIntakeAdvice,
  getInitialSchedule,
  getInitialStartDate,
  getReminderSlotsForIntakesPerDay,
  hasPerSlotAmounts,
  oneTimeCourseColumns,
  oneTimeSubmission,
  regularCourseColumns,
  reminderSlots as slotsOf,
  reminderTimesProblem,
  scheduleForMode,
  toDatetimeLocalString,
  withDayToggled,
  withIntervalEvery,
  withSlotAdded,
  withSlotChanged,
  withSlotRemoved,
  type CourseFormValues,
} from "@/types/regimen-form";

// The form's pure parts live in `@/types/regimen-form`, shared with the iOS client; these are
// re-exported because they were first exported from here.
export {
  getInitialDuration,
  getInitialSchedule,
  getInitialStartDate,
  getReminderSlotsForIntakesPerDay,
  mapLegacyIntakeAdvice,
  toDatetimeLocalString,
} from "@/types/regimen-form";

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
  onSubmit: (data: CreateMedRegimenInput | AddOneTimeToExistingPayload) => void | Promise<void>;
}

interface MedicationFormPropsEdit extends MedicationFormPropsBase {
  mode: "edit";
  onSubmit: (data: UpdateMedRegimenInput) => void | Promise<void>;
}

type MedicationFormProps = MedicationFormPropsCreate | MedicationFormPropsEdit;

/** Index of the schedule step in the mobile wizard, where the slots are edited. */
const SCHEDULE_WIZARD_STEP = 1;

/** Units a per-unit strength is commonly written in. */
const STRENGTH_UNITS = ["milligram", "microgram", "gram", "iu", "ml"] as const;

/** The strength units to offer, keeping a stored unit outside the list selectable. */
function strengthUnitOptions(current: string): string[] {
  // A blank stored unit is never offered: Radix reserves the empty value for
  // clearing a select and throws on an item that carries it.
  return !current.trim() || (STRENGTH_UNITS as readonly string[]).includes(current)
    ? [...STRENGTH_UNITS]
    : [...STRENGTH_UNITS, current];
}

function strengthUnitLabel(unit: string, t: ReturnType<typeof useTranslations>): string {
  if (unit === "microgram") return t("medications.unitMicrogram");
  if ((MEDICATION_UNITS as string[]).includes(unit)) {
    return t(medicationUnitKey(unit as MedicationUnit), { count: 1 });
  }
  return unit;
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
  const [name, setName] = useState(() => initial?.custom_name ?? "");
  const [selectedRegimenId, setSelectedRegimenId] = useState<string | null>(null);
  const [kind] = useState<MedicationKind>(() => {
    if (initial?.schedule?.mode === "one_off") return "one_time";
    return defaultKind ?? "regular";
  });
  const [unit, setUnit] = useState<MedicationUnit>(() => initial?.intake_unit ?? "pill");
  // What one unit of the dosage form contains (`ADR-260907-cvj`): 100 mg in one
  // tablet, not what the whole intake delivers, so it survives a titration.
  const initialStrength = firstUnitStrength(initial?.dose_definition);
  const [strengthName, setStrengthName] = useState(() => initialStrength?.name ?? "");
  const [strengthAmount, setStrengthAmount] = useState<number | null>(
    () => initialStrength?.amount ?? null,
  );
  const [strengthUnit, setStrengthUnit] = useState(
    () => initialStrength?.unit.trim() || "milligram",
  );
  const [intakeAdvice, setIntakeAdvice] = useState(() => getInitialIntakeAdvice(initial));
  const [intakeAdviceCustom, setIntakeAdviceCustom] = useState(
    () => initial?.intake_advice_text ?? "",
  );
  const [schedule, setSchedule] = useState<MedSchedule>(() =>
    getInitialSchedule(initial, defaultKind),
  );
  /** The course's base dose, which the generator falls back to for a slot without its own amount. */
  const baseIntakeAmount = toPositiveAmount(initial?.dose_definition?.intake?.amount);
  /**
   * The last weekly schedule this form held, so leaving `days_of_week` for another
   * frequency and coming back restores its days, times and per-slot amounts rather
   * than replacing a real plan with defaults.
   */
  const lastWeeklySchedule = React.useRef<MedScheduleDaysOfWeek | null>(null);
  useEffect(() => {
    if (schedule.mode === "days_of_week") lastWeeklySchedule.current = schedule;
  }, [schedule]);
  const [duration, setDuration] = useState<MedDuration>(() => getInitialDuration(initial));
  const [startDate, setStartDate] = useState(() => getInitialStartDate(initial));
  const [inventoryEnabled, setInventoryEnabled] = useState(
    () => initial?.inventory?.enabled ?? false,
  );
  const [inventoryCurrent, setInventoryCurrent] = useState(() =>
    (initial?.inventory?.current_amount ?? "").toString(),
  );
  const [inventoryRefillThreshold, setInventoryRefillThreshold] = useState(() =>
    (initial?.inventory?.refill_threshold_amount ?? "").toString(),
  );
  const [notes, setNotes] = useState(() => initial?.notes ?? "");
  const [scheduleError, setScheduleError] = useState("");
  const [slotsError, setSlotsError] = useState("");
  const [basicErrorType, setBasicErrorType] = useState<"" | "name" | "scheduled_at">("");
  const [oneTimeAmount, setOneTimeAmount] = useState(() =>
    toPositiveAmount(initial?.dose_definition?.intake?.amount),
  );
  const [scheduledAt, setScheduledAt] = useState(() => {
    const due = (initial?.schedule as { mode?: string; due_at?: string })?.due_at;
    if (due) return toDatetimeLocalString(new Date(due));
    if (mode === "create" && defaultKind === "one_time") return toDatetimeLocalString(new Date());
    return "";
  });
  const isMobile = useIsMobile();
  const { data: regimensList } = useRegimens(personId);
  const totalWizardSteps = kind === "one_time" ? 2 : 4;
  const [wizardStep, setWizardStep] = useState(0);
  const [nameComboboxOpen, setNameComboboxOpen] = useState(false);

  const filteredRegimensForName: MedRegimen[] =
    kind === "one_time" && mode === "create" && regimensList
      ? name.trim()
        ? regimensList.filter((r) =>
            r.custom_name.trim().toLowerCase().includes(name.trim().toLowerCase()),
          )
        : regimensList
      : [];

  useEffect(() => {
    setWizardStep((s) => Math.min(s, totalWizardSteps - 1));
  }, [kind, totalWizardSteps]);

  /** What is wrong with the slot times, if anything (`reminderTimesProblem`). */
  const reminderTimesError = (): string => {
    const problem = reminderTimesProblem(schedule);
    return problem ? t(problem) : "";
  };

  /** Everything the form holds, for the shared builders of what a save writes. */
  const formValues = (): CourseFormValues => ({
    name,
    unit,
    strength: { name: strengthName, amount: strengthAmount, unit: strengthUnit },
    intakeAdvice,
    intakeAdviceCustom,
    schedule,
    duration,
    startDate,
    inventory: {
      enabled: inventoryEnabled,
      current: inventoryCurrent,
      refillThreshold: inventoryRefillThreshold,
    },
    notes,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isMobile && currentStep < totalWizardSteps - 1) return;
    setScheduleError("");
    setBasicErrorType("");
    if (!name.trim()) {
      setBasicErrorType("name");
      return;
    }
    if (kind === "one_time") {
      const scheduledAtISO = scheduledAt ? new Date(scheduledAt).toISOString() : "";
      if (!scheduledAtISO && mode === "create") {
        setBasicErrorType("scheduled_at");
        return;
      }
      if (mode === "create") {
        (onSubmit as (d: CreateMedRegimenInput | AddOneTimeToExistingPayload) => void)(
          oneTimeSubmission(
            formValues(),
            personId,
            oneTimeAmount,
            scheduledAtISO,
            courseToAddTo(name, selectedRegimenId, regimensList),
          ),
        );
      } else {
        (onSubmit as (d: UpdateMedRegimenInput) => void)(
          oneTimeCourseColumns(formValues(), initial, oneTimeAmount, scheduledAtISO),
        );
      }
      return;
    }

    if (duration.type === "for_days" && (!duration.days || duration.days < 1)) {
      setScheduleError(t("medications.daysCountRequired"));
      return;
    }

    const timesError = reminderTimesError();
    if (timesError) {
      setSlotsError(timesError);
      // On mobile the slots live on the schedule step, which is hidden once the
      // wizard has moved on: go back to the message rather than refusing silently.
      if (isMobile) setWizardStep(SCHEDULE_WIZARD_STEP);
      return;
    }

    const columns = regularCourseColumns(formValues(), initial);
    if (mode === "create") {
      (onSubmit as (d: CreateMedRegimenInput) => void)({
        person_id: personId,
        status: "active",
        ...columns,
      });
    } else {
      (onSubmit as (d: UpdateMedRegimenInput) => void)(columns);
    }
  };

  const updateReminderTime = (index: number, field: "time" | "amount", value: string | number) => {
    setSlotsError("");
    setSchedule((prev) => withSlotChanged(prev, index, field, value, baseIntakeAmount));
  };

  const addReminderTime = () => {
    setSlotsError("");
    setSchedule((prev) => withSlotAdded(prev, baseIntakeAmount));
  };

  const removeReminderTime = (index: number) => {
    setSlotsError("");
    setSchedule((prev) => withSlotRemoved(prev, index, baseIntakeAmount));
  };

  const setScheduleMode = (next: MedSchedule) => {
    setSchedule(next);
  };

  const toggleDayOfWeek = (d: number) => {
    setSchedule((prev) => withDayToggled(prev, d));
  };

  const DAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

  const reminderSlots = slotsOf(schedule, baseIntakeAmount);

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
    if (kind === "regular" && currentStep === SCHEDULE_WIZARD_STEP) {
      if (duration.type === "for_days" && (!duration.days || duration.days < 1)) {
        setScheduleError(t("medications.daysCountRequired"));
        return;
      }
      const timesError = reminderTimesError();
      if (timesError) {
        setSlotsError(timesError);
        return;
      }
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
        kind === "one_time" && "min-h-[min(28rem,80vh)]",
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
            {kind === "one_time" && mode === "create" ? (
              <Popover open={nameComboboxOpen} onOpenChange={setNameComboboxOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={nameComboboxOpen}
                    aria-invalid={basicErrorType === "name"}
                    className={cn(
                      "w-full justify-between font-normal h-10",
                      !name && "text-muted-foreground",
                      basicErrorType === "name" &&
                        "border-destructive focus-visible:ring-destructive",
                    )}
                  >
                    <span className="truncate">{name || t("medications.namePlaceholder")}</span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[var(--radix-popover-trigger-width)] p-0"
                  align="start"
                >
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder={t("medications.namePlaceholder")}
                      value={name}
                      onValueChange={(v) => {
                        setBasicErrorType("");
                        setName(v);
                        setSelectedRegimenId(null);
                      }}
                    />
                    <CommandList className="max-h-60">
                      <CommandEmpty>{t("common.noResults")}</CommandEmpty>
                      <CommandGroup>
                        {filteredRegimensForName.map((r) => {
                          const isOneOff = r.schedule?.mode === "one_off";
                          const isArchived = r.status === "archived";
                          return (
                            <CommandItem
                              key={r.id}
                              value={`${r.id}:${r.custom_name}`}
                              onSelect={() => {
                                setBasicErrorType("");
                                setName(r.custom_name);
                                setSelectedRegimenId(r.id);
                                setNameComboboxOpen(false);
                              }}
                              className={cn(selectedRegimenId === r.id && "bg-accent")}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedRegimenId === r.id ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <span className="truncate flex-1">{r.custom_name}</span>
                              {(isArchived || isOneOff) && (
                                <span className="text-xs text-muted-foreground shrink-0 ml-1">
                                  {isArchived && t("medications.statusArchived")}
                                  {isArchived && isOneOff ? " · " : ""}
                                  {isOneOff && t("medications.oneTime")}
                                </span>
                              )}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            ) : (
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
                className={cn(
                  basicErrorType === "name" && "border-destructive focus-visible:ring-destructive",
                )}
              />
            )}
            {basicErrorType === "name" && (
              <p id="name-error" className="text-sm text-destructive" role="alert">
                {basicErrorMessage}
              </p>
            )}
          </div>
          <div
            className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}
          >
            <div className="space-y-2">
              <Label>{t("medications.unit")}</Label>
              <Select value={unit} onValueChange={(v) => setUnit(v as MedicationUnit)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...MEDICATION_UNITS]
                    .sort((a, b) =>
                      t(medicationUnitKey(a), { count: 1 }).localeCompare(
                        t(medicationUnitKey(b), { count: 1 }),
                      ),
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
              <div className="flex items-center gap-2">
                <NumberInput
                  id="dosePerUnit"
                  value={strengthAmount}
                  onValueChange={setStrengthAmount}
                  placeholder={t("medications.dosePerUnitPlaceholder")}
                  className="w-24"
                />
                <Select value={strengthUnit} onValueChange={setStrengthUnit}>
                  <SelectTrigger className="w-24" aria-label={t("medications.strengthUnit")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {strengthUnitOptions(strengthUnit).map((u) => (
                      <SelectItem key={u} value={u}>
                        {strengthUnitLabel(u, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="activeIngredient">
                {t("medications.activeIngredient")}{" "}
                <span className="text-muted-foreground font-normal">{t("common.optional")}</span>
              </Label>
              <Input
                id="activeIngredient"
                value={strengthName}
                onChange={(e) => setStrengthName(e.target.value)}
                placeholder={t("medications.activeIngredientPlaceholder")}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs -mt-2">{t("medications.dosePerUnitHint")}</p>
          {kind === "one_time" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="one-time-amount">{t("medications.oneTimeAmount")}</Label>
                <div className="flex items-center gap-2">
                  <NumberInput
                    id="one-time-amount"
                    value={oneTimeAmount}
                    onValueChange={(n) => {
                      if (n !== null) setOneTimeAmount(n);
                    }}
                    className="w-24"
                  />
                  <span className="text-muted-foreground text-sm">{getUnitLabel(unit, t)}</span>
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
                  className={cn(
                    basicErrorType === "scheduled_at" &&
                      "border-destructive focus-visible:ring-destructive",
                  )}
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
                onValueChange={(v) =>
                  setScheduleMode(
                    scheduleForMode(
                      v as Parameters<typeof scheduleForMode>[0],
                      schedule,
                      lastWeeklySchedule.current,
                    ),
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily_times">{t("medications.frequencyDaily")}</SelectItem>
                  <SelectItem value="interval_hours">{t("medications.everyXHours")}</SelectItem>
                  <SelectItem value="interval_days">{t("medications.everyXDays")}</SelectItem>
                  <SelectItem value="days_of_week">
                    {t("medications.frequencyDaysOfWeek")}
                  </SelectItem>
                </SelectContent>
              </Select>
              {(schedule.mode === "interval_hours" || schedule.mode === "interval_days") && (
                <div className="space-y-2 mt-2">
                  <div className="flex gap-2 items-center flex-wrap">
                    <NumberInput
                      integer
                      aria-label={
                        schedule.mode === "interval_hours"
                          ? t("medications.hours")
                          : t("medications.days")
                      }
                      value={(schedule as { interval?: { every?: number } }).interval?.every ?? 1}
                      onValueChange={(n) => {
                        if (n === null) return;
                        setSchedule(withIntervalEvery(schedule, toPositiveAmount(n)));
                      }}
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">
                      {schedule.mode === "interval_hours"
                        ? t("medications.hours")
                        : t("medications.days")}
                    </span>
                  </div>
                  {schedule.mode === "interval_hours" && (
                    <div className="flex gap-2 items-center">
                      <Label className="text-sm">{t("medications.amountPerIntake")}</Label>
                      <NumberInput
                        className="w-24"
                        aria-label={t("medications.amountPerIntake")}
                        value={toPositiveAmount((schedule as { amount?: number }).amount)}
                        onValueChange={(n) => {
                          if (n === null) return;
                          setSchedule({ ...schedule, amount: toPositiveAmount(n) });
                        }}
                      />
                      <span className="text-sm text-muted-foreground">{getUnitLabel(unit, t)}</span>
                    </div>
                  )}
                </div>
              )}
              {schedule.mode === "days_of_week" && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {([0, 1, 2, 3, 4, 5, 6] as const).map((d) => {
                    const isSelected =
                      (schedule as { days_of_week?: number[] }).days_of_week?.includes(d) ?? false;
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
                            : "bg-muted/50 text-muted-foreground border-muted-foreground/20",
                        )}
                      >
                        {t(`medications.day${DAY_KEYS[d]}`)}
                      </Toggle>
                    );
                  })}
                </div>
              )}
            </div>

            <div
              className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}
            >
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
                    } else if (duration.type === "until_date") {
                      setDuration({
                        type: "until_date",
                        end_date: duration.end_date ?? "",
                        start_date: v,
                      });
                    } else {
                      setDuration({ type: "endless", start_date: v });
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("medications.endType")}</Label>
                <Select
                  value={
                    duration.type === "endless"
                      ? "endless"
                      : duration.type === "until_date"
                        ? "end_date"
                        : "days_from_start"
                  }
                  onValueChange={(v) => {
                    setScheduleError("");
                    if (v === "endless") setDuration({ type: "endless", start_date: startDate });
                    else if (v === "end_date")
                      setDuration({
                        type: "until_date",
                        end_date: duration.type === "until_date" ? duration.end_date : "",
                        start_date: startDate,
                      });
                    else
                      setDuration({
                        type: "for_days",
                        days: duration.type === "for_days" ? duration.days : 1,
                        start_date: startDate,
                      });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="endless">{t("medications.endTypeEndless")}</SelectItem>
                    <SelectItem value="end_date">{t("medications.endTypeEndDate")}</SelectItem>
                    <SelectItem value="days_from_start">
                      {t("medications.endTypeDaysFromStart")}
                    </SelectItem>
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
                  onChange={(e) =>
                    setDuration({
                      type: "until_date",
                      end_date: e.target.value,
                      start_date: startDate,
                    })
                  }
                />
              </div>
            )}
            {duration.type === "for_days" && (
              <div className="space-y-2">
                <Label htmlFor="med-days-count">{t("medications.daysFromStartCount")}</Label>
                <NumberInput
                  id="med-days-count"
                  integer
                  aria-invalid={!!scheduleError}
                  aria-describedby={scheduleError ? "med-days-count-error" : undefined}
                  value={duration.days ?? ""}
                  onValueChange={(n) => {
                    setScheduleError("");
                    if (n === null) return;
                    setDuration({ type: "for_days", days: n, start_date: startDate });
                  }}
                />
                {scheduleError && (
                  <p id="med-days-count-error" className="text-sm text-destructive" role="alert">
                    {scheduleError}
                  </p>
                )}
              </div>
            )}

            {hasPerSlotAmounts(schedule) && (
              <div className="space-y-2">
                <Label>{t("medications.reminderTimes")}</Label>
                <div className="space-y-1.5">
                  <span className="text-sm text-muted-foreground">
                    {t("medications.quickSetIntakes")}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                      <Button
                        key={num}
                        type="button"
                        variant={reminderSlots.length === num ? "default" : "outline"}
                        size="sm"
                        className="min-w-8"
                        onClick={() => {
                          const nextTimes = getReminderSlotsForIntakesPerDay(num).map(
                            (s) => s.time,
                          );
                          setSchedule((prev) => {
                            if (!hasPerSlotAmounts(prev)) return prev;
                            const prevTimes = prev.times ?? [];
                            // Re-picking the count the course already has changes nothing,
                            // so it must not rewrite the doses either.
                            if (
                              prevTimes.length === nextTimes.length &&
                              prevTimes.every((time, i) => time === nextTimes[i])
                            ) {
                              return prev;
                            }
                            const firstAmount = toPositiveAmount(
                              prev.amounts?.[0],
                              baseIntakeAmount,
                            );
                            // Preset times are sorted, so a new slot can land between
                            // existing ones: pair doses by time, not by position, or a
                            // surviving slot inherits its neighbour's dose.
                            const doseByTime = new Map<string, number>();
                            prevTimes.forEach((time, i) => {
                              if (!doseByTime.has(time)) {
                                doseByTime.set(
                                  time,
                                  toPositiveAmount(prev.amounts?.[i], baseIntakeAmount),
                                );
                              }
                            });
                            const amounts = nextTimes.map(
                              (time) => doseByTime.get(time) ?? firstAmount,
                            );
                            return { ...prev, times: nextTimes, amounts };
                          });
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
                      <NumberInput
                        aria-label={t("medications.amountPerIntake")}
                        value={slot.amount}
                        onValueChange={(n) => {
                          if (n === null) return;
                          updateReminderTime(i, "amount", n);
                        }}
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
                {slotsError && (
                  <p
                    id="med-reminder-times-error"
                    className="text-sm text-destructive"
                    role="alert"
                  >
                    {slotsError}
                  </p>
                )}
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
                  <SelectItem value="__none__">{t("medications.intakeAdviceNone")}</SelectItem>
                  {INTAKE_ADVICE_OPTIONS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {t(
                        `medications.intakeAdvice${
                          a === "custom"
                            ? "Custom"
                            : a
                                .split("_")
                                .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
                                .join("")
                        }`,
                      )}
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
              <div
                className={cn(
                  "grid gap-4",
                  isMobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2",
                )}
              >
                <div className="space-y-2">
                  <Label className="block" htmlFor="inventory-current">
                    <span className="block">
                      {t("medications.inventoryCurrent")} ({getUnitLabel(unit, t)})
                    </span>
                    <span className="block text-muted-foreground font-normal text-xs">
                      {t("common.optional")}
                    </span>
                  </Label>
                  <NumberInput
                    id="inventory-current"
                    value={inventoryCurrent}
                    onValueChange={(_n, raw) => setInventoryCurrent(raw)}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="block" htmlFor="inventory-refill-threshold">
                    <span className="block">
                      {t("medications.inventoryRefillThreshold")} ({getUnitLabel(unit, t)})
                    </span>
                    <span className="block text-muted-foreground font-normal text-xs">
                      {t("common.optional")}
                    </span>
                  </Label>
                  <NumberInput
                    id="inventory-refill-threshold"
                    value={inventoryRefillThreshold}
                    onValueChange={(_n, raw) => setInventoryRefillThreshold(raw)}
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
        <div className="fixed left-0 right-0 z-[70] flex gap-2 flex-wrap items-center p-4 bg-background border-t shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] dark:shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.3)] bottom-[calc(3.5rem+max(0.5rem,env(safe-area-inset-bottom)))]">
          {currentStep > 0 ? (
            <Button type="button" variant="outline" onClick={() => setWizardStep((s) => s - 1)}>
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
