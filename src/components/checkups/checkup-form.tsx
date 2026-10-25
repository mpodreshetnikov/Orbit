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
  CheckupNextDueFrom,
  CheckupWhyLink,
  CreateCheckupItemInput,
  UpdateCheckupItemInput,
} from "@/types";
import type { Condition } from "@/types";
import {
  anchorPresets,
  checkupColumns,
  checkupFormProblem,
  effectiveInterval,
  initialCheckupForm,
  toggleConditionLink,
  type AnchorPreset,
  type CheckupFormValues,
  type FrequencyPreset,
  type IntervalUnit,
} from "@/types/checkup-form";

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
  // One reading of the initial values, shared with the iOS client's form.
  const [start] = useState(() => initialCheckupForm(initial));
  const [title, setTitle] = useState(start.title);
  const [category, setCategory] = useState<CheckupCategory>(start.category);
  const [scheduleType, setScheduleType] = useState(start.scheduleType);
  const [frequencyPreset, setFrequencyPreset] = useState<FrequencyPreset>(start.preset);
  const [customEvery, setCustomEvery] = useState(start.customEvery);
  const [customUnit, setCustomUnit] = useState<IntervalUnit>(start.customUnit);
  const [anchorPreset, setAnchorPreset] = useState<string>(start.anchorPreset);
  const [customAnchorDate, setCustomAnchorDate] = useState(start.customAnchorDate);
  const [nextDueFrom, setNextDueFrom] = useState<CheckupNextDueFrom>(start.nextDueFrom);
  const [oneOffDueAt, setOneOffDueAt] = useState(start.oneOffDueAt);
  // Reminder days before due (empty = day-of reminder only, always active)
  const [reminderDaysBefore, setReminderDaysBefore] = useState<number[]>(start.reminderDaysBefore);
  const [whyText, setWhyText] = useState(start.whyText);
  const [whyLinks, setWhyLinks] = useState<CheckupWhyLink[]>(start.whyLinks);
  const [conditionSearch, setConditionSearch] = useState("");
  const [conditionOpen, setConditionOpen] = useState(false);
  const conditionRef = useRef<HTMLDivElement>(null);

  const { every: effectiveEvery, unit: effectiveUnit } = effectiveInterval(
    frequencyPreset,
    customEvery,
    customUnit,
  );

  const ANCHOR_LABELS: Record<AnchorPreset, string> = {
    next_period: t("checkups.anchorNextPeriod"),
    first_of_year: t("checkups.anchorFirstOfYear"),
    first_of_month: t("checkups.anchorFirstOfMonth"),
    winter: t("checkups.anchorWinter"),
    spring: t("checkups.anchorSpring"),
    summer: t("checkups.anchorSummer"),
    autumn: t("checkups.anchorAutumn"),
    custom: t("checkups.anchorCustom"),
  };
  const getAnchorOptions = () =>
    anchorPresets(effectiveEvery, effectiveUnit).map((value) => ({
      value,
      label: ANCHOR_LABELS[value],
    }));

  useEffect(() => {
    const values = initialCheckupForm(initial);
    setTitle(values.title);
    setCategory(values.category);
    setScheduleType(values.scheduleType);
    setFrequencyPreset(values.preset);
    setCustomEvery(values.customEvery);
    setCustomUnit(values.customUnit);
    setAnchorPreset(values.anchorPreset);
    setCustomAnchorDate(values.customAnchorDate);
    setNextDueFrom(values.nextDueFrom);
    setOneOffDueAt(values.oneOffDueAt);
    setWhyText(values.whyText);
    setWhyLinks(values.whyLinks);
    setReminderDaysBefore(values.reminderDaysBefore);
  }, [initial?.id, initial]);

  // Reset anchor preset when frequency changes (if current preset not available)
  useEffect(() => {
    const options = getAnchorOptions();
    if (!options.find((o) => o.value === anchorPreset)) {
      setAnchorPreset("next_period");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveEvery, effectiveUnit]);

  const filteredConditions = conditions.filter((c) => {
    if (!conditionSearch.trim()) return true;
    const q = conditionSearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.code && c.code.toLowerCase().includes(q));
  });

  const toggleCondition = (c: Condition) => setWhyLinks(toggleConditionLink(whyLinks, c));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form: CheckupFormValues = {
      title,
      category,
      scheduleType,
      preset: frequencyPreset,
      customEvery,
      customUnit,
      anchorPreset: anchorPreset as AnchorPreset,
      customAnchorDate,
      nextDueFrom,
      oneOffDueAt,
      reminderDaysBefore,
      whyText,
      whyLinks,
    };
    if (checkupFormProblem(form)) return;
    const columns = checkupColumns(form, new Date());

    if (mode === "create") {
      await onSubmit({ person_id: personId, ...columns } as CreateCheckupItemInput);
    } else {
      await onSubmit(columns as UpdateCheckupItemInput);
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
