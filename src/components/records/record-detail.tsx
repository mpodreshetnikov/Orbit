"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import {
  ArrowLeft,
  Calendar,
  Clock,
  Trash2,
  RotateCcw,
  FileCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
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
import { AttachmentGrid } from "./attachment-preview";
import {
  useMedicalRecord,
  useSoftDeleteRecord,
  useRestoreRecord,
  useHardDeleteRecord,
  useUpdateMedicalRecord,
} from "@/hooks";
import type { RecordType } from "@/types";
import { cn } from "@/lib/utils";

const RECORD_TYPE_COLORS: Record<RecordType, string> = {
  lab: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
  visit: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
  imaging: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20",
  prescription: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
  vaccination: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
  vet: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  other: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
};

interface RecordDetailProps {
  recordId: string;
}

export function RecordDetail({ recordId }: RecordDetailProps) {
  const t = useTranslations();
  const router = useRouter();

  const { data: record, isLoading, error } = useMedicalRecord(recordId);

  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const softDeleteMutation = useSoftDeleteRecord();
  const restoreMutation = useRestoreRecord();
  const hardDeleteMutation = useHardDeleteRecord();
  const updateMutation = useUpdateMedicalRecord();

  const handleRemove = () => {
    setShowRemoveDialog(true);
  };

  const confirmRemove = () => {
    softDeleteMutation.mutate(recordId, {
      onSuccess: () => {
        setShowRemoveDialog(false);
        router.push("/health");
      },
    });
  };

  const handleRestore = () => {
    restoreMutation.mutate(recordId);
  };

  const handleDelete = () => {
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    hardDeleteMutation.mutate(recordId, {
      onSuccess: () => {
        setShowDeleteDialog(false);
        router.push("/health");
      },
    });
  };

  const handleActivate = () => {
    updateMutation.mutate(
      { id: recordId, updates: { status: "active" } },
      {
        onSuccess: () => {
          router.push("/health");
        },
      }
    );
  };

  if (isLoading) {
    return <RecordDetailSkeleton />;
  }

  if (error || !record) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("common.back")}
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">{t("common.error")}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {error?.message || "Record not found"}
          </p>
        </div>
      </div>
    );
  }

  const isRemoved = record.status === "removed";
  const isDraft = record.status === "draft";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge
                variant="outline"
                className={cn("font-medium", RECORD_TYPE_COLORS[record.record_type])}
              >
                {t(`records.types.${record.record_type}`)}
              </Badge>
              {isDraft && (
                <Badge variant="secondary">{t("records.status.draft")}</Badge>
              )}
              {isRemoved && (
                <Badge variant="destructive">{t("records.status.removed")}</Badge>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{record.title}</h1>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isDraft && (
            <Button onClick={handleActivate} disabled={updateMutation.isPending}>
              <FileCheck className="mr-2 h-4 w-4" />
              {t("records.add.saveAndActivate")}
            </Button>
          )}
          {!isRemoved && !isDraft && (
            <Button
              variant="destructive"
              onClick={handleRemove}
              disabled={softDeleteMutation.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("records.actions.remove")}
            </Button>
          )}
          {isRemoved && (
            <>
              <Button
                variant="outline"
                onClick={handleRestore}
                disabled={restoreMutation.isPending}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                {t("records.actions.restore")}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={hardDeleteMutation.isPending}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("records.actions.delete")}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
        <div className="flex items-center gap-1">
          <Calendar className="h-4 w-4" />
          <span>
            {record.record_date
              ? format(new Date(record.record_date), "MMMM d, yyyy")
              : t("records.noDate")}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="h-4 w-4" />
          <span>
            {t("records.detail.createdAt")}:{" "}
            {format(new Date(record.created_at), "MMM d, yyyy 'at' HH:mm")}
          </span>
        </div>
        {record.updated_at !== record.created_at && (
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4" />
            <span>
              {t("records.detail.updatedAt")}:{" "}
              {format(new Date(record.updated_at), "MMM d, yyyy 'at' HH:mm")}
            </span>
          </div>
        )}
      </div>

      <Separator />

      {/* Notes */}
      {record.notes && (
        <>
          <div>
            <h2 className="text-lg font-semibold mb-2">{t("records.detail.notes")}</h2>
            <p className="text-muted-foreground whitespace-pre-wrap">{record.notes}</p>
          </div>
          <Separator />
        </>
      )}

      {/* Attachments */}
      <div>
        <h2 className="text-lg font-semibold mb-4">
          {t("records.detail.attachments")} ({record.attachments.length})
        </h2>
        <AttachmentGrid attachments={record.attachments} />
      </div>

      {/* Remove confirmation dialog */}
      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("records.confirm.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("records.confirm.removeMessage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete permanently confirmation dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("records.confirm.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("records.confirm.deleteMessage")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RecordDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Skeleton className="h-10 w-10" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-8 w-64" />
        </div>
      </div>
      <div className="flex gap-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5 w-48" />
      </div>
      <Skeleton className="h-px w-full" />
      <div className="space-y-2">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Skeleton className="h-px w-full" />
      <div className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="aspect-[4/3]" />
          <Skeleton className="aspect-[4/3]" />
        </div>
      </div>
    </div>
  );
}
