"use client";

import React from "react";
import { useMedicalRecord } from "@/hooks";
import { isUnprocessedPipelineStatus } from "@/lib/medical-record-status";
import { RecordDetail as LegacyRecordDetail } from "./record-detail";
import { UnprocessedRecordDetail } from "./unprocessed-record-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

interface RecordDetailGateProps {
  recordId: string;
}

/**
 * Routes stuck/failed OCR records to the MCP-only unprocessed view; everything else
 * stays on the legacy detail (view/edit). Keeps record-detail.tsx off the mutate list.
 */
export function RecordDetail({ recordId }: RecordDetailGateProps) {
  const t = useTranslations();
  const router = useRouter();
  const { data: record, isLoading, error } = useMedicalRecord(recordId);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error !== null && error !== undefined) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("common.back")}
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">{t("common.error")}</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {error.message.length > 0 ? error.message : t("records.detail.notFound")}
          </p>
        </div>
      </div>
    );
  }

  if (record === null || record === undefined) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("common.back")}
        </Button>
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center">
          <p className="text-destructive">{t("common.error")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t("records.detail.notFound")}</p>
        </div>
      </div>
    );
  }

  if (isUnprocessedPipelineStatus(record.status)) {
    return <UnprocessedRecordDetail recordId={recordId} record={record} />;
  }

  return <LegacyRecordDetail recordId={recordId} />;
}
