"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase";
import type { MoneyImportBatch, MoneyImportBatchRow } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMoney } from "@/lib/money";
import { format } from "date-fns";

export default function MoneyImportReportPage() {
  const params = useParams<{ batchId: string }>();
  const batchId = params?.batchId;
  const t = useTranslations();

  const [batch, setBatch] = useState<MoneyImportBatch | null>(null);
  const [rows, setRows] = useState<MoneyImportBatchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!batchId) {
      setError("Batch id is missing");
      setLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      const supabase = createClient();

      const { data: batchData, error: batchError } = await supabase
        .from("money_import_batches")
        .select("*")
        .eq("id", batchId)
        .single();

      if (batchError || !batchData) {
        if (!cancelled) {
          setError(batchError?.message ?? "Batch not found");
          setLoading(false);
        }
        return;
      }

      const { data: rowsData, error: rowsError } = await supabase
        .from("money_import_batch_rows")
        .select("*")
        .eq("batch_id", batchId)
        .order("source_row_index", { ascending: true })
        .order("source_line_index", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true });

      if (rowsError) {
        if (!cancelled) {
          setError(rowsError.message);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setBatch(batchData as MoneyImportBatch);
        setRows((rowsData ?? []) as MoneyImportBatchRow[]);
        setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [batchId]);

  const grouped = useMemo(() => {
    const txRows = rows.filter((row) => row.row_kind === "transaction");
    const lineRows = rows.filter((row) => row.row_kind === "line_item");
    const linesByParent = new Map<string, MoneyImportBatchRow[]>();

    lineRows.forEach((row) => {
      if (!row.parent_row_id) return;
      const list = linesByParent.get(row.parent_row_id) ?? [];
      list.push(row);
      linesByParent.set(row.parent_row_id, list);
    });

    return txRows.map((tx) => ({
      tx,
      lines: linesByParent.get(tx.id) ?? [],
    }));
  }, [rows]);

  if (loading) {
    return <div className="text-sm text-muted-foreground">{t("common.loading")}</div>;
  }

  if (error || !batch) {
    return (
      <div className="space-y-4">
        <Button variant="outline" asChild>
          <Link href="/money/import" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {t("common.back")}
          </Link>
        </Button>
        <p className="text-sm text-destructive">{error ?? "Unknown error"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t("money.importResultsTitle")}</h1>
        <Button variant="outline" asChild>
          <Link href="/money/import" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {t("money.importAnotherFile")}
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("money.importResultsSummary", {
              inserted: batch.inserted_count,
              skipped: batch.skipped_count,
            })}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <div>{`Batch: ${batch.id}`}</div>
          <div>{`Source: ${batch.source}`}</div>
          <div>{`Status: ${batch.status}`}</div>
          <div>{`Parsed rows: ${batch.parsed_transactions_count}`}</div>
          {batch.completed_at && (
            <div>{`Completed: ${format(new Date(batch.completed_at), "dd.MM.yyyy HH:mm")}`}</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("money.importResultStatus")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {grouped.length === 0 && (
            <p className="text-sm text-muted-foreground">No rows imported for this batch.</p>
          )}

          {grouped.map(({ tx, lines }) => {
            const txPayload = (tx.payload ?? {}) as Record<string, unknown>;
            const postedAt = typeof txPayload.posted_at === "string" ? txPayload.posted_at : null;
            const amount = typeof txPayload.amount === "number" ? txPayload.amount : 0;
            const currency = typeof txPayload.currency === "string" ? txPayload.currency : "RUB";
            const title =
              (typeof txPayload.merchant_name === "string" && txPayload.merchant_name.trim()) ||
              "Imported transaction";

            return (
              <details key={tx.id} open className="rounded-md border p-3">
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span>{title}</span>
                      {postedAt && (
                        <span className="text-muted-foreground">
                          {format(new Date(postedAt), "dd.MM.yyyy HH:mm")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{formatMoney(amount, currency, "ru-RU")}</span>
                      <RowStatusBadge status={tx.status} t={t} />
                    </div>
                  </div>
                  {tx.message && (
                    <div className="text-xs mt-1 text-muted-foreground">{tx.message}</div>
                  )}
                </summary>

                <div className="mt-3 space-y-2">
                  {lines.length === 0 && (
                    <p className="text-xs text-muted-foreground">No line items reported.</p>
                  )}

                  {lines.map((line) => {
                    const payload = (line.payload ?? {}) as Record<string, unknown>;
                    const lineTitle =
                      typeof payload.title === "string" ? payload.title : "Line item";
                    const lineAmount = typeof payload.amount === "number" ? payload.amount : amount;

                    return (
                      <div
                        key={line.id}
                        className="flex items-center justify-between gap-2 rounded-sm border p-2 text-sm"
                      >
                        <div>
                          <div>{lineTitle}</div>
                          {line.message && (
                            <div className="text-xs text-muted-foreground">{line.message}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span>{formatMoney(lineAmount, currency, "ru-RU")}</span>
                          <RowStatusBadge status={line.status} t={t} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function RowStatusBadge({
  status,
  t,
}: {
  status: "inserted" | "skipped" | "error";
  t: ReturnType<typeof useTranslations>;
}) {
  if (status === "inserted") {
    return (
      <Badge variant="default" className="bg-green-600 hover:bg-green-700">
        {t("money.importResultRowInserted")}
      </Badge>
    );
  }

  if (status === "skipped") {
    return <Badge variant="secondary">{t("money.importResultRowSkipped")}</Badge>;
  }

  return <Badge variant="destructive">{t("money.importResultRowError")}</Badge>;
}
