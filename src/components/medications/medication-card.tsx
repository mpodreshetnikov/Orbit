"use client";

import { useTranslations } from "next-intl";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDateFnsLocale } from "@/lib/date-locale";
import { cn } from "@/lib/utils";
import type { Medication, MedicationStatus } from "@/types";
import type { MedicationSchedule } from "@/types";
import { formatAmountWithUnit, getUnitIcon } from "./medication-units";

const DAY_SUFFIX = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function formatScheduleSummary(
  medication: Medication,
  t: (key: string) => string,
  dateLocale: Locale,
): string | null {
  if (medication.kind === "one_time") {
    if (medication.scheduled_at)
      return format(new Date(medication.scheduled_at), "PP", { locale: dateLocale });
    return null;
  }
  const schedule = medication.schedule as MedicationSchedule | null | undefined;
  if (!schedule?.reminder_times?.length) return null;
  const times = schedule.reminder_times.map((s) => s.time).join(", ");
  const freq = schedule.frequency;
  if (!freq) return times;
  if (freq.type === "daily")
    return `${t("medications.frequencyDaily")} ${t("medications.scheduleAt")} ${times}`;
  if (freq.type === "interval") {
    const every = freq.every ?? 1;
    const unit = freq.unit === "hour" ? t("medications.hours") : t("medications.days");
    return `${t("medications.every")} ${every} ${unit} ${t("medications.scheduleAt")} ${times}`;
  }
  if (freq.type === "days_of_week" && freq.days?.length) {
    const dayNames = freq.days
      .sort((a, b) => a - b)
      .map((d) => t(`medications.day${DAY_SUFFIX[d]}`))
      .join(", ");
    return `${dayNames} ${t("medications.scheduleAt")} ${times}`;
  }
  return times;
}

interface MedicationCardProps {
  medication: Medication;
}

function StatusBadge({ status }: { status: MedicationStatus }) {
  const t = useTranslations();
  const key = `medications.status${status.charAt(0).toUpperCase() + status.slice(1)}`;
  const config: Record<MedicationStatus, string> = {
    active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    paused: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    completed: "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20",
    archived: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
  };
  return (
    <Badge variant="outline" className={cn("text-xs", config[status])}>
      {t(key)}
    </Badge>
  );
}

export function MedicationCard({ medication }: MedicationCardProps) {
  const t = useTranslations();
  const dateLocale = useDateFnsLocale();
  const isLowInventory =
    medication.inventory_enabled &&
    medication.inventory_refill_threshold != null &&
    medication.inventory_current != null &&
    medication.inventory_current <= medication.inventory_refill_threshold;

  const scheduleSummary = formatScheduleSummary(medication, t, dateLocale);

  return (
    <Link href={`/health/medications/${medication.id}`}>
      <Card
        className={cn(
          "hover:shadow-md transition-shadow min-w-0 overflow-hidden w-full tap-target cursor-pointer",
          isLowInventory && "border-amber-400 dark:border-amber-600",
        )}
      >
        <CardContent className="p-3 sm:p-4 w-full">
          <div className="flex flex-col gap-2 sm:gap-3 w-full">
            <div className="flex items-start justify-between gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <h3 className="font-medium truncate">{medication.name}</h3>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <Badge variant="secondary" className="text-xs">
                    {medication.kind === "one_time"
                      ? t("medications.oneTime")
                      : t("medications.regular")}
                  </Badge>
                  <StatusBadge status={medication.status} />
                  {isLowInventory && (
                    <Badge
                      variant="outline"
                      className="text-xs border-amber-500/50 text-amber-700 dark:text-amber-400 gap-1"
                    >
                      <AlertTriangle className="h-3 w-3" />
                      {t("medications.lowInventory")}
                    </Badge>
                  )}
                </div>
              </div>
              {(() => {
                const UnitIcon = getUnitIcon(medication.unit);
                return <UnitIcon className="h-4 w-4 shrink-0 text-muted-foreground" />;
              })()}
            </div>
            {scheduleSummary && (
              <div className="text-xs text-muted-foreground line-clamp-2">{scheduleSummary}</div>
            )}
            <div className="min-h-5 text-xs text-muted-foreground">
              {medication.inventory_enabled && medication.inventory_current != null ? (
                <>
                  {formatAmountWithUnit(medication.inventory_current, medication.unit, t)}{" "}
                  {t("medications.stockLeft")}
                </>
              ) : (
                "\u00A0"
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
