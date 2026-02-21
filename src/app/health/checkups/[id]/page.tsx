"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import type { Locale } from "date-fns";
import { useDateFnsLocale } from "@/lib/date-locale";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  CalendarCheck,
  Calendar,
  CalendarPlus,
  Pencil,
  Pause,
  Play,
  Archive,
  CheckCircle2,
  Loader2,
  FileText,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MarkCompleteDialog, EditCompletionDialog, PlanDialog } from "@/components/checkups";
import {
  useCheckupItem,
  useCheckupCompletions,
  useUpdateCheckupItem,
  useDeleteCheckupItem,
  useMedicalRecords,
} from "@/hooks";
import { cn } from "@/lib/utils";
import type { CheckupItemStatus, CheckupSchedule, CheckupCompletion } from "@/types";
import { isCheckupScheduleInterval, isCheckupScheduleOneOff } from "@/types";

function StatusBadge({ status }: { status: CheckupItemStatus }) {
  const t = useTranslations();
  const key = `checkups.status${status.charAt(0).toUpperCase() + status.slice(1)}` as
    | "checkups.statusActive"
    | "checkups.statusPaused"
    | "checkups.statusCompleted"
    | "checkups.statusArchived";
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

function ScheduleSummary({
  schedule,
  dateLocale,
}: {
  schedule: CheckupSchedule;
  dateLocale: Locale;
}) {
  const t = useTranslations();
  if (isCheckupScheduleOneOff(schedule)) {
    return (
      <span>
        {t("checkups.oneOff")}:{" "}
        {format(new Date(schedule.due_at), "dd MMM yyyy", { locale: dateLocale })}
      </span>
    );
  }
  if (isCheckupScheduleInterval(schedule)) {
    const unitKey =
      schedule.unit === "week" ? "unitWeek" : schedule.unit === "month" ? "unitMonth" : "unitYear";
    const count = schedule.every;
    return (
      <span>
        {t("checkups.everyWithCount", { count })}{" "}
        {t(`checkups.${unitKey}` as "checkups.unitMonth", { count })}
      </span>
    );
  }
  return null;
}

export default function CheckupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const t = useTranslations();
  const dateLocale = useDateFnsLocale();

  const { data: item, isLoading, error, refetch } = useCheckupItem(id);
  const { data: completions } = useCheckupCompletions(id);
  const updateMutation = useUpdateCheckupItem();
  const deleteMutation = useDeleteCheckupItem();
  const [markCompleteOpen, setMarkCompleteOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [editCompletion, setEditCompletion] = useState<CheckupCompletion | null>(null);
  const [editCompletionOpen, setEditCompletionOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const { data: records } = useMedicalRecords(item?.person_id ? { person_id: item.person_id } : {});

  const canMarkComplete = item?.status === "active";
  const canPlan = item?.status === "active" && item?.next_due_at;
  const isOverdue =
    item?.next_due_at &&
    item.status === "active" &&
    item.next_due_at < new Date().toISOString().slice(0, 10);

  const handlePause = async () => {
    if (!item) return;
    await updateMutation.mutateAsync({ id: item.id, updates: { status: "paused" } });
    refetch();
  };

  const handleResume = async () => {
    if (!item) return;
    await updateMutation.mutateAsync({ id: item.id, updates: { status: "active" } });
    refetch();
  };

  const handleArchive = async () => {
    if (!item) return;
    await updateMutation.mutateAsync({ id: item.id, updates: { status: "archived" } });
    refetch();
  };

  const handleDelete = async () => {
    if (!item) return;
    await deleteMutation.mutateAsync({ id: item.id, personId: item.person_id });
    setDeleteConfirmOpen(false);
    router.push("/health/checkups");
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !item) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/health/checkups">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("common.back")}
          </Link>
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center text-destructive">
          <CalendarCheck className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p>{t("common.error")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2 min-w-0">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/health/checkups">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <StatusBadge status={item.status} />
              {isOverdue && (
                <Badge
                  variant="outline"
                  className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400"
                >
                  {t("checkups.overdue")}
                </Badge>
              )}
            </div>
            <h1 className="text-xl font-bold tracking-tight truncate">{item.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t(
                `checkups.category${item.category.charAt(0).toUpperCase() + item.category.slice(1)}`,
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {canMarkComplete && (
            <Button size="sm" className="gap-1.5" onClick={() => setMarkCompleteOpen(true)}>
              <CheckCircle2 className="h-4 w-4" />
              {t("checkups.markComplete")}
            </Button>
          )}
          {canPlan && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setPlanOpen(true)}
            >
              <CalendarPlus className="h-4 w-4" />
              {t("checkups.plan")}
            </Button>
          )}
          {item.status === "paused" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleResume}
              disabled={updateMutation.isPending}
            >
              <Play className="h-4 w-4 mr-1" />
              {t("checkups.resume")}
            </Button>
          )}
          {item.status === "active" && (
            <Button
              size="sm"
              variant="outline"
              onClick={handlePause}
              disabled={updateMutation.isPending}
            >
              <Pause className="h-4 w-4 mr-1" />
              {t("checkups.pause")}
            </Button>
          )}
          {(item.status === "active" || item.status === "paused") && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleArchive}
              disabled={updateMutation.isPending}
            >
              <Archive className="h-4 w-4 mr-1" />
              {t("checkups.archive")}
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link href={`/health/checkups/${item.id}/edit`}>
              <Pencil className="h-4 w-4 mr-1" />
              {t("common.edit")}
            </Link>
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t("checkups.deleteCheckup")}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("checkups.schedule")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <ScheduleSummary schedule={item.schedule} dateLocale={dateLocale} />
          </div>
          {item.next_due_at && (
            <div className="text-sm text-muted-foreground">
              {t("checkups.nextDue")}:{" "}
              {format(new Date(item.next_due_at), "dd MMM yyyy", { locale: dateLocale })}
            </div>
          )}
          {item.planned_on && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                {t("checkups.plannedOn")}:{" "}
                {format(new Date(item.planned_on), "dd MMM yyyy", { locale: dateLocale })}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                disabled={updateMutation.isPending}
                onClick={async () => {
                  await updateMutation.mutateAsync({ id: item.id, updates: { planned_on: null } });
                  refetch();
                }}
              >
                {updateMutation.isPending && <Loader2 className="h-3 w-3 animate-spin shrink-0" />}
                {t("checkups.removePlannedDate")}
              </Button>
            </div>
          )}
          {(item.reminder_days_before?.length ?? 0) > 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bell className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                {t("checkups.reminderDaysBeforeLabel")}:{" "}
                {[...(item.reminder_days_before ?? [])]
                  .filter((d) => typeof d === "number" && d >= 0)
                  .sort((a, b) => b - a)
                  .join(", ")}{" "}
                {t("checkups.reminderDaysBeforeSuffix")}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bell className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t("checkups.reminderDayOfOnly")}</span>
            </div>
          )}
          {item.why_text && (
            <>
              <Separator />
              <div>
                <span className="text-xs text-muted-foreground block mb-1">
                  {t("checkups.why")}
                </span>
                <p className="text-sm whitespace-pre-wrap">{item.why_text}</p>
              </div>
            </>
          )}
          {item.why_links && item.why_links.length > 0 && (
            <>
              <Separator />
              <div>
                <span className="text-xs text-muted-foreground block mb-1">
                  {t("checkups.linkedConditions")}
                </span>
                <div className="flex flex-wrap gap-1">
                  {item.why_links.map((l) => (
                    <Link key={l.id} href={`/health/conditions/${l.id}`}>
                      <Badge variant="secondary" className="text-xs hover:underline">
                        {l.label ?? l.id}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </div>
            </>
          )}
          {item.notes && (
            <>
              <Separator />
              <div>
                <span className="text-xs text-muted-foreground block mb-1">
                  {t("checkups.notes")}
                </span>
                <p className="text-sm whitespace-pre-wrap">{item.notes}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            {t("checkups.completionHistory")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {completions && completions.length > 0 ? (
            <div className="space-y-3">
              {completions.map((c) => (
                <div
                  key={c.id}
                  className="flex items-start justify-between gap-2 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {format(new Date(c.done_at), "dd MMM yyyy", { locale: dateLocale })}
                    </div>
                    {c.note && (
                      <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                        {c.note}
                      </p>
                    )}
                    {c.evidence_record_id && (
                      <Link
                        href={`/health/records/${c.evidence_record_id}`}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1"
                      >
                        <FileText className="h-3 w-3" />
                        {t("checkups.evidence")}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => {
                      setEditCompletion(c);
                      setEditCompletionOpen(true);
                    }}
                    aria-label={t("common.edit")}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              {t("checkups.noCompletions")}
            </p>
          )}
        </CardContent>
      </Card>

      <MarkCompleteDialog
        open={markCompleteOpen}
        onOpenChange={setMarkCompleteOpen}
        item={item}
        records={records ?? []}
        onSaved={() => refetch()}
      />

      <EditCompletionDialog
        open={editCompletionOpen}
        onOpenChange={(open) => {
          setEditCompletionOpen(open);
          if (!open) setEditCompletion(null);
        }}
        completion={editCompletion}
        records={records ?? []}
        onSaved={() => refetch()}
      />

      <PlanDialog
        open={planOpen}
        onOpenChange={setPlanOpen}
        items={item ? [item] : []}
        onSaved={() => refetch()}
      />

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("checkups.deleteCheckup")}</DialogTitle>
            <DialogDescription>{t("checkups.deleteCheckupConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t("checkups.deleteCheckup")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
