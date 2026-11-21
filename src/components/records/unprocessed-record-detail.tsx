"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronUp, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useSoftDeleteRecord } from "@/hooks";
import { translateOcrFailure } from "@/lib/health/ocr-failure";
import type { MedicalRecordWithAttachments } from "@/types";

export interface UnprocessedRecordDetailProps {
  recordId: string;
  record: MedicalRecordWithAttachments;
}

/**
 * Read-only detail for records left on the removed UI OCR path.
 * Neutral status + attachments/OCR text; soft-remove only when ocr_failed.
 */
export function UnprocessedRecordDetail({ recordId, record }: UnprocessedRecordDetailProps) {
  const t = useTranslations();
  const router = useRouter();
  const softDeleteMutation = useSoftDeleteRecord();
  const [showOcrText, setShowOcrText] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const isOcrFailed = record.status === "ocr_failed";

  const confirmRemove = () => {
    softDeleteMutation.mutate(recordId, {
      onSuccess: () => {
        setShowRemoveDialog(false);
        router.push("/health");
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <Button variant="ghost" size="icon" className="shrink-0" onClick={() => router.back()}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <Badge variant="outline" className="mb-1 text-muted-foreground">
              {t("records.status.notProcessed")}
            </Badge>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {record.title || t("records.status.notProcessed")}
            </h1>
            <p className="text-muted-foreground">{t("records.status.notProcessedHint")}</p>
          </div>
        </div>
        {isOcrFailed ? (
          <Button
            variant="destructive"
            onClick={() => setShowRemoveDialog(true)}
            disabled={softDeleteMutation.isPending}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t("records.actions.remove")}
          </Button>
        ) : null}
      </div>

      <div className="rounded-lg border border-dashed p-4 space-y-2">
        <p className="text-sm text-muted-foreground">{t("records.status.viaAssistant")}</p>
        {isOcrFailed && record.ocr_error ? (
          <p className="text-sm text-muted-foreground">
            {translateOcrFailure(record.ocr_error, t)}
          </p>
        ) : null}
      </div>

      {record.ocr_text ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/30 p-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowOcrText((open) => !open)}
            className="w-full justify-between text-left h-auto p-0 hover:bg-transparent"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <FileText className="h-4 w-4" />
              <span>
                {t("records.detail.ocrText")}
                {` (${record.ocr_text.length} ${t("records.wizard.chars")})`}
              </span>
            </div>
            {showOcrText ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
          {showOcrText ? (
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/5 p-3 text-xs text-muted-foreground dark:bg-white/5">
              {record.ocr_text}
            </pre>
          ) : null}
        </div>
      ) : null}

      <div>
        <h2 className="text-lg font-semibold mb-4">
          {t("records.detail.attachments")} ({record.attachments.length})
        </h2>
        {record.attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("records.detail.noAttachments")}</p>
        ) : (
          <AttachmentGrid attachments={record.attachments} />
        )}
      </div>

      {isOcrFailed ? (
        <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("records.confirm.removeTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("records.confirm.removeMessage")}</AlertDialogDescription>
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
      ) : null}
    </div>
  );
}
