"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase";
import { useUIStore } from "@/stores/ui-store";
import type { MoneyImportBatch, MoneyImportBatchStatus } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function formatDateTime(value: string | null): string {
  if (!value) return "-";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, "dd.MM.yyyy HH:mm");
}

function getImportTypeLabel(
  importType: string,
  meta: Record<string, unknown> | null | undefined,
  t: ReturnType<typeof useTranslations>,
): string {
  // An unattended run is a web export nobody started; the extension marks the batch.
  if (meta?.unattended === true) return t("money.importHistoryImportTypeUnattended");
  if (importType === "file") return t("money.importHistoryImportTypeFile");
  if (importType === "web_export") return t("money.importHistoryImportTypeWebExport");
  return importType;
}

/** The window an import covered, so two batches from one unattended visit read as two windows. */
function formatWindow(windowFrom: string | null | undefined, windowTo: string | null | undefined) {
  if (!windowFrom || !windowTo) return null;
  const from = new Date(windowFrom);
  const to = new Date(windowTo);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return null;
  return `${format(from, "dd.MM.yyyy")} – ${format(to, "dd.MM.yyyy")}`;
}

function BatchStatusBadge({
  status,
  t,
}: {
  status: MoneyImportBatchStatus;
  t: ReturnType<typeof useTranslations>;
}) {
  if (status === "completed") {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-700">
        {t("money.importBatchStatusCompleted")}
      </Badge>
    );
  }

  if (status === "failed") {
    return <Badge variant="destructive">{t("money.importBatchStatusFailed")}</Badge>;
  }

  if (status === "running") {
    return <Badge variant="secondary">{t("money.importBatchStatusRunning")}</Badge>;
  }

  if (status === "discarded") {
    return <Badge variant="outline">{t("money.importBatchStatusDiscarded")}</Badge>;
  }

  return <Badge variant="secondary">{t("money.importBatchStatusPending")}</Badge>;
}

export default function MoneyImportHistoryPage() {
  const t = useTranslations();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const [batches, setBatches] = useState<MoneyImportBatch[]>([]);
  const [loading, setLoading] = useState(() => Boolean(selectedPersonId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPersonId) {
      setBatches([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);

      const supabase = createClient();
      const { data, error: loadError } = await supabase
        .from("money_import_batches")
        .select("*")
        .eq("payer_person_id", selectedPersonId)
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (loadError) {
        setError(loadError.message);
        setBatches([]);
        setLoading(false);
        return;
      }

      setBatches((data ?? []) as MoneyImportBatch[]);
      setLoading(false);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [selectedPersonId]);

  if (!selectedPersonId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p>{t("person.selectPrompt")}</p>
      </div>
    );
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  if (error) {
    return (
      <div className="space-y-4 max-w-7xl">
        <Button variant="outline" asChild>
          <Link href="/money/import" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </Link>
        </Button>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">{t("money.importHistoryTitle")}</h1>
        <Button variant="outline" asChild>
          <Link href="/money/import" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </Link>
        </Button>
      </div>

      {batches.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="space-y-2 p-8 text-center">
            <p className="font-medium">{t("money.importHistoryEmptyTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("money.importHistoryEmptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-lg border overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm" data-testid="import-history-table">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">
                  {t("money.importHistoryCreatedAt")}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t("money.importHistorySource")}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t("money.importHistoryImportType")}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t("money.importHistoryStatus")}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("money.importHistoryParsedRows")}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t("money.importHistoryResults")}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t("money.importHistoryCompletedAt")}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  {t("money.importHistoryAction")}
                </th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    <div>{formatDateTime(batch.created_at)}</div>
                    <div className="text-xs">{batch.id}</div>
                  </td>
                  <td className="px-4 py-3">{batch.source}</td>
                  <td className="px-4 py-3">
                    <div>{getImportTypeLabel(batch.import_type, batch.meta, t)}</div>
                    {formatWindow(batch.window_from, batch.window_to) && (
                      <div className="text-xs text-muted-foreground">
                        {formatWindow(batch.window_from, batch.window_to)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <BatchStatusBadge status={batch.status} t={t} />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {batch.parsed_transactions_count}
                  </td>
                  <td className="px-4 py-3">
                    {t("money.importHistoryResultsSummary", {
                      inserted: batch.inserted_count,
                      skipped: batch.skipped_count,
                      errors: batch.error_count,
                    })}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {formatDateTime(batch.completed_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/money/import/reports/${batch.id}`}>
                        {t("money.importOpenReport")}
                      </Link>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
