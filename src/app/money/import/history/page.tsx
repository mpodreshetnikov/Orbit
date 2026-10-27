"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase";
import { useUIStore } from "@/stores/ui-store";
import type { MoneyImportBatch, MoneyImportBatchStatus } from "@/types";
import {
  IMPORT_REVIEW_PERIODS,
  batchesInWindow,
  feedQueryForReviewPeriod,
  importReviewWindow,
  summarizeImportBatches,
  type ImportReviewPeriod,
} from "@/types/money-import-review";
import { importBankOfSource } from "@/types/money-import-sources";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const REVIEW_PERIOD_KEYS: Record<ImportReviewPeriod, string> = {
  week: "money.importReviewPeriodWeek",
  month: "money.importReviewPeriodMonth",
  custom: "money.importReviewPeriodCustom",
  all: "money.importReviewPeriodAll",
};

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

/** The bank by name where the page knows it, the raw source id otherwise. */
function bankLabel(source: string, t: ReturnType<typeof useTranslations>): string {
  const bank = importBankOfSource(source);
  if (bank === "tbank") return t("money.importBankTbank");
  if (bank === "alfa") return t("money.importBankAlfa");
  return source;
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

  if (status === "rolled_back") {
    return <Badge variant="outline">{t("money.importBatchStatusRolledBack")}</Badge>;
  }

  return <Badge variant="secondary">{t("money.importBatchStatusPending")}</Badge>;
}

export default function MoneyImportHistoryPage() {
  const t = useTranslations();
  const selectedPersonId = useUIStore((state) => state.selectedPersonId);
  const [batches, setBatches] = useState<MoneyImportBatch[]>([]);
  const [loading, setLoading] = useState(() => Boolean(selectedPersonId));
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<ImportReviewPeriod>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const custom = useMemo(() => ({ from: customFrom, to: customTo }), [customFrom, customTo]);
  const visibleBatches = useMemo(
    () => batchesInWindow(batches, importReviewWindow(period, new Date(), custom)),
    [batches, period, custom],
  );
  const summary = useMemo(() => summarizeImportBatches(visibleBatches), [visibleBatches]);
  const feedQuery = feedQueryForReviewPeriod(period, custom);

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

      {batches.length > 0 && (
        <Card data-testid="import-review">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm font-medium">{t("money.importReviewTitle")}</span>
              {IMPORT_REVIEW_PERIODS.map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={period === value ? "default" : "outline"}
                  className="rounded-full"
                  aria-pressed={period === value}
                  onClick={() => setPeriod(value)}
                >
                  {t(REVIEW_PERIOD_KEYS[value])}
                </Button>
              ))}
            </div>
            {period === "custom" && (
              <div className="flex flex-wrap gap-3">
                <div className="space-y-1">
                  <Label htmlFor="import-review-from">{t("money.importReviewFrom")}</Label>
                  <Input
                    id="import-review-from"
                    type="date"
                    value={customFrom}
                    onChange={(event) => setCustomFrom(event.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="import-review-to">{t("money.importReviewTo")}</Label>
                  <Input
                    id="import-review-to"
                    type="date"
                    value={customTo}
                    onChange={(event) => setCustomTo(event.target.value)}
                  />
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div className="space-y-0.5" data-testid="import-review-summary">
                <p>
                  {summary.imports === 0
                    ? t("money.importReviewEmpty")
                    : t("money.importReviewSummary", {
                        imports: summary.imports,
                        inserted: summary.inserted,
                        skipped: summary.skipped,
                        errors: summary.errors,
                      })}
                </p>
                {(summary.rolledBack > 0 || summary.failed > 0) && (
                  <p className="text-muted-foreground">
                    {[
                      summary.rolledBack > 0
                        ? t("money.importReviewRolledBack", { count: summary.rolledBack })
                        : null,
                      summary.failed > 0
                        ? t("money.importReviewFailed", { count: summary.failed })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              {feedQuery && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/money/transactions?${feedQuery}`}>
                    {t("money.importReviewOpenFeed")}
                  </Link>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {batches.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="space-y-2 p-8 text-center">
            <p className="font-medium">{t("money.importHistoryEmptyTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("money.importHistoryEmptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        // One card per import, as the iOS app has it: a table of eight columns overflowed a phone and
        // a laptop alike.
        <ul className="space-y-2" data-testid="import-history-cards">
          {visibleBatches.map((batch) => {
            const window = formatWindow(batch.window_from, batch.window_to);
            return (
              <li key={batch.id}>
                <Link
                  href={`/money/import/reports/${batch.id}`}
                  className="flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="flex-1 font-semibold">
                        {formatDateTime(batch.created_at)}
                      </span>
                      <BatchStatusBadge status={batch.status} t={t} />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {[
                        bankLabel(batch.source, t),
                        getImportTypeLabel(batch.import_type, batch.meta, t),
                        window,
                        `${t("money.importHistoryParsedRows")}: ${batch.parsed_transactions_count}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("money.importResultsSummary", {
                        inserted: batch.inserted_count,
                        skipped: batch.skipped_count,
                      })}
                      {batch.error_count > 0 &&
                        ` ${t("money.importHistoryErrors", { count: batch.error_count })}`}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
