"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase";
import type {
  MoneyImportApplyBatchResult,
  MoneyImportBatch,
  MoneyImportBatchRow,
  MoneyImportDiscardBatchResult,
} from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { callMoneyImportAction, getAccessToken } from "../../money-import-client";

const VIRTUAL_ROW_HEIGHT = 84;
const VIRTUAL_OVERSCAN = 6;
const VIRTUAL_ROW_THRESHOLD = 40;
const REPORT_GRID_COLUMNS = "grid-cols-[160px_110px_140px_120px_180px_minmax(300px,1fr)_120px]";

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function formatDateTime(value: unknown): string {
  if (typeof value !== "string") return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return format(parsed, "dd.MM.yyyy HH:mm:ss");
}

function getTransactionDateMs(row: MoneyImportBatchRow): number {
  const payload = asRecord(row.payload);
  const postedAt = typeof payload.posted_at === "string" ? payload.posted_at : null;
  const postedAtMs = postedAt ? new Date(postedAt).getTime() : Number.NaN;
  if (!Number.isNaN(postedAtMs)) return postedAtMs;

  const createdAtMs = new Date(row.created_at).getTime();
  if (!Number.isNaN(createdAtMs)) return createdAtMs;

  return Number.NEGATIVE_INFINITY;
}

function hasDomFallbackMarker(row: MoneyImportBatchRow): boolean {
  const payload = asRecord(row.payload);
  const rawPayload = asRecord(payload.raw_payload);
  return rawPayload.extraction_method === "dom" || rawPayload.source === "dom_fallback";
}

function formatAmountCurrency(amount: unknown, currency: unknown): string {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "-";
  const formattedAmount = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
  const currencyCode =
    typeof currency === "string" && currency.trim().length > 0 ? currency.trim().toUpperCase() : "";
  return currencyCode ? `${formattedAmount} ${currencyCode}` : formattedAmount;
}

function formatQtyUnit(quantity: unknown, unit: unknown): string {
  const quantityText =
    typeof quantity === "number" && Number.isFinite(quantity) ? String(quantity) : null;
  const unitText = typeof unit === "string" && unit.trim().length > 0 ? unit.trim() : null;
  if (!quantityText && !unitText) return "-";
  if (!quantityText) return unitText!;
  if (!unitText) return quantityText;
  return `${quantityText} ${unitText}`;
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function importSourceToAccountSource(source: string): string {
  if (source.startsWith("tbank")) return "tbank";
  return source;
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

interface GroupedTransactionRow {
  tx: MoneyImportBatchRow;
  lines: MoneyImportBatchRow[];
}

interface SourceAccountOption {
  id: string;
  account_label: string | null;
}

interface CardMappingOption {
  cardId: string;
  cardLabel: string;
  currentAccountId: string;
  currentAccountLabel: string;
  targetAccountId: string;
}

export default function MoneyImportReportPage() {
  const params = useParams<{ batchId: string }>();
  const batchId = params?.batchId;
  const t = useTranslations();

  const [batch, setBatch] = useState<MoneyImportBatch | null>(null);
  const [rows, setRows] = useState<MoneyImportBatchRow[]>([]);
  const [cardNameById, setCardNameById] = useState<Record<string, string>>({});
  const [sourceAccounts, setSourceAccounts] = useState<SourceAccountOption[]>([]);
  const [cardMappings, setCardMappings] = useState<CardMappingOption[]>([]);
  const [remapPendingCardId, setRemapPendingCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewActionPending, setReviewActionPending] = useState<"apply" | "discard" | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [expandedTxIds, setExpandedTxIds] = useState<Record<string, boolean>>({});
  const [lineJsonModal, setLineJsonModal] = useState<{
    open: boolean;
    title: string;
    json: string;
  }>({
    open: false,
    title: "",
    json: "",
  });
  const listRef = useRef<HTMLDivElement | null>(null);

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
        const reportRows = (rowsData ?? []) as MoneyImportBatchRow[];
        const transactionPayloads = reportRows
          .filter((row) => row.row_kind === "transaction")
          .map((row) => asRecord(row.payload));
        const cardIds = Array.from(
          new Set(
            transactionPayloads
              .map((payload) => normalizeId(payload.card_id))
              .filter((value): value is string => Boolean(value)),
          ),
        );
        const rawBatch = batchData as Record<string, unknown>;
        const payerPersonId = normalizeId(rawBatch.payer_person_id);
        const sourceForAccounts = importSourceToAccountSource(normalizeId(rawBatch.source) ?? "");

        const [accountsResponse, cardsResponse] = await Promise.all([
          payerPersonId && sourceForAccounts
            ? supabase
                .from("money_accounts")
                .select("id, account_label")
                .eq("owner_person_id", payerPersonId)
                .eq("source", sourceForAccounts)
                .order("account_label", { ascending: true })
            : Promise.resolve({
                data: [] as Array<{ id: string; account_label: string | null }>,
                error: null,
              }),
          cardIds.length > 0
            ? supabase
                .from("money_cards")
                .select("id, account_id, card_label, last4")
                .in("id", cardIds)
            : Promise.resolve({
                data: [] as Array<{
                  id: string;
                  account_id: string;
                  card_label: string | null;
                  last4: string;
                }>,
                error: null,
              }),
        ]);

        if (accountsResponse.error || cardsResponse.error) {
          if (!cancelled) {
            setError(
              accountsResponse.error?.message ?? cardsResponse.error?.message ?? "Load failed",
            );
            setLoading(false);
          }
          return;
        }

        const accountRows = (accountsResponse.data ?? []) as Array<{
          id: string;
          account_label: string | null;
        }>;
        const cardRows = (cardsResponse.data ?? []) as Array<{
          id: string;
          account_id: string;
          card_label: string | null;
          last4: string;
        }>;

        const nextAccountNameById: Record<string, string> = {};
        (accountRows ?? []).forEach((account) => {
          const accountId = normalizeId((account as { id?: unknown }).id);
          if (!accountId) return;
          const label = normalizeId((account as { account_label?: unknown }).account_label);
          nextAccountNameById[accountId] = label ?? "Account";
        });

        const nextCardNameById: Record<string, string> = {};
        (cardRows ?? []).forEach((card) => {
          const cardId = normalizeId((card as { id?: unknown }).id);
          if (!cardId) return;
          const accountId = normalizeId((card as { account_id?: unknown }).account_id);
          const accountLabel = accountId ? nextAccountNameById[accountId] : null;
          const explicitCardLabel = normalizeId((card as { card_label?: unknown }).card_label);
          const last4 = normalizeId((card as { last4?: unknown }).last4);
          const cardLabel = explicitCardLabel ?? (last4 ? `*${last4}` : "Card");
          nextCardNameById[cardId] = accountLabel ? `${accountLabel} / ${cardLabel}` : cardLabel;
        });

        const nextCardMappings = cardRows
          .map((card) => {
            const cardId = normalizeId(card.id);
            const currentAccountId = normalizeId(card.account_id);
            if (!cardId || !currentAccountId) return null;
            const explicitCardLabel = normalizeId(card.card_label);
            const last4 = normalizeId(card.last4);
            const cardLabel = explicitCardLabel ?? (last4 ? `*${last4}` : "Card");
            return {
              cardId,
              cardLabel,
              currentAccountId,
              currentAccountLabel: nextAccountNameById[currentAccountId] ?? "Account",
              targetAccountId: currentAccountId,
            } satisfies CardMappingOption;
          })
          .filter((mapping): mapping is CardMappingOption => Boolean(mapping));

        if (cancelled) return;
        setSourceAccounts(accountRows);
        setCardMappings(nextCardMappings);
        setCardNameById(nextCardNameById);
        setBatch(batchData as MoneyImportBatch);
        setRows(reportRows);
        setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [batchId, refreshTick]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) return;
    setViewportHeight(node.clientHeight);
  }, [loading]);

  const grouped = useMemo<GroupedTransactionRow[]>(() => {
    const txRows = rows.filter((row) => row.row_kind === "transaction");
    const lineRows = rows.filter((row) => row.row_kind === "line_item");
    const linesByParent = new Map<string, MoneyImportBatchRow[]>();

    lineRows.forEach((row) => {
      if (!row.parent_row_id) return;
      const list = linesByParent.get(row.parent_row_id) ?? [];
      list.push(row);
      linesByParent.set(row.parent_row_id, list);
    });

    return txRows
      .map((tx) => ({
        tx,
        lines: linesByParent.get(tx.id) ?? [],
      }))
      .sort((left, right) => getTransactionDateMs(right.tx) - getTransactionDateMs(left.tx));
  }, [rows]);

  const hasExpandedRows = useMemo(
    () => Object.values(expandedTxIds).some(Boolean),
    [expandedTxIds],
  );
  const isPendingReview = batch?.status === "pending";
  const isDiscarded = batch?.status === "discarded";
  const showCardMapping = cardMappings.length > 0 && !isPendingReview && !isDiscarded;
  const hasDomFallbackWarning = useMemo(
    () => batch?.source === "tbank_web" && rows.some((row) => hasDomFallbackMarker(row)),
    [batch?.source, rows],
  );
  const shouldVirtualize = grouped.length >= VIRTUAL_ROW_THRESHOLD && !hasExpandedRows;

  const virtual = useMemo(() => {
    const count = grouped.length;
    if (count === 0) {
      return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };
    }

    if (!shouldVirtualize) {
      return { start: 0, end: count, topSpacer: 0, bottomSpacer: 0 };
    }

    const visibleCount = Math.max(1, Math.ceil((viewportHeight || 800) / VIRTUAL_ROW_HEIGHT));
    const roughStart = Math.floor(scrollTop / VIRTUAL_ROW_HEIGHT);
    const start = Math.max(0, roughStart - VIRTUAL_OVERSCAN);
    const end = Math.min(count, roughStart + visibleCount + VIRTUAL_OVERSCAN);
    const topSpacer = start * VIRTUAL_ROW_HEIGHT;
    const bottomSpacer = Math.max(0, (count - end) * VIRTUAL_ROW_HEIGHT);
    return { start, end, topSpacer, bottomSpacer };
  }, [grouped.length, scrollTop, shouldVirtualize, viewportHeight]);

  const visibleGrouped = grouped.slice(virtual.start, virtual.end);

  const resolveCardName = (payload: Record<string, unknown>): string => {
    const cardId = normalizeId(payload.card_id);
    if (!cardId) return "-";
    return cardNameById[cardId] ?? "Unknown card";
  };

  const openPayloadJson = (title: string, payload: Record<string, unknown>) => {
    const json = JSON.stringify(payload, null, 2);
    setLineJsonModal({
      open: true,
      title,
      json,
    });
  };

  const toggleExpanded = (transactionId: string) => {
    setExpandedTxIds((current) => ({
      ...current,
      [transactionId]: !current[transactionId],
    }));
  };

  const accountLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    sourceAccounts.forEach((account) => {
      map[account.id] = normalizeId(account.account_label) ?? "Account";
    });
    return map;
  }, [sourceAccounts]);

  const applyCardRemap = async (cardId: string) => {
    const mapping = cardMappings.find((item) => item.cardId === cardId);
    if (!mapping || mapping.targetAccountId === mapping.currentAccountId) return;

    const supabase = createClient();
    setRemapPendingCardId(cardId);
    try {
      const { data, error: remapError } = await supabase.rpc("money_reassign_card_account", {
        p_card_id: cardId,
        p_target_account_id: mapping.targetAccountId,
      });
      if (remapError) throw new Error(remapError.message);

      const resultRow = Array.isArray(data) ? asRecord(data[0]) : asRecord(data);
      const movedTransactionsCount = parseFiniteNumber(resultRow.moved_transactions_count) ?? 0;
      const merged = Boolean(resultRow.merged);

      toast.success(
        merged
          ? `Card merged. Updated ${movedTransactionsCount} transactions.`
          : `Card reassigned. Updated ${movedTransactionsCount} transactions.`,
      );
      setRefreshTick((current) => current + 1);
    } catch (remapError) {
      toast.error(
        remapError instanceof Error ? remapError.message : "Failed to remap card to account",
      );
    } finally {
      setRemapPendingCardId(null);
    }
  };

  const handleApplyBatch = async () => {
    if (!batchId) return;
    setReviewActionPending("apply");
    try {
      const accessToken = await getAccessToken();
      await callMoneyImportAction<MoneyImportApplyBatchResult>(
        {
          action: "apply_batch",
          batch_id: batchId,
        },
        accessToken,
      );
      toast.success("Batch applied.");
      setRefreshTick((current) => current + 1);
    } catch (applyError) {
      toast.error(applyError instanceof Error ? applyError.message : "Failed to apply batch");
    } finally {
      setReviewActionPending(null);
    }
  };

  const handleDiscardBatch = async () => {
    if (!batchId) return;
    setReviewActionPending("discard");
    try {
      const accessToken = await getAccessToken();
      await callMoneyImportAction<MoneyImportDiscardBatchResult>(
        {
          action: "discard_batch",
          batch_id: batchId,
        },
        accessToken,
      );
      toast.success("Batch marked as not applied.");
      setRefreshTick((current) => current + 1);
    } catch (discardError) {
      toast.error(discardError instanceof Error ? discardError.message : "Failed to discard batch");
    } finally {
      setReviewActionPending(null);
    }
  };

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
    <div className="space-y-6 max-w-7xl">
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
        <CardContent className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
          <div>{`Batch: ${batch.id}`}</div>
          <div>{`Source: ${batch.source}`}</div>
          <div>{`Status: ${batch.status}`}</div>
          <div>{`Parsed rows: ${batch.parsed_transactions_count}`}</div>
          {batch.completed_at && (
            <div>{`Completed: ${format(new Date(batch.completed_at), "dd.MM.yyyy HH:mm")}`}</div>
          )}
        </CardContent>
      </Card>

      {isPendingReview && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex flex-col gap-3 p-4">
            <p className="text-sm text-amber-950">{t("money.importPendingReviewBanner")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void handleApplyBatch()}
                disabled={reviewActionPending !== null}
              >
                {reviewActionPending === "apply"
                  ? t("common.loading")
                  : t("money.importApplyBatch")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleDiscardBatch()}
                disabled={reviewActionPending !== null}
              >
                {reviewActionPending === "discard"
                  ? t("common.loading")
                  : t("money.importDiscardBatch")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isDiscarded && (
        <Card className="border-slate-300 bg-slate-50">
          <CardContent className="p-4 text-sm text-slate-700">
            {t("money.importDiscardedBanner")}
          </CardContent>
        </Card>
      )}

      {hasDomFallbackWarning && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-950">
            Warning: some TBank Web transactions were imported using DOM fallback. Verify amounts,
            merchants, and line items before trusting the result.
          </CardContent>
        </Card>
      )}

      {showCardMapping && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Card mapping</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {cardMappings.map((mapping) => (
              <div
                key={mapping.cardId}
                className="grid gap-3 rounded-md border p-3 md:grid-cols-[180px_1fr_220px_auto] md:items-center"
              >
                <div className="text-sm font-medium">{mapping.cardLabel}</div>
                <div className="text-sm text-muted-foreground">
                  {`Current: ${mapping.currentAccountLabel}`}
                </div>
                <select
                  data-testid={`card-remap-select-${mapping.cardId}`}
                  value={mapping.targetAccountId}
                  onChange={(event) => {
                    const nextTargetAccountId = event.target.value;
                    setCardMappings((current) =>
                      current.map((item) =>
                        item.cardId === mapping.cardId
                          ? { ...item, targetAccountId: nextTargetAccountId }
                          : item,
                      ),
                    );
                  }}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {sourceAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {accountLabelById[account.id] ?? "Account"}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  data-testid={`card-remap-apply-${mapping.cardId}`}
                  disabled={
                    remapPendingCardId === mapping.cardId ||
                    mapping.targetAccountId === mapping.currentAccountId
                  }
                  onClick={() => void applyCardRemap(mapping.cardId)}
                >
                  {remapPendingCardId === mapping.cardId ? t("common.loading") : "Apply"}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("money.importResultStatus")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {grouped.length === 0 && (
            <p className="text-sm text-muted-foreground">No rows imported for this batch.</p>
          )}

          {grouped.length > 0 && (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <div
                className={`grid min-w-[1130px] ${REPORT_GRID_COLUMNS} items-center gap-x-3 border-b bg-muted/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}
                data-testid="report-table-header-row"
              >
                <div>Date</div>
                <div className="text-center">Status</div>
                <div className="text-right">Amount</div>
                <div className="text-right">Cashback</div>
                <div>Card</div>
                <div>Details</div>
                <div className="text-right">Line items</div>
              </div>

              <div
                ref={listRef}
                className="max-h-[72vh] min-w-[1130px] overflow-y-auto bg-background"
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                data-testid="report-table-scroll-body"
              >
                {virtual.topSpacer > 0 && <div style={{ height: `${virtual.topSpacer}px` }} />}

                {visibleGrouped.map(({ tx, lines }, index) => {
                  const payload = asRecord(tx.payload);
                  const txAmountValue = parseFiniteNumber(payload.amount);
                  const txCashbackValue = parseFiniteNumber(payload.cashback_amount);
                  const merchant =
                    typeof payload.merchant_name === "string" && payload.merchant_name.trim()
                      ? payload.merchant_name.trim()
                      : "—";
                  const txComment =
                    typeof payload.comment === "string" && payload.comment.trim()
                      ? payload.comment.trim()
                      : typeof tx.message === "string" && tx.message.trim()
                        ? tx.message.trim()
                        : "—";
                  const isExpanded = Boolean(expandedTxIds[tx.id]);
                  const lineItemsLabel = `Line items (${lines.length})`;
                  const rowTone = index % 2 === 0 ? "bg-background" : "bg-muted/10";

                  return (
                    <section key={tx.id} className={`border-b ${rowTone}`}>
                      <div
                        className={`grid ${REPORT_GRID_COLUMNS} items-start gap-x-3 px-4 py-3 text-sm`}
                      >
                        <div className="tabular-nums text-xs text-muted-foreground">
                          {formatDateTime(payload.posted_at)}
                        </div>

                        <div className="flex justify-center">
                          <RowStatusBadge status={tx.status} t={t} />
                        </div>

                        <div
                          className={`text-right font-semibold tabular-nums ${
                            txAmountValue === null
                              ? "text-foreground"
                              : txAmountValue < 0
                                ? "text-rose-700"
                                : "text-emerald-700"
                          }`}
                        >
                          {formatAmountCurrency(payload.amount, payload.currency)}
                        </div>

                        <div
                          className={`text-right tabular-nums ${
                            txCashbackValue === null
                              ? "text-muted-foreground"
                              : txCashbackValue === 0
                                ? "text-muted-foreground"
                                : "text-emerald-700"
                          }`}
                        >
                          {formatAmountCurrency(
                            payload.cashback_amount,
                            payload.cashback_currency ?? payload.currency,
                          )}
                        </div>

                        <div className="truncate text-sm">{resolveCardName(payload)}</div>

                        <div className="min-w-0">
                          <div className="truncate font-medium">{merchant}</div>
                          <div className="mt-1 text-muted-foreground">{txComment}</div>
                        </div>

                        <div className="flex justify-end">
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() =>
                                openPayloadJson(`Transaction payload: ${merchant}`, payload)
                              }
                            >
                              JSON
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 gap-1 px-2 text-xs"
                              onClick={() => toggleExpanded(tx.id)}
                              disabled={lines.length === 0}
                              aria-label={lineItemsLabel}
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                              <span>{lineItemsLabel}</span>
                            </Button>
                          </div>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t bg-muted/20 px-2 py-2">
                          <div className="space-y-1">
                            {lines.map((line, lineIndex) => {
                              const linePayload = asRecord(line.payload);
                              const lineAmountValue = parseFiniteNumber(linePayload.amount);
                              const lineCashbackValue = parseFiniteNumber(
                                linePayload.cashback_amount,
                              );
                              const lineTitle =
                                typeof linePayload.title === "string" && linePayload.title.trim()
                                  ? linePayload.title.trim()
                                  : "Line item";
                              const lineComment =
                                typeof linePayload.comment === "string" &&
                                linePayload.comment.trim()
                                  ? linePayload.comment.trim()
                                  : "";
                              const qtyUnit = formatQtyUnit(linePayload.quantity, linePayload.unit);
                              const lineNumber =
                                typeof line.source_line_index === "number"
                                  ? line.source_line_index
                                  : lineIndex + 1;

                              return (
                                <div
                                  key={line.id}
                                  className={`grid ${REPORT_GRID_COLUMNS} items-start gap-x-3 rounded px-2 py-2 text-sm ${
                                    lineIndex % 2 === 0 ? "bg-background" : "bg-muted/20"
                                  }`}
                                >
                                  <div className="text-xs font-medium text-muted-foreground">{`Line ${lineNumber}`}</div>

                                  <div className="flex justify-center">
                                    <RowStatusBadge status={line.status} t={t} />
                                  </div>

                                  <div
                                    className={`text-right font-semibold tabular-nums ${
                                      lineAmountValue === null
                                        ? "text-foreground"
                                        : lineAmountValue < 0
                                          ? "text-rose-700"
                                          : "text-emerald-700"
                                    }`}
                                  >
                                    {formatAmountCurrency(
                                      linePayload.amount,
                                      linePayload.currency ?? payload.currency,
                                    )}
                                  </div>

                                  <div
                                    className={`text-right tabular-nums ${
                                      lineCashbackValue === null
                                        ? "text-muted-foreground"
                                        : lineCashbackValue === 0
                                          ? "text-muted-foreground"
                                          : "text-emerald-700"
                                    }`}
                                  >
                                    {formatAmountCurrency(
                                      linePayload.cashback_amount,
                                      linePayload.cashback_currency ??
                                        linePayload.currency ??
                                        payload.currency,
                                    )}
                                  </div>

                                  <div className="text-xs text-muted-foreground">{qtyUnit}</div>

                                  <div className="min-w-0">
                                    <div className="truncate font-medium">{lineTitle}</div>
                                    {lineComment && (
                                      <div className="mt-1 text-muted-foreground">
                                        {lineComment}
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex justify-end">
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={() =>
                                        openPayloadJson(`Line payload: ${lineTitle}`, linePayload)
                                      }
                                    >
                                      JSON
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </section>
                  );
                })}

                {virtual.bottomSpacer > 0 && (
                  <div style={{ height: `${virtual.bottomSpacer}px` }} />
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={lineJsonModal.open}
        onOpenChange={(open) => setLineJsonModal((current) => ({ ...current, open }))}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{lineJsonModal.title}</DialogTitle>
            <DialogDescription>Import payload JSON</DialogDescription>
          </DialogHeader>
          <pre className="max-h-[70vh] overflow-auto rounded border bg-muted/40 p-3 text-xs">
            {lineJsonModal.json}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
