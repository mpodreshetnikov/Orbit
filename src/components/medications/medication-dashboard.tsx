"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { format, addDays, subDays } from "date-fns";
import { Pill, Check, X, ChevronDown, ChevronRight, ChevronLeft, Loader2, Clock, MoreVertical, RotateCcw, Minus, Pencil, CheckCircle, AlertCircle, Ban, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  useDoseEventsForPerson,
  useMarkDoseTaken,
  useMarkDoseSkipped,
  useUndoDoseIntake,
  useUpdateDoseEventResolutionDetails,
  useDeleteRegimen,
} from "@/hooks";
import { useDateFnsLocale, useDateHeaderFormat } from "@/lib/date-locale";
import { useUIStore } from "@/stores/ui-store";
import { enUS, ru } from "react-day-picker/locale";
import type { MedDoseEventStatus, MedDoseEventWithRegimen } from "@/types/regimen";
import { getPlannedIntakeAmount, getPlannedIntakeUnit } from "@/types/regimen";
import type { MedicationUnit } from "@/types";
import { formatAmountWithUnit, getUnitIcon } from "./medication-units";
import { EditIntakeDialog } from "./edit-intake-dialog";

function getTodayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getDayBoundsForDate(dateStr: string): { dayStartIso: string; dayEndIso: string } {
  const d = new Date(dateStr + "T12:00:00");
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return { dayStartIso: start.toISOString(), dayEndIso: end.toISOString() };
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function getEventTimeIso(e: MedDoseEventWithRegimen): string {
  return e.taken_at || e.actual_at;
}

function groupEventsByTime(events: MedDoseEventWithRegimen[]): Map<string, MedDoseEventWithRegimen[]> {
  const byTime = new Map<string, MedDoseEventWithRegimen[]>();
  for (const e of events) {
    const time = formatTime(getEventTimeIso(e));
    const list = byTime.get(time) ?? [];
    list.push(e);
    byTime.set(time, list);
  }
  for (const list of byTime.values()) {
    list.sort((a, b) => getEventTimeIso(a).localeCompare(getEventTimeIso(b)));
  }
  return byTime;
}

function getStatusIcon(status: MedDoseEventStatus): { Icon: typeof Check; className?: string } {
  switch (status) {
    case "taken":
      return { Icon: CheckCircle, className: "text-green-600 dark:text-green-400 shrink-0" };
    case "skipped":
      return { Icon: X, className: "text-muted-foreground shrink-0" };
    case "missed":
      return { Icon: AlertCircle, className: "text-amber-600 dark:text-amber-400 shrink-0" };
    case "cancelled":
      return { Icon: Ban, className: "text-muted-foreground shrink-0" };
    default:
      return { Icon: Clock, className: "text-muted-foreground shrink-0" };
  }
}

function isOneOffEvent(e: MedDoseEventWithRegimen): boolean {
  const schedule = (e.regimen as { schedule?: { mode?: string } } | null)?.schedule;
  return (schedule as { mode?: string } | null)?.mode === "one_off";
}

function getIntakeAdviceLabel(
  regimen: MedDoseEventWithRegimen["regimen"],
  t: (key: string) => string
): string | null {
  if (!regimen?.intake_advice_type) return null;
  const type = regimen.intake_advice_type;
  if (type === "none") return null;
  if (type === "custom") {
    return regimen.intake_advice_text?.trim() || null;
  }
  const key = `medications.intakeAdvice${type
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("")}`;
  return t(key) || null;
}

const todayStr = getTodayDateStr();

export function MedicationDashboard() {
  const t = useTranslations();
  const dateLocale = useDateFnsLocale();
  const dateHeaderFormat = useDateHeaderFormat();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const [selectedDateStr, setSelectedDateStr] = useState(todayStr);
  const { dayStartIso, dayEndIso } = useMemo(
    () => getDayBoundsForDate(selectedDateStr),
    [selectedDateStr]
  );
  const isToday = selectedDateStr === todayStr;
  const isPast = selectedDateStr < todayStr;
  const isFuture = selectedDateStr > todayStr;
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [editIntakeEvent, setEditIntakeEvent] = useState<MedDoseEventWithRegimen | null>(null);
  const [recentlyCompletedIds, setRecentlyCompletedIds] = useState<Set<string>>(() => new Set());
  const inactivityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: events, isLoading } = useDoseEventsForPerson(
    selectedPersonId ?? null,
    dayStartIso,
    dayEndIso
  );

  const goPrev = useCallback(() => {
    setSelectedDateStr((s) => format(subDays(new Date(s + "T12:00:00"), 1), "yyyy-MM-dd"));
  }, []);
  const goNext = useCallback(() => {
    setSelectedDateStr((s) => format(addDays(new Date(s + "T12:00:00"), 1), "yyyy-MM-dd"));
  }, []);
  const goToday = useCallback(() => setSelectedDateStr(todayStr), []);
  const markTaken = useMarkDoseTaken();
  const markSkipped = useMarkDoseSkipped();
  const undoIntake = useUndoDoseIntake();
  const updateResolutionDetails = useUpdateDoseEventResolutionDetails();
  const deleteRegimen = useDeleteRegimen();
  const [removeConfirmEvent, setRemoveConfirmEvent] = useState<MedDoseEventWithRegimen | null>(null);

  const scheduleMoveToCompleted = useCallback(() => {
    if (inactivityTimeoutRef.current) clearTimeout(inactivityTimeoutRef.current);
    inactivityTimeoutRef.current = setTimeout(() => {
      setRecentlyCompletedIds(new Set());
      inactivityTimeoutRef.current = null;
    }, 5000);
  }, []);

  const { pendingSlots, completedSectionSlots, completedSectionCount, overdueIds } = useMemo(() => {
    if (!events) return { pendingSlots: [] as { time: string; events: MedDoseEventWithRegimen[] }[], completedSectionSlots: [] as { time: string; events: MedDoseEventWithRegimen[] }[], completedSectionCount: 0, overdueIds: new Set<string>() };
    const nowIso = new Date().toISOString();
    const isTodayView = selectedDateStr === todayStr;
    const todayDateStr = nowIso.slice(0, 10);
    const pendingFuture = events.filter(
      (e) => (e.status === "scheduled" || e.status === "sent" || e.status === "snoozed") && e.actual_at >= nowIso
    );
    const overdueTodayRegular = isTodayView
      ? events.filter(
          (e) =>
            (e.status === "scheduled" || e.status === "sent" || e.status === "snoozed" || e.status === "missed") &&
            e.actual_at < nowIso &&
            e.actual_at.slice(0, 10) === todayDateStr &&
            !isOneOffEvent(e)
        )
      : [];
    const overdueIdsSet = new Set(overdueTodayRegular.map((e) => e.id));
    const pending = [...pendingFuture, ...overdueTodayRegular];
    const resolved = events.filter((e) => e.status === "taken" || e.status === "skipped");
    const unspecified = events.filter(
      (e) =>
        (e.status === "scheduled" || e.status === "sent" || e.status === "snoozed" || e.status === "missed") &&
        e.actual_at < nowIso &&
        !(isTodayView && e.actual_at.slice(0, 10) === todayDateStr && !isOneOffEvent(e))
    );
    const completedSectionEvents = [...resolved, ...unspecified]
      .filter((e) => !recentlyCompletedIds.has(e.id))
      .sort((a, b) => getEventTimeIso(a).localeCompare(getEventTimeIso(b)));
    const pendingIds = new Set(pending.map((e) => e.id));
    const recentlyCompletedOnly = events.filter(
      (e) => recentlyCompletedIds.has(e.id) && !pendingIds.has(e.id)
    );
    const intakeListEvents = [...pending, ...recentlyCompletedOnly];
    const pendingByTime = groupEventsByTime(intakeListEvents);
    const slots = Array.from(pendingByTime.entries())
      .map(([time, evs]) => ({ time, events: evs }))
      .sort((a, b) => a.time.localeCompare(b.time));
    const byTime = groupEventsByTime(completedSectionEvents);
    const completedSlots = Array.from(byTime.entries())
      .map(([time, evs]) => ({ time, events: evs }))
      .sort((a, b) => a.time.localeCompare(b.time));
    return { pendingSlots: slots, completedSectionSlots: completedSlots, completedSectionCount: completedSectionEvents.length, overdueIds: overdueIdsSet };
  }, [events, recentlyCompletedIds, selectedDateStr]);

  const displayDateLabel = useMemo(() => {
    const d = new Date(selectedDateStr + "T12:00:00");
    return format(d, dateHeaderFormat, { locale: dateLocale });
  }, [selectedDateStr, dateLocale, dateHeaderFormat]);

  const language = useUIStore((s) => s.language);
  const dayPickerLocale = language === "ru" ? ru : enUS;
  const selectedDate = useMemo(
    () => new Date(selectedDateStr + "T12:00:00"),
    [selectedDateStr]
  );

  const handleTaken = async (e: MedDoseEventWithRegimen) => {
    setRecentlyCompletedIds((prev) => new Set(prev).add(e.id));
    scheduleMoveToCompleted();
    await markTaken.mutateAsync({ doseEventId: e.id });
  };

  const handleSkipped = async (e: MedDoseEventWithRegimen) => {
    setRecentlyCompletedIds((prev) => new Set(prev).add(e.id));
    scheduleMoveToCompleted();
    await markSkipped.mutateAsync({ doseEventId: e.id });
  };

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        {t("person.selectPrompt")}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-10 rounded bg-muted animate-pulse" />
        <div className="h-24 rounded bg-muted animate-pulse" />
      </div>
    );
  }

  const sectionTitle = isToday
    ? t("medications.todayIntakes")
    : t("medications.intakesForDate", { date: displayDateLabel });
  const showCompletedExpanded = isPast;
  const actionable = !isFuture;

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-medium text-muted-foreground">
            {sectionTitle}
          </h2>
          {!isToday && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 text-xs"
              onClick={goToday}
            >
              {t("medications.dateToday")}
            </Button>
          )}
        </div>
        <div className="flex w-full sm:w-auto items-center gap-1 min-w-0">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={goPrev}
            aria-label={t("medications.datePrev")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="flex-1 min-w-0 h-8 justify-center text-sm font-medium tabular-nums"
                aria-label={t("medications.selectDate")}
              >
                {displayDateLabel}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="center">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={(date) => {
                  if (date) {
                    setSelectedDateStr(format(date, "yyyy-MM-dd"));
                    setDatePickerOpen(false);
                  }
                }}
                locale={dayPickerLocale}
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={goNext}
            aria-label={t("medications.dateNext")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {pendingSlots.length === 0 && completedSectionCount === 0 && (!events || events.length === 0) ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          <Pill className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>{t("medications.noItems")}</p>
          <Link href="/health/medications/new">
            <Button size="sm" variant="ghost" className="mt-2">
              {t("medications.add")}
            </Button>
          </Link>
        </div>
      ) : pendingSlots.length === 0 && completedSectionCount === 0 ? (
        <p className="text-sm text-muted-foreground py-2">
          {isToday
            ? t("medications.noIntakesDueToday")
            : isFuture
              ? t("medications.noIntakesPlannedForDate")
              : t("medications.noIntakesForDate")}
        </p>
      ) : (
        <div className="max-w-xl">
          {pendingSlots.map(({ time, events: slotEvents }) => (
            <div
              key={time}
              className="rounded-lg bg-card p-2 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="text-xs font-medium text-muted-foreground tabular-nums flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {time}
                </span>
                {actionable && slotEvents.length > 1 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-6 text-xs gap-1"
                    disabled={markTaken.isPending}
                    onClick={async () => {
                      for (const e of slotEvents) await handleTaken(e);
                      scheduleMoveToCompleted();
                    }}
                  >
                    {markTaken.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    {t("medications.confirmAll")}
                  </Button>
                )}
              </div>
              <ul className="space-y-1">
                {slotEvents.map((e) => {
                  const justCompleted = recentlyCompletedIds.has(e.id);
                  const isOverdue = overdueIds.has(e.id);
                  const statusLabel =
                    e.status === "taken"
                      ? t("medications.taken")
                      : e.status === "skipped"
                        ? t("medications.skipped")
                        : null;
                  const intakeAdvice = getIntakeAdviceLabel(e.regimen, t);
                  const unit = (e.regimen?.intake_unit ?? getPlannedIntakeUnit(e.planned_intake)) as MedicationUnit;
                  const UnitIcon = getUnitIcon(unit);
                  const { Icon: StatusIcon, className: statusIconClass } = getStatusIcon(e.status);
                  const isTaken = e.status === "taken";
                  return (
                    <li
                      key={e.id}
                      className={`flex items-center justify-between gap-2 py-1.5 px-2 rounded ${isOverdue ? "bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40" : isTaken && justCompleted ? "bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50" : justCompleted ? "bg-muted/30" : "bg-muted/50"}`}
                    >
                      <UnitIcon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/health/medications/${e.regimen_id}`}
                          className="text-sm font-medium truncate block hover:underline"
                        >
                          {e.regimen?.custom_name ?? e.regimen_id}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {isOverdue && (
                            <span className="text-amber-600 dark:text-amber-400 font-medium mr-1">
                              {t("medications.overdue")} ·{" "}
                            </span>
                          )}
                          {justCompleted && statusLabel
                            ? statusLabel +
                              (e.status === "taken"
                                ? ` — ${formatAmountWithUnit(
                                    getPlannedIntakeAmount(e.planned_intake),
                                    getPlannedIntakeUnit(e.planned_intake) as MedicationUnit,
                                    t
                                  )}`
                                : "")
                            : formatAmountWithUnit(
                                getPlannedIntakeAmount(e.planned_intake),
                                getPlannedIntakeUnit(e.planned_intake) as MedicationUnit,
                                t
                              )}
                          {intakeAdvice != null && ` · ${intakeAdvice}`}
                        </span>
                      </div>
                      {actionable && !justCompleted && (
                        <div className="flex gap-1 shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                            disabled={markSkipped.isPending}
                            onClick={() => handleSkipped(e)}
                            title={t("medications.skipped")}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 gap-1 px-2"
                            disabled={markTaken.isPending}
                            onClick={() => handleTaken(e)}
                          >
                            {markTaken.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            {t("medications.taken")}
                          </Button>
                        </div>
                      )}
                      {justCompleted && (
                        <StatusIcon className={statusIconClass} aria-hidden />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {completedSectionCount > 0 && (
            <div className="border rounded-lg overflow-hidden mt-4">
              {showCompletedExpanded ? (
                <div className="border-t bg-muted/30">
                  <div className="px-3 py-2 text-sm font-medium text-muted-foreground">
                    {isPast ? t("medications.completedOnDate", { date: displayDateLabel }) : t("medications.completedToday")} ({completedSectionCount})
                  </div>
                  <div className="max-h-96 overflow-y-auto">
                    {completedSectionSlots.map(({ time, events: slotEvents }) => (
                      <div key={time} className="border-b last:border-b-0">
                        <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground tabular-nums flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {time}
                        </div>
                        <ul className="divide-y divide-border/50">
                          {slotEvents.map((e) => {
                            const isResolved = e.status === "taken" || e.status === "skipped";
                            const isUnspecified = !isResolved;
                            const oneOff = isOneOffEvent(e);
                            const statusLabel =
                              e.status === "taken"
                                ? t("medications.taken")
                                : e.status === "skipped"
                                  ? t("medications.skipped")
                                  : t("medications.unspecified");
                            const intakeAdvice = getIntakeAdviceLabel(e.regimen, t);
                            const pending =
                              undoIntake.isPending || markTaken.isPending || markSkipped.isPending || updateResolutionDetails.isPending || deleteRegimen.isPending;
                            const unit = (e.regimen?.intake_unit ?? getPlannedIntakeUnit(e.planned_intake)) as MedicationUnit;
                            const UnitIcon = getUnitIcon(unit);
                            const { Icon: StatusIcon, className: statusIconClass } = getStatusIcon(e.status);
                            const isTaken = e.status === "taken";
                            return (
                              <li
                                key={e.id}
                                className={`flex items-center justify-between gap-2 py-1.5 px-3 min-w-0 ${isTaken ? "bg-green-50 dark:bg-green-950/30" : ""}`}
                              >
                                <UnitIcon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                                <div className="min-w-0 flex-1">
                                  <Link
                                    href={`/health/medications/${e.regimen_id}`}
                                    className="text-sm font-medium truncate block hover:underline"
                                  >
                                    {e.regimen?.custom_name ?? e.regimen_id}
                                  </Link>
                                  <span className="text-xs text-muted-foreground">
                                    {statusLabel}
                                    {e.status === "taken" &&
                                      ` — ${formatAmountWithUnit(
                                        getPlannedIntakeAmount(e.planned_intake),
                                        getPlannedIntakeUnit(e.planned_intake) as MedicationUnit,
                                        t
                                      )}`}
                                    {intakeAdvice != null && ` · ${intakeAdvice}`}
                                  </span>
                                </div>
                                <StatusIcon className={statusIconClass} aria-hidden />
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={pending}>
                                      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {oneOff ? (
                                      <>
                                        <DropdownMenuItem onClick={() => setEditIntakeEvent(e)}>
                                          <Pencil className="h-4 w-4 mr-2" />
                                          {t("medications.editIntake")}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                          onClick={() => setRemoveConfirmEvent(e)}
                                          className="text-destructive focus:text-destructive"
                                        >
                                          <Trash2 className="h-4 w-4 mr-2" />
                                          {t("medications.removeOneTime")}
                                        </DropdownMenuItem>
                                      </>
                                    ) : (
                                      <>
                                        {isResolved && (
                                          <>
                                            <DropdownMenuItem onClick={() => undoIntake.mutate({ doseEventId: e.id })}>
                                              <RotateCcw className="h-4 w-4 mr-2" />
                                              {t("medications.undoIntake")}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => setEditIntakeEvent(e)}>
                                              <Pencil className="h-4 w-4 mr-2" />
                                              {t("medications.editIntake")}
                                            </DropdownMenuItem>
                                            {e.status === "skipped" && (
                                              <DropdownMenuItem onClick={() => markTaken.mutate({ doseEventId: e.id })}>
                                                <Check className="h-4 w-4 mr-2" />
                                                {t("medications.markAsTaken")}
                                              </DropdownMenuItem>
                                            )}
                                            {e.status === "taken" && (
                                              <DropdownMenuItem onClick={() => markSkipped.mutate({ doseEventId: e.id })}>
                                                <Minus className="h-4 w-4 mr-2" />
                                                {t("medications.markAsSkipped")}
                                              </DropdownMenuItem>
                                            )}
                                          </>
                                        )}
                                        {isUnspecified && (
                                          <>
                                            <DropdownMenuItem onClick={() => markTaken.mutate({ doseEventId: e.id })}>
                                              <Check className="h-4 w-4 mr-2" />
                                              {t("medications.markAsTaken")}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onClick={() => markSkipped.mutate({ doseEventId: e.id })}>
                                              <Minus className="h-4 w-4 mr-2" />
                                              {t("medications.markAsSkipped")}
                                            </DropdownMenuItem>
                                          </>
                                        )}
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-between gap-2 py-2 px-3 text-left text-sm font-medium h-auto hover:bg-muted/50"
                    onClick={() => setResolvedOpen((o) => !o)}
                  >
                    <span className="text-muted-foreground">
                      {t("medications.completedToday")} ({completedSectionCount})
                    </span>
                    {resolvedOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                  </Button>
                  {resolvedOpen && (
                <div className="border-t bg-muted/30 max-h-64 overflow-y-auto">
                  {completedSectionSlots.map(({ time, events: slotEvents }) => (
                    <div key={time} className="border-b last:border-b-0">
                      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground tabular-nums flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {time}
                      </div>
                      <ul className="divide-y divide-border/50">
                        {slotEvents.map((e) => {
                          const isResolved = e.status === "taken" || e.status === "skipped";
                          const isUnspecified = !isResolved;
                          const oneOff = isOneOffEvent(e);
                          const statusLabel =
                            e.status === "taken"
                              ? t("medications.taken")
                              : e.status === "skipped"
                                ? t("medications.skipped")
                                : t("medications.unspecified");
                          const intakeAdvice = getIntakeAdviceLabel(e.regimen, t);
                          const pending =
                            undoIntake.isPending || markTaken.isPending || markSkipped.isPending || updateResolutionDetails.isPending || deleteRegimen.isPending;
                          const unit = (e.regimen?.intake_unit ?? getPlannedIntakeUnit(e.planned_intake)) as MedicationUnit;
                          const UnitIcon = getUnitIcon(unit);
                          const { Icon: StatusIcon, className: statusIconClass } = getStatusIcon(e.status);
                          const isTaken = e.status === "taken";
                          return (
                            <li
                              key={e.id}
                              className={`flex items-center justify-between gap-2 py-1.5 px-3 min-w-0 ${isTaken ? "bg-green-50 dark:bg-green-950/30" : ""}`}
                            >
                              <UnitIcon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                              <div className="min-w-0 flex-1">
                                <Link
                                  href={`/health/medications/${e.regimen_id}`}
                                  className="text-sm font-medium truncate block hover:underline"
                                >
                                  {e.regimen?.custom_name ?? e.regimen_id}
                                </Link>
                                <span className="text-xs text-muted-foreground">
                                  {statusLabel}
                                  {e.status === "taken" &&
                                    ` — ${formatAmountWithUnit(
                                      getPlannedIntakeAmount(e.planned_intake),
                                      getPlannedIntakeUnit(e.planned_intake) as MedicationUnit,
                                      t
                                    )}`}
                                  {intakeAdvice != null && ` · ${intakeAdvice}`}
                                </span>
                              </div>
                              <StatusIcon className={statusIconClass} aria-hidden />
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={pending}>
                                    {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreVertical className="h-4 w-4" />}
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {oneOff ? (
                                    <>
                                      <DropdownMenuItem onClick={() => setEditIntakeEvent(e)}>
                                        <Pencil className="h-4 w-4 mr-2" />
                                        {t("medications.editIntake")}
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => setRemoveConfirmEvent(e)}
                                        className="text-destructive focus:text-destructive"
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        {t("medications.removeOneTime")}
                                      </DropdownMenuItem>
                                    </>
                                  ) : (
                                    <>
                                      {isResolved && (
                                        <>
                                          <DropdownMenuItem onClick={() => undoIntake.mutate({ doseEventId: e.id })}>
                                            <RotateCcw className="h-4 w-4 mr-2" />
                                            {t("medications.undoIntake")}
                                          </DropdownMenuItem>
                                          <DropdownMenuItem onClick={() => setEditIntakeEvent(e)}>
                                            <Pencil className="h-4 w-4 mr-2" />
                                            {t("medications.editIntake")}
                                          </DropdownMenuItem>
                                          {e.status === "skipped" && (
                                            <DropdownMenuItem onClick={() => markTaken.mutate({ doseEventId: e.id })}>
                                              <Check className="h-4 w-4 mr-2" />
                                              {t("medications.markAsTaken")}
                                            </DropdownMenuItem>
                                          )}
                                          {e.status === "taken" && (
                                            <DropdownMenuItem onClick={() => markSkipped.mutate({ doseEventId: e.id })}>
                                              <Minus className="h-4 w-4 mr-2" />
                                              {t("medications.markAsSkipped")}
                                            </DropdownMenuItem>
                                          )}
                                        </>
                                      )}
                                      {isUnspecified && (
                                        <>
                                          <DropdownMenuItem onClick={() => markTaken.mutate({ doseEventId: e.id })}>
                                            <Check className="h-4 w-4 mr-2" />
                                            {t("medications.markAsTaken")}
                                          </DropdownMenuItem>
                                          <DropdownMenuItem onClick={() => markSkipped.mutate({ doseEventId: e.id })}>
                                            <Minus className="h-4 w-4 mr-2" />
                                            {t("medications.markAsSkipped")}
                                          </DropdownMenuItem>
                                        </>
                                      )}
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
            )}
            </div>
          )}

          <EditIntakeDialog
            open={!!editIntakeEvent}
            onOpenChange={(open) => !open && setEditIntakeEvent(null)}
            event={editIntakeEvent}
            isPending={updateResolutionDetails.isPending}
            onSubmit={async (params) => {
              if (!editIntakeEvent) return;
              await updateResolutionDetails.mutateAsync({
                doseEventId: editIntakeEvent.id,
                takenAt: params.takenAt,
                amountTaken: params.amountTaken,
                note: params.note ?? null,
              });
              setEditIntakeEvent(null);
            }}
          />

          <AlertDialog
            open={!!removeConfirmEvent}
            onOpenChange={(open) => !open && setRemoveConfirmEvent(null)}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("medications.removeOneTime")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("medications.removeOneTimeConfirm")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    if (!removeConfirmEvent) return;
                    await deleteRegimen.mutateAsync({
                      id: removeConfirmEvent.regimen_id,
                      personId: removeConfirmEvent.person_id,
                    });
                    setRemoveConfirmEvent(null);
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleteRegimen.isPending}
                >
                  {deleteRegimen.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {t("medications.removeOneTime")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </div>
  );
}
