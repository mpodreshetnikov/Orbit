"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useIntlLocale } from "@/lib/date-locale";
import { cn } from "@/lib/utils";
import type { MedRegimen, MedSchedule } from "@/types/regimen";
import { formatAmountWithUnit, getUnitIcon } from "./medication-units";

const DAY_SUFFIX = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function formatRegimenScheduleSummary(
  regimen: MedRegimen,
  t: (key: string) => string,
  intlLocale: string
): string | null {
  const schedule = regimen.schedule as MedSchedule | null;
  if (!schedule) return null;
  const mode = schedule.mode;
  if (mode === "one_off") {
    const due = (schedule as { due_at?: string }).due_at;
    if (due) return new Date(due).toLocaleString(intlLocale, { dateStyle: "medium", timeStyle: "short" });
    return null;
  }
  if (mode === "daily_times") {
    const times = (schedule as { times?: string[] }).times;
    if (times?.length) return `${t("medications.frequencyDaily")} ${t("medications.scheduleAt")} ${times.join(", ")}`;
  }
  if (mode === "interval_hours") {
    const every = (schedule as { interval?: { every?: number } }).interval?.every;
    if (every != null) return `${t("medications.every")} ${every} ${t("medications.hours")}`;
  }
  if (mode === "interval_days") {
    const every = (schedule as { interval?: { every?: number }; time_of_day?: string }).interval?.every;
    const timeOfDay = (schedule as { time_of_day?: string }).time_of_day ?? "09:00";
    if (every != null) return `${t("medications.every")} ${every} ${t("medications.days")} ${t("medications.scheduleAt")} ${timeOfDay}`;
  }
  if (mode === "days_of_week") {
    const days = (schedule as { days_of_week?: number[] }).days_of_week;
    const times = (schedule as { times?: string[] }).times;
    if (days?.length) {
      const dayNames = days
        .sort((a, b) => a - b)
        .map((d) => t(`medications.day${DAY_SUFFIX[d === 7 ? 0 : d] ?? "Sun"}`))
        .join(", ");
      const timeStr = times?.length ? ` ${t("medications.scheduleAt")} ${times.join(", ")}` : "";
      return `${dayNames}${timeStr}`;
    }
  }
  return null;
}

interface RegimenCardProps {
  regimen: MedRegimen;
}

function StatusBadge({ status }: { status: MedRegimen["status"] }) {
  const t = useTranslations();
  const key = `medications.status${status.charAt(0).toUpperCase() + status.slice(1)}`;
  const config: Record<MedRegimen["status"], string> = {
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

export function RegimenCard({ regimen }: RegimenCardProps) {
  const t = useTranslations();
  const intlLocale = useIntlLocale();
  const inv = regimen.inventory;
  const isLowInventory =
    inv?.enabled &&
    inv.refill_threshold_amount != null &&
    inv.current_amount != null &&
    inv.current_amount <= inv.refill_threshold_amount;

  const scheduleSummary = formatRegimenScheduleSummary(regimen, t, intlLocale);

  return (
    <Link href={`/health/medications/${regimen.id}`}>
      <Card
        className={cn(
          "hover:shadow-md transition-shadow min-w-0 overflow-hidden w-full tap-target cursor-pointer",
          isLowInventory && "border-amber-400 dark:border-amber-600"
        )}
      >
        <CardContent className="p-3 sm:p-4 w-full">
          <div className="flex flex-col gap-2 sm:gap-3 w-full">
            <div className="flex items-start justify-between gap-2 min-w-0">
              <div className="min-w-0 flex-1">
                <h3 className="font-medium truncate">{regimen.custom_name}</h3>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <StatusBadge status={regimen.status} />
                  {isLowInventory && (
                    <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-700 dark:text-amber-400 gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {t("medications.lowInventory")}
                    </Badge>
                  )}
                </div>
              </div>
              {(() => {
                const UnitIcon = getUnitIcon(regimen.intake_unit);
                return <UnitIcon className="h-4 w-4 shrink-0 text-muted-foreground" />;
              })()}
            </div>
            {scheduleSummary && (
              <div className="text-xs text-muted-foreground line-clamp-2">
                {scheduleSummary}
              </div>
            )}
            <div className="min-h-5 text-xs text-muted-foreground">
              {inv?.enabled && inv.current_amount != null ? (
                <>
                  {formatAmountWithUnit(inv.current_amount, regimen.intake_unit, t)} {t("medications.stockLeft")}
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
