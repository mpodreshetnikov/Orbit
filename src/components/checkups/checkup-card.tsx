"use client";

import { useTranslations } from "next-intl";
import { format } from "date-fns";
import Link from "next/link";
import { Calendar, CheckCircle2, CalendarPlus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CheckupItem, CheckupItemStatus, CheckupCategory } from "@/types";

interface CheckupCardProps {
  item: CheckupItem;
  onMarkComplete?: (item: CheckupItem) => void;
  onPlan?: (item: CheckupItem) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (item: CheckupItem) => void;
}

function StatusBadge({ status }: { status: CheckupItemStatus }) {
  const t = useTranslations();
  const key = `checkups.status${status.charAt(0).toUpperCase() + status.slice(1)}` as "checkups.statusActive" | "checkups.statusPaused" | "checkups.statusCompleted" | "checkups.statusArchived";
  const config: Record<CheckupItemStatus, string> = {
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

function CategoryLabel({ category }: { category: CheckupCategory }) {
  const t = useTranslations();
  const key = `checkups.category${category.charAt(0).toUpperCase() + category.slice(1)}` as "checkups.categoryLab" | "checkups.categoryImaging" | "checkups.categoryVisit" | "checkups.categoryVaccination" | "checkups.categoryDental" | "checkups.categoryOther";
  return <span className="text-xs text-muted-foreground">{t(key)}</span>;
}

export function CheckupCard({
  item,
  onMarkComplete,
  onPlan,
  selectionMode,
  selected,
  onToggleSelect,
}: CheckupCardProps) {
  const t = useTranslations();
  const isOverdue = item.next_due_at && item.status === "active" && item.next_due_at < new Date().toISOString().slice(0, 10);
  const canMarkComplete = item.status === "active";
  const canPlan = item.status === "active" && item.next_due_at;

  const cardContent = (
    <Card
      className={cn(
        "hover:shadow-md transition-shadow min-w-0 overflow-hidden w-full tap-target cursor-pointer",
        isOverdue && "border-amber-400 dark:border-amber-600"
      )}
    >
      <CardContent className="p-3 sm:p-4 w-full">
        <div className="flex flex-col gap-2 sm:gap-3 w-full">
          <div className="flex items-start gap-2 min-w-0">
            {selectionMode && onToggleSelect && (
              <div
                className="shrink-0 pt-0.5 flex items-center"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleSelect(item);
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelect(item)}
                  aria-label={t("checkups.selectToPlan")}
                  className="h-4 w-4 rounded border-input"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <CategoryLabel category={item.category} />
                <StatusBadge status={item.status} />
                {isOverdue && (
                  <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
                    {t("checkups.overdue")}
                  </Badge>
                )}
              </div>
              <span className="font-medium text-sm sm:text-base block truncate">
                {item.title}
              </span>
              {/* Fixed-height slot for 2 date lines so cards with/without planned_on match height */}
              <div className="mt-0.5 min-h-[2rem] sm:min-h-[2.5rem] flex flex-col gap-0.5">
                {item.next_due_at ? (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    {t("checkups.nextDue")}: {format(new Date(item.next_due_at), "dd MMM yyyy")}
                  </div>
                ) : (
                  <div className="h-4" aria-hidden />
                )}
                {item.planned_on ? (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <CalendarPlus className="h-3.5 w-3.5 shrink-0" />
                    {t("checkups.plannedOn")}: {format(new Date(item.planned_on), "dd MMM yyyy")}
                  </div>
                ) : (
                  <div className="h-4" aria-hidden />
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-1 flex-wrap">
            {canMarkComplete && onMarkComplete && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 sm:h-8 gap-1 min-w-0"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onMarkComplete(item);
                }}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("checkups.markComplete")}</span>
              </Button>
            )}
            {canPlan && onPlan && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 sm:h-8 gap-1 min-w-0"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onPlan(item);
                }}
              >
                <CalendarPlus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("checkups.plan")}</span>
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <Link href={`/health/checkups/${item.id}`} className="block min-w-0">
      {cardContent}
    </Link>
  );
}
