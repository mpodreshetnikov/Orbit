"use client";

import React from "react";
import { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Loader2, Search, ChevronsUpDown, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CheckupItem,
  CheckupCategory,
  CheckupSchedule,
  CheckupScheduleInterval,
  CheckupScheduleOneOff,
  CheckupNextDueFrom,
  CheckupWhyLink,
  CreateCheckupItemInput,
  UpdateCheckupItemInput,
} from "@/types";
import type { Condition } from "@/types";

interface CheckupFormProps {
  mode: "create" | "edit";
  initial?: CheckupItem | null;
  personId: string;
  conditions: Condition[];
  onSubmit: (data: CreateCheckupItemInput | UpdateCheckupItemInput) => void | Promise<void>;
  isPending?: boolean;
  onCancel?: () => void;
}

const CATEGORIES: CheckupCategory[] = ["lab", "imaging", "visit", "vaccination", "dental", "other"];

type FrequencyPreset = "1_month" | "3_month" | "6_month" | "1_year" | "custom";
type IntervalUnit = "week" | "month" | "year";

// Get first day of next month
function getFirstOfNextMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

// Get first day of year
function getFirstOfYear(year?: number): string {
  const y = year ?? new Date().getFullYear() + 1;
  return `${y}-01-01`;
}

// Season start dates (current or next occurrence)
function getSeasonStart(season: "winter" | "spring" | "summer" | "autumn"): string {
  const now = new Date();
  const year = now.getFullYear();
  const seasonDates: Record<string, [number, number]> = {
    winter: [12, 1], // Dec 1
    spring: [3, 1], // Mar 1
    summer: [6, 1], // Jun 1
    autumn: [9, 1], // Sep 1
  };
  const [m, d] = seasonDates[season];
  let targetYear = year;
  const seasonDate = new Date(year, m - 1, d);
  if (seasonDate < now) {
    targetYear = year + 1;
  }
  return `${targetYear}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Normalize date to YYYY-MM-DD for date inputs (used in initializers)
function toDateOnly(d: string | null | undefined): string {
  return d && typeof d === "string" ? d.slice(0, 10) : "";
}

function getInitialCategory(initial: CheckupItem | null | undefined): CheckupCategory {
  return initial?.category ?? "visit";
}

function getInitialFrequencyPreset(initial: CheckupItem | null | undefined): FrequencyPreset {
  if (!initial || initial.schedule.type !== "interval") return "6_month";
  const s = initial.schedule;
  const every = s.every;
  const unit = s.unit ?? "month";
  if (every === 1 && unit === "month") return "1_month";
  if (every === 3 && unit === "month") return "3_month";
  if (every === 6 && unit === "month") return "6_month";
  if (every === 1 && unit === "year") return "1_year";
  return "custom";
}

export function CheckupForm({
  mode,
  initial,
  personId,
  conditions,
  onSubmit,
  isPending = false,
  onCancel,
}: CheckupFormProps) {
  const t = useTranslations();
  const [title, setTitle] = useState(() => initial?.title ?? "");
  const [category, setCategory] = useState<CheckupCategory>(() => getInitialCategory(initial));
  const [scheduleType, setScheduleType] = useState<"interval" | "one_off">(() =>
    initial?.schedule.type === "one_off" ? "one_off" : "interval",
  );

  // Interval settings — initialize from initial so edit shows correct values on first paint
  const [frequencyPreset, setFrequencyPreset] = useState<FrequencyPreset>(() =>
    getInitialFrequencyPreset(initial),
  );
  const [customEvery, setCustomEvery] = useState(() => {
    if (!initial || initial.schedule.type !== "interval") return 1;
    const s = initial.schedule;
    return getInitialFrequencyPreset(initial) === "custom" ? s.every : 1;
  });
  const [customUnit, setCustomUnit] = useState<IntervalUnit>(() => {
    if (!initial || initial.schedule.type !== "interval") return "month";
    return (initial.schedule.unit ?? "month") as IntervalUnit;
  });
  const [anchorPreset, setAnchorPreset] = useState<string>(() => {
    if (!initial || initial.schedule.type !== "interval") return "next_period";
    const anchor_date = toDateOnly(initial.schedule.anchor_date);
    return anchor_date ? "custom" : "next_period";
  });
  const [customAnchorDate, setCustomAnchorDate] = useState(() => {
    if (!initial || initial.schedule.type !== "interval") return "";
    return toDateOnly(initial.schedule.anchor_date);
  });
  const [nextDueFrom, setNextDueFrom] = useState<CheckupNextDueFrom>(() => {
    if (!initial || initial.schedule.type !== "interval") return "completion";
    return initial.schedule.next_due_from ?? "completion";
  });

  // One-off
  const [oneOffDueAt, setOneOffDueAt] = useState(() =>
    initial?.schedule.type === "one_off" ? toDateOnly(initial.schedule.due_at) : "",
  );

  // Reminder days before due (empty = day-of reminder only, always active)
  const [reminderDaysBefore, setReminderDaysBefore] = useState<number[]>(() =>
    Array.isArray(initial?.reminder_days_before) ? [...initial.reminder_days_before] : [7],
  );

  // Why/conditions
  const [whyText, setWhyText] = useState(() => initial?.why_text ?? "");
  const [whyLinks, setWhyLinks] = useState<CheckupWhyLink[]>(() =>
    Array.isArray(initial?.why_links) ? initial.why_links : [],
  );
  const [conditionSearch, setConditionSearch] = useState("");
  const [conditionOpen, setConditionOpen] = useState(false);
  const conditionRef = useRef<HTMLDivElement>(null);

  // Compute effective interval values
  const effectiveEvery =
    frequencyPreset === "custom"
      ? customEvery
      : frequencyPreset === "1_month"
        ? 1
        : frequencyPreset === "3_month"
          ? 3
          : frequencyPreset === "6_month"
            ? 6
            : 1;
  const effectiveUnit: IntervalUnit =
    frequencyPreset === "custom" ? customUnit : frequencyPreset === "1_year" ? "year" : "month";

  // Compute anchor date based on preset
  const computeAnchorDate = (): string => {
    if (anchorPreset === "custom") return customAnchorDate;
    if (anchorPreset === "first_of_year") return getFirstOfYear();
    if (anchorPreset === "winter") return getSeasonStart("winter");
    if (anchorPreset === "spring") return getSeasonStart("spring");
    if (anchorPreset === "summer") return getSeasonStart("summer");
    if (anchorPreset === "autumn") return getSeasonStart("autumn");
    if (anchorPreset === "first_of_month") return getFirstOfNextMonth();
    // "next_period" - let DB compute from today
    return "";
  };

  // Get available anchor presets based on frequency
  const getAnchorOptions = () => {
    if (effectiveUnit === "year" || (effectiveUnit === "month" && effectiveEvery >= 12)) {
      return [
        { value: "next_period", label: t("checkups.anchorNextPeriod") },
        { value: "first_of_year", label: t("checkups.anchorFirstOfYear") },
        { value: "winter", label: t("checkups.anchorWinter") },
        { value: "spring", label: t("checkups.anchorSpring") },
        { value: "summer", label: t("checkups.anchorSummer") },
        { value: "autumn", label: t("checkups.anchorAutumn") },
        { value: "custom", label: t("checkups.anchorCustom") },
      ];
    } else if (effectiveUnit === "month") {
      return [
        { value: "next_period", label: t("checkups.anchorNextPeriod") },
        { value: "first_of_month", label: t("checkups.anchorFirstOfMonth") },
        { value: "custom", label: t("checkups.anchorCustom") },
      ];
    } else {
      // weekly
      return [
        { value: "next_period", label: t("checkups.anchorNextPeriod") },
        { value: "custom", label: t("checkups.anchorCustom") },
      ];
    }
  };

  // Derive initial frequency preset and anchor from schedule (shared by effect)
  const getScheduleStateFromInitial = (init: CheckupItem | null | undefined) => {
    if (!init || init.schedule.type !== "interval") return null;
    const s = init.schedule;
    const every = s.every;
    const unit = s.unit ?? "month";
    const anchor_date = init.schedule.type === "interval" ? toDateOnly(s.anchor_date) : "";
    let preset: FrequencyPreset = "6_month";
    if (every === 1 && unit === "month") preset = "1_month";
    else if (every === 3 && unit === "month") preset = "3_month";
    else if (every === 6 && unit === "month") preset = "6_month";
    else if (every === 1 && unit === "year") preset = "1_year";
    else preset = "custom";
    const next_due_from = (s as CheckupScheduleInterval).next_due_from ?? "completion";
    return { preset, every, unit, anchor_date, next_due_from };
  };

  useEffect(() => {
    if (initial) {
      setTitle(initial.title);
      setCategory(initial.category);
      if (initial.schedule.type === "interval") {
        setScheduleType("interval");
        const state = getScheduleStateFromInitial(initial);
        if (state) {
          setFrequencyPreset(state.preset);
          if (state.preset === "custom") {
            setCustomEvery(state.every);
            setCustomUnit(state.unit);
          }
          if (state.anchor_date) {
            setAnchorPreset("custom");
            setCustomAnchorDate(state.anchor_date);
          } else {
            setAnchorPreset("next_period");
            setCustomAnchorDate("");
          }
          setNextDueFrom(state.next_due_from ?? "completion");
        }
      } else {
        setScheduleType("one_off");
        setOneOffDueAt(toDateOnly(initial.schedule.due_at));
      }
      setWhyText(initial.why_text ?? "");
      const links = Array.isArray(initial.why_links) ? initial.why_links : [];
      setWhyLinks(links);
      const days = Array.isArray(initial.reminder_days_before)
        ? [...initial.reminder_days_before]
        : [7];
      setReminderDaysBefore(days);
    } else {
      setTitle("");
      setCategory("visit");
      setScheduleType("interval");
      setFrequencyPreset("6_month");
      setCustomEvery(1);
      setCustomUnit("month");
      setAnchorPreset("next_period");
      setCustomAnchorDate("");
      setNextDueFrom("completion");
      setOneOffDueAt("");
      setWhyText("");
      setWhyLinks([]);
      setReminderDaysBefore([7]);
    }
  }, [initial?.id, initial]);

  // Reset anchor preset when frequency changes (if current preset not available)
  useEffect(() => {
    const options = getAnchorOptions();
    if (!options.find((o) => o.value === anchorPreset)) {
      setAnchorPreset("next_period");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveEvery, effectiveUnit]);

  const anchorDate = computeAnchorDate();
  const schedule: CheckupSchedule =
    scheduleType === "interval"
      ? ({
          type: "interval",
          every: effectiveEvery,
          unit: effectiveUnit,
          ...(anchorDate ? { anchor_date: anchorDate } : {}),
          ...(nextDueFrom !== "completion" ? { next_due_from: nextDueFrom } : {}),
        } as CheckupScheduleInterval)
      : ({ type: "one_off", due_at: oneOffDueAt } as CheckupScheduleOneOff);

  const filteredConditions = conditions.filter((c) => {
    if (!conditionSearch.trim()) return true;
    const q = conditionSearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.code && c.code.toLowerCase().includes(q));
  });

  const toggleCondition = (c: Condition) => {
    const exists = whyLinks.some((l) => l.type === "condition" && l.id === c.id);
    if (exists) {
      setWhyLinks(whyLinks.filter((l) => !(l.type === "condition" && l.id === c.id)));
    } else {
      setWhyLinks([...whyLinks, { type: "condition", id: c.id, label: c.name }]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (scheduleType === "one_off" && !oneOffDueAt.trim()) return;

    const days = reminderDaysBefore
      .filter((d) => typeof d === "number" && d >= 0)
      .sort((a, b) => b - a);
    const reminder_days_before = days;

    if (mode === "create") {
      await onSubmit({
        person_id: personId,
        title: title.trim(),
        category,
        schedule,
        reminder_days_before,
        why_text: whyText.trim() || null,
        why_links: whyLinks.length ? whyLinks : [],
      } as CreateCheckupItemInput);
    } else {
      await onSubmit({
        title: title.trim(),
        category,
        schedule,
        reminder_days_before,
        why_text: whyText.trim() || null,
        why_links: whyLinks,
      } as UpdateCheckupItemInput);
    }
  };

  const anchorOptions = getAnchorOptions();

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Title */}
      <div className="space-y-1.5">
        <Label htmlFor="checkup-title">{t("checkups.itemTitle")} *</Label>
        <Input
          id="checkup-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("checkups.titlePlaceholder")}
          required
        />
      </div>

      {/* Category */}
      <div className="space-y-1.5">
        <Label>{t("checkups.category")}</Label>
        <Select value={category} onValueChange={(v) => setCategory(v as CheckupCategory)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {t(`checkups.category${cat.charAt(0).toUpperCase() + cat.slice(1)}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Schedule Type */}
      <div className="space-y-2">
        <Label>{t("checkups.schedule")}</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            variant={scheduleType === "interval" ? "default" : "outline"}
            size="sm"
            onClick={() => setScheduleType("interval")}
          >
            {t("checkups.recurring")}
          </Button>
          <Button
            type="button"
            variant={scheduleType === "one_off" ? "default" : "outline"}
            size="sm"
            onClick={() => setScheduleType("one_off")}
          >
            {t("checkups.oneOff")}
          </Button>
        </div>
      </div>

      {scheduleType === "interval" ? (
        <>
          {/* Frequency */}
          <div className="space-y-2">
            <Label>{t("checkups.frequency")}</Label>
            <Select
              value={frequencyPreset}
              onValueChange={(v) => setFrequencyPreset(v as FrequencyPreset)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1_month">{t("checkups.interval1Month")}</SelectItem>
                <SelectItem value="3_month">{t("checkups.interval3Months")}</SelectItem>
                <SelectItem value="6_month">{t("checkups.interval6Months")}</SelectItem>
                <SelectItem value="1_year">{t("checkups.interval1Year")}</SelectItem>
                <SelectItem value="custom">{t("checkups.customFrequency")}</SelectItem>
              </SelectContent>
            </Select>

            {frequencyPreset === "custom" && (
              <div className="flex items-center gap-2 mt-2">
                <span className="text-sm text-muted-foreground">{t("checkups.every")}</span>
                <Input
                  type="number"
                  min={1}
                  max={99}
                  value={customEvery}
                  onChange={(e) => setCustomEvery(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-16"
                />
                <Select value={customUnit} onValueChange={(v) => setCustomUnit(v as IntervalUnit)}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="week">{t("checkups.weeks")}</SelectItem>
                    <SelectItem value="month">{t("checkups.months")}</SelectItem>
                    <SelectItem value="year">{t("checkups.years")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* First Due Date / Anchor */}
          <div className="space-y-2">
            <Label>{t("checkups.firstDueDate")}</Label>
            <Select value={anchorPreset} onValueChange={setAnchorPreset}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {anchorOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {anchorPreset === "custom" && (
              <Input
                type="date"
                value={customAnchorDate}
                onChange={(e) => setCustomAnchorDate(e.target.value)}
                className="mt-2"
              />
            )}
          </div>

          {/* After completion: next due from completion date or target date */}
          <div className="space-y-2">
            <Label>{t("checkups.nextDueFrom")}</Label>
            <Select
              value={nextDueFrom}
              onValueChange={(v) => setNextDueFrom(v as CheckupNextDueFrom)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="completion">{t("checkups.nextDueFromCompletion")}</SelectItem>
                <SelectItem value="target">{t("checkups.nextDueFromTarget")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("checkups.nextDueFromHint")}</p>
          </div>
        </>
      ) : (
        /* One-off due date */
        <div className="space-y-1.5">
          <Label htmlFor="one-off-due">{t("checkups.dueDate")}</Label>
          <Input
            id="one-off-due"
            type="date"
            value={oneOffDueAt}
            onChange={(e) => setOneOffDueAt(e.target.value)}
            required={scheduleType === "one_off"}
          />
        </div>
      )}

      {/* Reminder days before due */}
      <div className="space-y-2">
        <Label>{t("checkups.reminderDaysBefore")}</Label>
        <p className="text-xs text-muted-foreground">{t("checkups.reminderDaysBeforeHint")}</p>
        {/* Summary: make it obvious these reminders are active (day-of is always on, hidden) */}
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{t("checkups.reminderActiveSummary")}: </span>
          <span className="font-medium text-foreground">
            {reminderDaysBefore.length === 0
              ? t("checkups.reminderDayOfOnly")
              : reminderDaysBefore.length === 1
                ? reminderDaysBefore[0] === 1
                  ? t("checkups.reminderOneDaySingular")
                  : t("checkups.reminderOneDayPlural", { count: reminderDaysBefore[0] })
                : t("checkups.reminderMultipleDays", {
                    count: reminderDaysBefore.length,
                    days: [...reminderDaysBefore]
                      .filter((d) => typeof d === "number" && d >= 0)
                      .sort((a, b) => b - a)
                      .join(", "),
                  })}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t("checkups.reminderEditBelow")}</p>
        <ul className="space-y-2 list-none p-0 m-0">
          {reminderDaysBefore.map((d, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-md border bg-background px-3 py-2"
            >
              <span className="text-xs font-medium text-muted-foreground w-20 shrink-0">
                {t("checkups.reminderLabel", { index: i + 1 })}
              </span>
              <Input
                type="number"
                min={0}
                max={365}
                value={d}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  const next = [...reminderDaysBefore];
                  next[i] = Number.isNaN(v) ? 0 : Math.max(0, Math.min(365, v));
                  setReminderDaysBefore(next);
                }}
                className="w-20 tabular-nums h-8"
                aria-label={t("checkups.reminderDaysBeforeAria", { index: i + 1 })}
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {t("checkups.reminderDaysBeforeSuffix")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground ml-auto"
                disabled={false}
                onClick={() => setReminderDaysBefore(reminderDaysBefore.filter((_, j) => j !== i))}
                aria-label={t("common.remove")}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setReminderDaysBefore([...reminderDaysBefore, 1])}
        >
          {t("checkups.addReminderDay")}
        </Button>
      </div>

      {/* Why / Reason */}
      <div className="space-y-1.5">
        <Label htmlFor="checkup-why">{t("checkups.why")}</Label>
        <Textarea
          id="checkup-why"
          value={whyText}
          onChange={(e) => setWhyText(e.target.value)}
          placeholder={t("checkups.whyPlaceholder")}
          rows={2}
        />
      </div>

      {/* Linked Conditions — searchable multi-select (always shown; empty state when person has no conditions) */}
      <div className="space-y-1.5 relative" ref={conditionRef}>
        <Label>{t("checkups.linkedConditions")}</Label>
        <Popover
          open={conditionOpen}
          onOpenChange={(open) => {
            setConditionOpen(open);
            if (open) setConditionSearch("");
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={conditionOpen}
              className="h-10 w-full justify-between px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2 truncate">
                <Search className="h-4 w-4 text-muted-foreground" />
                {conditionOpen
                  ? t("checkups.linkedConditionsPlaceholder")
                  : whyLinks.length > 0
                    ? t("checkups.linkedConditionsSelected", { count: whyLinks.length })
                    : t("checkups.linkedConditionsPlaceholder")}
              </span>
              <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command shouldFilter={false}>
              {conditions.length > 0 ? (
                <>
                  <CommandInput
                    value={conditionSearch}
                    onValueChange={setConditionSearch}
                    placeholder={t("checkups.linkedConditionsPlaceholder")}
                    autoFocus
                  />
                  <CommandList className="max-h-48">
                    <CommandGroup>
                      {filteredConditions.map((c) => {
                        const selected = whyLinks.some(
                          (l) => l.type === "condition" && l.id === c.id,
                        );
                        return (
                          <CommandItem
                            key={c.id}
                            value={c.id}
                            onSelect={() => toggleCondition(c)}
                            className={selected ? "bg-accent" : ""}
                          >
                            <Check
                              className={`h-4 w-4 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="truncate">{c.name}</div>
                              {c.code && (
                                <div className="text-xs text-muted-foreground">{c.code}</div>
                              )}
                            </div>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                    {filteredConditions.length === 0 && (
                      <CommandEmpty>{t("common.noResults")}</CommandEmpty>
                    )}
                  </CommandList>
                </>
              ) : (
                <div className="py-4 px-3 text-sm text-muted-foreground space-y-3">
                  <p>{t("checkups.linkedConditionsEmpty")}</p>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/health/conditions">
                      {t("checkups.linkedConditionsGoToConditions")}
                    </Link>
                  </Button>
                </div>
              )}
            </Command>
          </PopoverContent>
        </Popover>

        {whyLinks.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {whyLinks.map((l) => (
              <Badge key={l.id} variant="secondary" className="gap-1 pr-1">
                {l.label}
                <Button
                  type="button"
                  onClick={() => setWhyLinks(whyLinks.filter((x) => x.id !== l.id))}
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 rounded p-0 hover:bg-muted"
                  aria-label={t("common.remove")}
                >
                  <X className="h-3 w-3" />
                </Button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={!title.trim() || isPending}>
          {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {mode === "create" ? t("checkups.add") : t("common.save")}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </form>
  );
}
