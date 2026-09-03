"use client";

import React from "react";
import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { useDateFnsLocale } from "@/lib/date-locale";
import Link from "next/link";
import {
  ArrowLeft,
  HeartPulse,
  Calendar,
  FileText,
  Clock,
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  History,
  ExternalLink,
  Quote,
  Pencil,
  Loader2,
  Check,
  AlertTriangle,
  Trash2,
  CalendarCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useConditionDetail,
  useUpdateCondition,
  useDeleteCondition,
  useIcdLookup,
  useMedicalRecords,
  useCheckupsForCondition,
} from "@/hooks";
import { ConditionStatusBadge, ConditionAddHistoryDialog } from "@/components/conditions";
import { isUnverifiedClosure } from "@/lib/conditions/unverified-closure";
import { cn } from "@/lib/utils";
import type { ConditionStatus } from "@/types";

// Status icon component
function StatusIcon({ status, className }: { status: ConditionStatus; className?: string }) {
  const icons: Record<ConditionStatus, React.ReactNode> = {
    active: <AlertCircle className={cn("text-orange-500", className)} />,
    suspected: <HelpCircle className={cn("text-yellow-500", className)} />,
    resolved: <CheckCircle2 className={cn("text-green-500", className)} />,
    history: <History className={cn("text-gray-500", className)} />,
  };
  return icons[status] || null;
}

function ConditionDetailContent({ conditionId }: { conditionId: string }) {
  const router = useRouter();
  const t = useTranslations();
  const dateLocale = useDateFnsLocale();

  const { data: condition, isLoading, error, refetch } = useConditionDetail(conditionId);
  const updateConditionMutation = useUpdateCondition();
  const deleteConditionMutation = useDeleteCondition();
  const { data: linkedCheckups } = useCheckupsForCondition(conditionId);
  const { data: personRecords } = useMedicalRecords(
    condition?.person_id ? { person_id: condition.person_id } : {},
  );

  // Edit dialog state (base info only; use Add to history for status)
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [addHistoryOpen, setAddHistoryOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // ICD validation (validates entered code)
  const { data: icdLookup, isLoading: icdLoading } = useIcdLookup(
    editCode.length >= 2 ? editCode : null,
  );

  const openEditDialog = () => {
    if (condition) {
      setEditName(condition.name);
      setEditCode(condition.code || "");
      setEditNotes(condition.notes || "");
      setIsEditing(true);
    }
  };

  const handleSaveEdit = async () => {
    if (!condition) return;

    await updateConditionMutation.mutateAsync({
      id: condition.id,
      updates: {
        name: editName.trim(),
        code: editCode.trim() || null,
        icd_name_en: icdLookup?.found ? icdLookup.name_en : null,
        notes: editNotes.trim() || null,
      },
    });

    setIsEditing(false);
  };

  // Generate Google search URL for ICD code lookup
  const getGoogleSearchUrl = (conditionName: string) => {
    const searchQuery = encodeURIComponent(`${conditionName} ICD-10 code`);
    return `https://www.google.com/search?q=${searchQuery}`;
  };

  const canDeleteCondition = condition && condition.mention_count === 0;

  const handleDeleteCondition = async () => {
    if (!condition || !canDeleteCondition) return;
    await deleteConditionMutation.mutateAsync({
      id: condition.id,
      personId: condition.person_id,
    });
    setDeleteConfirmOpen(false);
    router.push("/health/conditions");
  };

  if (isLoading) {
    return (
      <div className="space-y-3 sm:space-y-6">
        <div className="flex items-center gap-2 sm:gap-4">
          <Skeleton className="h-9 w-9 sm:h-10 sm:w-10 shrink-0" />
          <div className="space-y-1.5 sm:space-y-2 min-w-0 flex-1">
            <Skeleton className="h-6 sm:h-8 w-48 sm:w-64" />
            <Skeleton className="h-3 sm:h-4 w-24 sm:w-32" />
          </div>
        </div>
        <Skeleton className="h-36 sm:h-48 w-full" />
        <Skeleton className="h-48 sm:h-64 w-full" />
      </div>
    );
  }

  if (error || !condition) {
    return (
      <div className="space-y-3 sm:space-y-6">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 sm:h-9 gap-1.5"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">{t("common.back")}</span>
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 sm:p-8 text-center">
          <HeartPulse className="h-10 w-10 sm:h-12 sm:w-12 mx-auto mb-3 sm:mb-4 text-destructive opacity-50" />
          <p className="text-destructive font-medium text-sm sm:text-base">
            {t("conditions.conditionNotFound")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2 sm:gap-3 min-w-0 flex-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 sm:h-10 sm:w-10 shrink-0"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4 sm:h-5 sm:w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap mb-0.5">
              <StatusIcon
                status={condition.current_status}
                className="h-4 w-4 sm:h-5 sm:w-5 shrink-0"
              />
              <ConditionStatusBadge status={condition.current_status} />
            </div>
            <h1 className="text-lg sm:text-2xl font-bold tracking-tight truncate">
              {condition.name}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="h-8 sm:h-9 text-xs sm:text-sm gap-1.5"
            onClick={() => setAddHistoryOpen(true)}
          >
            <History className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            <span className="hidden sm:inline">{t("conditions.addToHistory")}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 sm:h-9 text-xs sm:text-sm gap-1.5"
            onClick={openEditDialog}
          >
            <Pencil className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            <span className="hidden sm:inline">{t("common.edit")}</span>
          </Button>
          {canDeleteCondition && (
            <Button
              variant="destructive"
              size="sm"
              className="h-8 sm:h-9 text-xs sm:text-sm gap-1.5"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={deleteConditionMutation.isPending}
            >
              {deleteConditionMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 animate-spin shrink-0" />
              ) : (
                <Trash2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
              )}
              <span className="hidden sm:inline">{t("conditions.deleteCondition")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* ICD Info Card */}
      {(condition.code || condition.icd_name_en) && (
        <Card>
          <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-3">
            <CardTitle className="text-sm sm:text-base flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-xs">
                {t("conditions.icdName")}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 sm:p-6 pt-0 space-y-2">
            {condition.code && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-mono text-xs">
                  {condition.code}
                </Badge>
              </div>
            )}
            {condition.icd_name_en && (
              <div>
                <span className="text-xs sm:text-sm text-muted-foreground">
                  {t("conditions.icdOfficialName")}:
                </span>
                <p className="mt-0.5 sm:mt-1 font-medium text-sm sm:text-base">
                  {condition.icd_name_en}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Details Card */}
      <Card>
        <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-3">
          <CardTitle className="text-sm sm:text-base">{t("conditions.title")}</CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 pt-0 space-y-3 sm:space-y-4">
          {/* Status */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs sm:text-sm text-muted-foreground">
              {t("conditions.currentStatus")}
            </span>
            <ConditionStatusBadge status={condition.current_status} />
          </div>

          <Separator />

          {/* Timeline dates - only show if at least one date is set */}
          {(condition.onset_date || condition.resolved_date) && (
            <>
              <div className="grid gap-2 sm:gap-3 sm:grid-cols-2">
                {condition.onset_date && (
                  <div>
                    <span className="text-xs sm:text-sm text-muted-foreground block">
                      {t("conditions.onsetDate")}
                    </span>
                    <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 sm:mt-1 text-sm">
                      <Calendar className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
                      <span>
                        {format(new Date(condition.onset_date), "dd MMM yyyy", {
                          locale: dateLocale,
                        })}
                      </span>
                    </div>
                  </div>
                )}
                {condition.resolved_date && (
                  <div>
                    <span className="text-xs sm:text-sm text-muted-foreground block">
                      {t("conditions.resolvedDate")}
                    </span>
                    <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 sm:mt-1 text-sm">
                      <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
                      <span>
                        {format(new Date(condition.resolved_date), "dd MMM yyyy", {
                          locale: dateLocale,
                        })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
              <Separator />
            </>
          )}

          {/* Mention stats */}
          <div className="flex flex-wrap gap-3 sm:gap-4">
            <div>
              <span className="text-xs sm:text-sm text-muted-foreground block">
                {t("conditions.mentions")}
              </span>
              <div className="flex items-center gap-1.5 sm:gap-2 mt-0.5 sm:mt-1">
                <FileText className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground shrink-0" />
                <span className="font-semibold text-sm sm:text-base">
                  {condition.mention_count}
                </span>
              </div>
            </div>
            {condition.first_mentioned_date && (
              <div>
                <span className="text-xs sm:text-sm text-muted-foreground block">
                  {t("conditions.firstMentioned")}
                </span>
                <span className="text-xs sm:text-sm">
                  {format(new Date(condition.first_mentioned_date), "dd.MM.yyyy", {
                    locale: dateLocale,
                  })}
                </span>
              </div>
            )}
            {condition.last_mentioned_date &&
              condition.last_mentioned_date !== condition.first_mentioned_date && (
                <div>
                  <span className="text-xs sm:text-sm text-muted-foreground block">
                    {t("conditions.lastMentioned")}
                  </span>
                  <span className="text-xs sm:text-sm">
                    {format(new Date(condition.last_mentioned_date), "dd.MM.yyyy", {
                      locale: dateLocale,
                    })}
                  </span>
                </div>
              )}
          </div>

          {/* Notes */}
          {condition.notes && (
            <>
              <Separator />
              <div>
                <span className="text-xs sm:text-sm text-muted-foreground block mb-0.5 sm:mb-1">
                  {t("conditions.notes")}
                </span>
                <p className="text-xs sm:text-sm whitespace-pre-wrap">{condition.notes}</p>
              </div>
            </>
          )}

          {/* Timestamps */}
          <Separator />
          <div className="flex flex-wrap gap-3 sm:gap-4 text-[10px] sm:text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3 shrink-0" />
              <span>
                {t("records.detail.createdAt")}:{" "}
                {format(new Date(condition.created_at), "dd.MM.yyyy HH:mm", { locale: dateLocale })}
              </span>
            </div>
            {condition.updated_at !== condition.created_at && (
              <div className="flex items-center gap-1">
                <Pencil className="h-3 w-3 shrink-0" />
                <span>
                  {t("records.detail.updatedAt")}:{" "}
                  {format(new Date(condition.updated_at), "dd.MM.yyyy HH:mm", {
                    locale: dateLocale,
                  })}
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Timeline / History Card */}
      <Card>
        <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-3">
          <CardTitle className="text-sm sm:text-base flex items-center gap-1.5 sm:gap-2">
            <History className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            {t("conditions.mentionHistory")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 pt-0">
          {condition.history.length > 0 ? (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-3 sm:left-4 top-0 bottom-0 w-px bg-border" />

              <div className="space-y-3 sm:space-y-4">
                {condition.history.map((record) => {
                  // A closure the chart is ignoring must not read as a settled one here either.
                  // The timeline is where a person reconstructs what happened, so a green dot and
                  // a plain "Resolved" against a header that says active is the contradiction at
                  // its most convincing.
                  const awaitingReview = isUnverifiedClosure(record);
                  return (
                    <div key={record.id} className="relative pl-8 sm:pl-10">
                      {/* Timeline dot */}
                      <div
                        className={cn(
                          "absolute left-1.5 sm:left-2 top-2 w-3 h-3 sm:w-4 sm:h-4 rounded-full border-2 bg-background",
                          record.status_in_record === "active" && "border-orange-500",
                          record.status_in_record === "suspected" && "border-yellow-500",
                          record.status_in_record === "resolved" && "border-green-500",
                          record.status_in_record === "history" && "border-gray-500",
                          awaitingReview && "border-dashed border-amber-500",
                        )}
                      />

                      <div className="rounded-lg border p-2.5 sm:p-3 hover:bg-muted/50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            {/* Record title */}
                            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                              <Link
                                href={`/health/records/${record.record_id}`}
                                className="font-medium hover:underline truncate text-sm sm:text-base"
                              >
                                {record.record_title || t("records.title")}
                              </Link>
                              {record.record_type && (
                                <Badge variant="outline" className="text-[10px] sm:text-xs">
                                  {t(`records.types.${record.record_type}`)}
                                </Badge>
                              )}
                            </div>

                            {/* Date and status */}
                            <div className="flex items-center gap-2 sm:gap-3 mt-0.5 sm:mt-1 text-xs sm:text-sm text-muted-foreground flex-wrap">
                              {record.record_date && (
                                <div className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3 shrink-0" />
                                  {format(new Date(record.record_date), "dd.MM.yyyy", {
                                    locale: dateLocale,
                                  })}
                                </div>
                              )}
                              <ConditionStatusBadge
                                status={record.status_in_record as ConditionStatus}
                              />
                              {awaitingReview && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] sm:text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 gap-1"
                                  title={t("conditions.awaitingReviewTitle")}
                                >
                                  <AlertTriangle className="h-3 w-3 shrink-0" />
                                  {t("conditions.awaitingReview")}
                                </Badge>
                              )}
                            </div>

                            {/* Source anchor */}
                            {record.source_anchor && (
                              <div className="mt-1.5 sm:mt-2 flex items-start gap-1.5 sm:gap-2 text-[10px] sm:text-xs text-muted-foreground bg-muted/50 rounded p-1.5 sm:p-2">
                                <Quote className="h-3 w-3 shrink-0 mt-0.5" />
                                <span className="italic line-clamp-2">{record.source_anchor}</span>
                              </div>
                            )}
                          </div>

                          {/* Link to record */}
                          <Link href={`/health/records/${record.record_id}`} className="shrink-0">
                            <Button variant="ghost" size="icon" className="h-7 w-7 sm:h-8 sm:w-8">
                              <ExternalLink className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            </Button>
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-6 sm:py-8 text-muted-foreground">
              <History className="h-6 w-6 sm:h-8 sm:w-8 mx-auto mb-1.5 sm:mb-2 opacity-50" />
              <p className="text-xs sm:text-sm">{t("conditions.noHistory")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Linked checkups */}
      <Card>
        <CardHeader className="p-3 sm:p-6 pb-2 sm:pb-3">
          <CardTitle className="text-sm sm:text-base flex items-center gap-1.5 sm:gap-2">
            <CalendarCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
            {t("conditions.linkedCheckups")}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 sm:p-6 pt-0">
          {linkedCheckups && linkedCheckups.length > 0 ? (
            <div className="space-y-2">
              {linkedCheckups.map((item) => (
                <Link
                  key={item.id}
                  href={`/health/checkups/${item.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border p-2.5 sm:p-3 hover:bg-muted/50 transition-colors"
                >
                  <span className="font-medium text-sm sm:text-base truncate">{item.title}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {item.next_due_at
                      ? format(new Date(item.next_due_at), "dd.MM.yyyy", { locale: dateLocale })
                      : "—"}
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-xs sm:text-sm text-muted-foreground py-2">
              {t("conditions.linkedCheckupsEmpty")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditing} onOpenChange={setIsEditing}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("conditions.edit")}</DialogTitle>
            <DialogDescription>{t("conditions.editDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="editName">{t("conditions.name")}</Label>
              <Input id="editName" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>

            {/* ICD Code */}
            <div className="space-y-2">
              <Label htmlFor="editCode">{t("conditions.icdCode")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="editCode"
                  value={editCode}
                  onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                  placeholder="H52.1"
                  className="font-mono w-28"
                />
                {icdLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {icdLookup?.found && (
                  <div className="flex items-center gap-1 text-green-600 flex-1 min-w-0">
                    <Check className="h-4 w-4 shrink-0" />
                    <span className="text-sm truncate">{icdLookup.name_en}</span>
                  </div>
                )}
                {editCode && !icdLoading && icdLookup && !icdLookup.found && (
                  <div className="flex items-center gap-1 text-yellow-600">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm">{t("conditions.icdNotFound")}</span>
                  </div>
                )}
              </div>

              {/* Google search link to find ICD code */}
              {editName.trim() && (
                <a
                  href={getGoogleSearchUrl(editName.trim())}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t("conditions.findIcdCode")}
                </a>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="editNotes">{t("conditions.notes")}</Label>
              <Textarea
                id="editNotes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditing(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={!editName.trim() || updateConditionMutation.isPending}
            >
              {updateConditionMutation.isPending && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add to history dialog */}
      {condition && (
        <ConditionAddHistoryDialog
          open={addHistoryOpen}
          onOpenChange={setAddHistoryOpen}
          conditionId={condition.id}
          conditionName={condition.name}
          personId={condition.person_id}
          records={personRecords || []}
          onSaved={() => refetch()}
        />
      )}

      {/* Delete condition confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("conditions.deleteCondition")}</DialogTitle>
            <DialogDescription>{t("conditions.deleteConditionConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCondition}
              disabled={deleteConditionMutation.isPending}
            >
              {deleteConditionMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              {t("conditions.deleteCondition")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ConditionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: conditionId } = use(params);
  return <ConditionDetailContent conditionId={conditionId} />;
}
