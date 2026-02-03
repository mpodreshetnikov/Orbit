"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { useDateFnsLocale } from "@/lib/date-locale";
import Link from "next/link";
import {
  ArrowLeft,
  MoreVertical,
  Pencil,
  AlertTriangle,
  Clock,
  Loader2,
  PackagePlus,
  RotateCcw,
  Check,
  CheckCircle,
  Minus,
  X,
  Ban,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RefillDialog, EditIntakeDialog } from "@/components/medications";
import {
  useRegimen,
  useDoseEventsForRegimen,
  useUpdateRegimenInventory,
  useDeleteRegimen,
  useArchiveRegimen,
  useUndoDoseIntake,
  useMarkDoseTaken,
  useMarkDoseSkipped,
  useUpdateDoseEventResolutionDetails,
} from "@/hooks";
import { formatAmountWithUnit, getUnitIcon } from "@/components/medications/medication-units";
import type { MedDoseEvent, MedDoseEventStatus } from "@/types/regimen";
import { getPlannedIntakeAmount, getPlannedIntakeUnit } from "@/types/regimen";
import type { MedicationUnit } from "@/types";

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

export default function MedicationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations();
  const dateLocale = useDateFnsLocale();
  const id = params.id as string;

  const { data: regimen, isLoading, error } = useRegimen(id);
  const { data: doseEvents } = useDoseEventsForRegimen(id);
  const updateInventory = useUpdateRegimenInventory();
  const deleteMutation = useDeleteRegimen();
  const archiveMutation = useArchiveRegimen();
  const undoIntake = useUndoDoseIntake();
  const markTaken = useMarkDoseTaken();
  const markSkipped = useMarkDoseSkipped();
  const updateResolutionDetails = useUpdateDoseEventResolutionDetails();
  const [refillOpen, setRefillOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editIntakeEvent, setEditIntakeEvent] = useState<MedDoseEvent | null>(null);

  const inv = regimen?.inventory;
  const isLowInventory =
    regimen &&
    inv?.enabled &&
    inv.refill_threshold_amount != null &&
    inv.current_amount != null &&
    inv.current_amount <= inv.refill_threshold_amount;

  const handleDelete = async () => {
    if (!regimen) return;
    await deleteMutation.mutateAsync({ id: regimen.id, personId: regimen.person_id });
    setDeleteConfirmOpen(false);
    router.push("/health/medications");
  };

  const handleArchive = async () => {
    if (!regimen) return;
    await archiveMutation.mutateAsync({ id: regimen.id, personId: regimen.person_id });
    setArchiveConfirmOpen(false);
    router.push("/health/medications");
  };

  const handleRefill = async (amount: number) => {
    if (!regimen) return;
    await updateInventory.mutateAsync({
      regimenId: regimen.id,
      type: amount > 0 ? "refill" : "correction",
      amount,
    });
  };

  if (isLoading || !regimen) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <p>{t("common.error")}</p>
      </div>
    );
  }

  const schedule = regimen.schedule as {
    mode?: string;
    times?: string[];
    time_of_day?: string;
    amounts?: number[];
  };
  const defaultAmount = getPlannedIntakeAmount(regimen.dose_definition);
  const nextReminders =
    schedule?.mode === "daily_times" && schedule.times?.length
      ? schedule.times.map((time, i) => ({
          time,
          amount: schedule.amounts != null && schedule.amounts[i] != null
            ? Math.max(1, schedule.amounts[i])
            : defaultAmount,
        }))
      : schedule?.mode === "interval_days" && schedule.time_of_day
        ? [{ time: schedule.time_of_day, amount: defaultAmount }]
        : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
            <Link href="/health/medications">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <h1 className="text-xl font-semibold truncate min-w-0">{regimen.custom_name}</h1>
        </div>
        <div className="flex gap-2 flex-wrap shrink-0">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/health/medications/${regimen.id}/edit`}>
              <Pencil className="h-4 w-4 mr-1" />
              {t("common.edit")}
            </Link>
          </Button>
          {inv?.enabled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRefillOpen(true)}
            >
              <PackagePlus className="h-4 w-4 mr-1" />
              {t("medications.refillButton")}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">
              {t(`medications.status${regimen.status.charAt(0).toUpperCase() + regimen.status.slice(1)}`)}
            </Badge>
            {isLowInventory && (
              <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-400 gap-1">
                <AlertTriangle className="h-3 w-3" />
                {t("medications.refillWarning")}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {schedule?.mode === "one_off" && (schedule as { due_at?: string }).due_at && (
            <div className="flex items-center gap-1.5 text-sm">
              <Clock className="h-4 w-4 text-muted-foreground" />
              {format(new Date((schedule as { due_at: string }).due_at), "PPp", { locale: dateLocale })}
            </div>
          )}
          {nextReminders.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-2">{t("medications.nextReminders")}</h3>
              <ul className="text-sm text-muted-foreground space-y-1">
                {nextReminders.map((r, i) => (
                  <li key={i}>
                    {r.time} — {formatAmountWithUnit(r.amount, regimen.intake_unit, t)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {inv?.enabled && (
            <div className="text-sm text-muted-foreground">
              {t("medications.inventoryCurrent")}:{" "}
              {inv.current_amount != null
                ? formatAmountWithUnit(inv.current_amount, regimen.intake_unit, t)
                : "—"}
              {inv.refill_threshold_amount != null &&
                ` (${t("medications.refillWarning")} ≤ ${formatAmountWithUnit(inv.refill_threshold_amount, regimen.intake_unit, t)})`}
            </div>
          )}
          {regimen.notes && (
            <p className="text-sm text-muted-foreground">{regimen.notes}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("medications.intakeHistory")}</CardTitle>
        </CardHeader>
        <CardContent>
          {!doseEvents || doseEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("medications.noIntakes")}</p>
          ) : (
            <ul className="space-y-2">
              {doseEvents.map((ev) => {
                const isTaken = ev.status === "taken";
                const isSkipped = ev.status === "skipped";
                const isMissed = ev.status === "missed";
                const isUnspecified =
                  ev.status === "scheduled" || ev.status === "sent" || ev.status === "snoozed";
                const canEdit = isTaken || isSkipped || isMissed || isUnspecified;
                const isEditing = editingEventId === ev.id;
                const pending =
                  isEditing &&
                  (undoIntake.isPending || markTaken.isPending || markSkipped.isPending || updateResolutionDetails.isPending);
                const unit = (regimen?.intake_unit ?? getPlannedIntakeUnit(ev.planned_intake)) as MedicationUnit;
                const UnitIcon = getUnitIcon(unit);
                const { Icon: StatusIcon, className: statusIconClass } = getStatusIcon(ev.status);
                return (
                  <li
                    key={ev.id}
                    className={`flex items-center gap-2 text-sm py-2 border-b last:border-0 ${isTaken ? "bg-green-50 dark:bg-green-950/30 rounded px-2 -mx-2" : ""}`}
                  >
                    <UnitIcon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1">
                      {ev.taken_at
                        ? format(new Date(ev.taken_at), "PPp", { locale: dateLocale })
                        : format(new Date(ev.actual_at), "PPp", { locale: dateLocale })}
                      {ev.status === "skipped" ? (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          {t("medications.skipped")}
                        </Badge>
                      ) : ev.status === "missed" ? (
                        <Badge variant="outline" className="ml-2 text-xs text-muted-foreground">
                          {t("medications.missed")}
                        </Badge>
                      ) : isUnspecified ? (
                        <>
                          <Badge variant="outline" className="ml-2 text-xs text-muted-foreground">
                            {t("medications.unspecified")}
                          </Badge>
                          <> — {formatAmountWithUnit(getPlannedIntakeAmount(ev.planned_intake), getPlannedIntakeUnit(ev.planned_intake) as MedicationUnit, t)}</>
                        </>
                      ) : (
                        <> — {formatAmountWithUnit(getPlannedIntakeAmount(ev.planned_intake), getPlannedIntakeUnit(ev.planned_intake) as MedicationUnit, t)}</>
                      )}
                      {ev.note && (
                        <span className="text-muted-foreground block truncate max-w-[200px] mt-0.5">
                          {ev.note}
                        </span>
                      )}
                    </span>
                    <StatusIcon className={statusIconClass} aria-hidden />
                    {canEdit && (
                      <DropdownMenu
                        onOpenChange={(open) => {
                          if (!open) setEditingEventId(null);
                        }}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            disabled={pending}
                            onClick={() => setEditingEventId(ev.id)}
                          >
                            {pending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <MoreVertical className="h-4 w-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              undoIntake.mutate(
                                { doseEventId: ev.id },
                                { onSettled: () => setEditingEventId(null) }
                              );
                            }}
                          >
                            <RotateCcw className="h-4 w-4 mr-2" />
                            {t("medications.undoIntake")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => { setEditIntakeEvent(ev); setEditingEventId(null); }}>
                            <Pencil className="h-4 w-4 mr-2" />
                            {t("medications.editIntake")}
                          </DropdownMenuItem>
                          {isSkipped && (
                            <DropdownMenuItem
                              onClick={() => {
                                markTaken.mutate(
                                  { doseEventId: ev.id },
                                  { onSettled: () => setEditingEventId(null) }
                                );
                              }}
                            >
                              <Check className="h-4 w-4 mr-2" />
                              {t("medications.markAsTaken")}
                            </DropdownMenuItem>
                          )}
                          {isTaken && (
                            <DropdownMenuItem
                              onClick={() => {
                                markSkipped.mutate(
                                  { doseEventId: ev.id },
                                  { onSettled: () => setEditingEventId(null) }
                                );
                              }}
                            >
                              <Minus className="h-4 w-4 mr-2" />
                              {t("medications.markAsSkipped")}
                            </DropdownMenuItem>
                          )}
                          {isUnspecified && (
                            <>
                              <DropdownMenuItem
                                onClick={() => {
                                  markTaken.mutate(
                                    { doseEventId: ev.id },
                                    { onSettled: () => setEditingEventId(null) }
                                  );
                                }}
                              >
                                <Check className="h-4 w-4 mr-2" />
                                {t("medications.markAsTaken")}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  markSkipped.mutate(
                                    { doseEventId: ev.id },
                                    { onSettled: () => setEditingEventId(null) }
                                  );
                                }}
                              >
                                <Minus className="h-4 w-4 mr-2" />
                                {t("medications.markAsSkipped")}
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 flex-wrap">
        {regimen.status !== "archived" && (
          <Button
            variant="ghost"
            onClick={() => setArchiveConfirmOpen(true)}
            disabled={archiveMutation.isPending}
          >
            {archiveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t("medications.archiveMedication")}
          </Button>
        )}
        <Button
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => setDeleteConfirmOpen(true)}
        >
          {t("medications.deleteMedication")}
        </Button>
      </div>

      <RefillDialog
        open={refillOpen}
        onOpenChange={setRefillOpen}
        regimen={regimen}
        onSubmit={handleRefill}
      />

      <EditIntakeDialog
        open={!!editIntakeEvent}
        onOpenChange={(open) => !open && setEditIntakeEvent(null)}
        event={editIntakeEvent ? { ...editIntakeEvent, regimen: regimen ? { custom_name: regimen.custom_name, intake_unit: regimen.intake_unit } : null } : null}
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

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("medications.deleteMedication")}</DialogTitle>
            <DialogDescription>{t("medications.deleteMedicationConfirm")}</DialogDescription>
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
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("medications.archiveMedication")}</DialogTitle>
            <DialogDescription>{t("medications.archiveMedicationConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleArchive}
              disabled={archiveMutation.isPending}
            >
              {archiveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("medications.archiveMedication")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
