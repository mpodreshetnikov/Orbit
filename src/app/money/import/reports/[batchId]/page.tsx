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
  MoneyImportBatchBrandResolution,
  MoneyImportBatchRow,
  MoneyImportDiscardBatchResult,
  MoneyImportRemapPreviewCardResult,
  MoneyImportUpdateBrandResolutionResult,
  MoneyTransactionBrand,
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
const VIRTUAL_LINE_ROW_HEIGHT = 64;
const VIRTUAL_EXPANDED_PADDING = 24;
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

function hasReceiptSkippedMarker(row: MoneyImportBatchRow): boolean {
  if (row.row_kind !== "transaction") return false;
  if (
    row.receipt_enrichment_status === "rate_limited" ||
    row.receipt_enrichment_status === "skipped_after_budget"
  ) {
    return true;
  }

  const payload = asRecord(row.payload);
  if (
    payload.receipt_enrichment_status === "rate_limited" ||
    payload.receipt_enrichment_status === "skipped_after_budget" ||
    payload.receipt_line_items_skipped === true
  ) {
    return true;
  }

  const rawPayload = asRecord(payload.raw_payload);
  const enrichment = asRecord(rawPayload.enrichment);
  const shoppingReceipt = asRecord(enrichment.shopping_receipt);
  return shoppingReceipt.line_items_skipped === true;
}

function readReceiptEnrichmentStatus(row: MoneyImportBatchRow): string | null {
  if (typeof row.receipt_enrichment_status === "string" && row.receipt_enrichment_status.trim()) {
    return row.receipt_enrichment_status.trim();
  }

  const payload = asRecord(row.payload);
  if (
    typeof payload.receipt_enrichment_status === "string" &&
    payload.receipt_enrichment_status.trim()
  ) {
    return payload.receipt_enrichment_status.trim();
  }

  const rawPayload = asRecord(payload.raw_payload);
  const enrichment = asRecord(rawPayload.enrichment);
  const shoppingReceipt = asRecord(enrichment.shopping_receipt);
  return typeof shoppingReceipt.status === "string" && shoppingReceipt.status.trim()
    ? shoppingReceipt.status.trim()
    : null;
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

function readSourceCategoryName(payload: Record<string, unknown>): string | null {
  const direct =
    typeof payload.source_category_name === "string" ? payload.source_category_name : null;
  if (direct?.trim()) return direct.trim();
  const sourceCategory = asRecord(payload.source_category);
  const nested = typeof sourceCategory.name === "string" ? sourceCategory.name : null;
  return nested?.trim() || null;
}

function readSourceBrandName(payload: Record<string, unknown>): string | null {
  const sourceBrand = asRecord(payload.source_brand);
  const nested = typeof sourceBrand.name === "string" ? sourceBrand.name : null;
  return nested?.trim() || null;
}

function readOperationIconUrl(payload: Record<string, unknown>): string | null {
  const value = typeof payload.operation_icon_url === "string" ? payload.operation_icon_url : null;
  return value?.trim() || null;
}

function isFilteredBySelectedRange(row: MoneyImportBatchRow): boolean {
  return (
    row.message === "Outside selected import range" ||
    row.message === "Invalid posted_at for selected import range"
  );
}

function formatRangeSummary(windowFrom: string | null, windowTo: string | null): string {
  if (!windowFrom || !windowTo) return "-";
  return `${format(new Date(windowFrom), "dd.MM.yyyy HH:mm")} -> ${format(
    new Date(windowTo),
    "dd.MM.yyyy HH:mm",
  )}`;
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

type EditableBrandResolution = MoneyImportBatchBrandResolution;

export default function MoneyImportReportPage() {
  const params = useParams<{ batchId: string }>();
  const batchId = params?.batchId;
  const t = useTranslations();

  const [batch, setBatch] = useState<MoneyImportBatch | null>(null);
  const [rows, setRows] = useState<MoneyImportBatchRow[]>([]);
  const [brandResolutions, setBrandResolutions] = useState<EditableBrandResolution[]>([]);
  const [brands, setBrands] = useState<MoneyTransactionBrand[]>([]);
  const [cardNameById, setCardNameById] = useState<Record<string, string>>({});
  const [sourceAccounts, setSourceAccounts] = useState<SourceAccountOption[]>([]);
  const [cardMappings, setCardMappings] = useState<CardMappingOption[]>([]);
  const [remapPendingCardId, setRemapPendingCardId] = useState<string | null>(null);
  const [brandResolutionPendingId, setBrandResolutionPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewActionPending, setReviewActionPending] = useState<"apply" | "discard" | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [expandedTxIds, setExpandedTxIds] = useState<Record<string, boolean>>({});
  const [measuredRowHeights, setMeasuredRowHeights] = useState<Record<string, number>>({});
  const [showNewBrandResolutions, setShowNewBrandResolutions] = useState(false);
  const [showFilteredRows, setShowFilteredRows] = useState(false);
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
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});

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

      const [brandResolutionsResponse, brandsResponse] = await Promise.all([
        supabase
          .from("money_import_batch_brand_resolutions")
          .select("*")
          .eq("batch_id", batchId)
          .order("source_name", { ascending: true }),
        supabase.from("money_transaction_brands").select("*").order("name", { ascending: true }),
      ]);

      if (brandResolutionsResponse.error || brandsResponse.error) {
        if (!cancelled) {
          setError(
            brandResolutionsResponse.error?.message ??
              brandsResponse.error?.message ??
              "Load failed",
          );
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
        setBrandResolutions((brandResolutionsResponse.data ?? []) as EditableBrandResolution[]);
        setBrands((brandsResponse.data ?? []) as MoneyTransactionBrand[]);
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

  const visibleGroupedForFilter = useMemo(
    () => grouped.filter((group) => showFilteredRows || !isFilteredBySelectedRange(group.tx)),
    [grouped, showFilteredRows],
  );

  const isPendingReview = batch?.status === "pending";
  const isDiscarded = batch?.status === "discarded";
  const showCardMapping = cardMappings.length > 0 && !isDiscarded;
  const hasDomFallbackWarning = useMemo(
    () => batch?.source === "tbank_web" && rows.some((row) => hasDomFallbackMarker(row)),
    [batch?.source, rows],
  );
  const transactionsWithoutFullDetailsCount = useMemo(
    () => rows.filter((row) => hasReceiptSkippedMarker(row)).length,
    [rows],
  );
  const hasReceiptSkippedWarning = useMemo(
    () => batch?.source === "tbank_web" && transactionsWithoutFullDetailsCount > 0,
    [batch?.source, transactionsWithoutFullDetailsCount],
  );
  const transactionsWithoutFullDetailsLabel =
    transactionsWithoutFullDetailsCount === 1 ? "transaction" : "transactions";
  const transactionsWithoutFullDetailsVerb =
    transactionsWithoutFullDetailsCount === 1 ? "was" : "were";
  const receiptWarningMessage = `Warning: ${transactionsWithoutFullDetailsCount} TBank Web ${transactionsWithoutFullDetailsLabel} ${transactionsWithoutFullDetailsVerb} imported without full details because receipt line items were skipped due to TBank rate limiting. You can retry receipt enrichment later.`;
  const summaryWithoutFullDetails =
    transactionsWithoutFullDetailsCount > 0
      ? `Transactions without full details: ${transactionsWithoutFullDetailsCount}`
      : null;
  const shouldVirtualize = visibleGroupedForFilter.length >= VIRTUAL_ROW_THRESHOLD;

  const virtual = useMemo(() => {
    const count = visibleGroupedForFilter.length;
    if (count === 0) {
      return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };
    }

    if (!shouldVirtualize) {
      return { start: 0, end: count, topSpacer: 0, bottomSpacer: 0 };
    }

    const viewportBottom = scrollTop + (viewportHeight || 800);
    const offsets = new Array<number>(count + 1).fill(0);

    for (let index = 0; index < count; index += 1) {
      const group = visibleGroupedForFilter[index]!;
      const isExpanded = Boolean(expandedTxIds[group.tx.id]);
      const estimatedHeight =
        VIRTUAL_ROW_HEIGHT +
        (isExpanded ? group.lines.length * VIRTUAL_LINE_ROW_HEIGHT + VIRTUAL_EXPANDED_PADDING : 0);
      const measuredHeight = measuredRowHeights[group.tx.id];
      offsets[index + 1] = offsets[index]! + (measuredHeight ?? estimatedHeight);
    }

    let start = 0;
    while (start < count && offsets[start + 1]! <= scrollTop) {
      start += 1;
    }
    start = Math.max(0, start - VIRTUAL_OVERSCAN);

    let end = start;
    while (end < count && offsets[end]! < viewportBottom) {
      end += 1;
    }
    end = Math.min(count, end + VIRTUAL_OVERSCAN);

    const topSpacer = offsets[start]!;
    const bottomSpacer = Math.max(0, offsets[count]! - offsets[end]!);
    return { start, end, topSpacer, bottomSpacer };
  }, [
    expandedTxIds,
    measuredRowHeights,
    scrollTop,
    shouldVirtualize,
    viewportHeight,
    visibleGroupedForFilter,
  ]);

  const visibleGrouped = useMemo(
    () => visibleGroupedForFilter.slice(virtual.start, virtual.end),
    [virtual.end, virtual.start, visibleGroupedForFilter],
  );

  useEffect(() => {
    if (visibleGrouped.length === 0) return;

    const nextMeasurements: Record<string, number> = {};
    visibleGrouped.forEach(({ tx }) => {
      const height = rowRefs.current[tx.id]?.offsetHeight ?? 0;
      if (height > 0) {
        nextMeasurements[tx.id] = height;
      }
    });

    if (Object.keys(nextMeasurements).length === 0) return;

    setMeasuredRowHeights((current) => {
      let changed = false;
      const next = { ...current };
      Object.entries(nextMeasurements).forEach(([txId, height]) => {
        if (next[txId] !== height) {
          next[txId] = height;
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [expandedTxIds, visibleGrouped]);

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

  const batchMeta = useMemo(() => asRecord(batch?.meta), [batch?.meta]);
  const rangeSelectionMeta = useMemo(() => asRecord(batchMeta.range_selection_meta), [batchMeta]);
  const parsedRowCount =
    parseFiniteNumber(batchMeta.parsed_row_count) ?? batch?.parsed_transactions_count ?? 0;
  const inRangeRowCount =
    parseFiniteNumber(batchMeta.in_range_row_count) ?? batch?.inserted_count ?? 0;
  const filteredOutOfRangeCount = parseFiniteNumber(batchMeta.filtered_out_of_range_count) ?? 0;
  const filteredInvalidDateCount = parseFiniteNumber(batchMeta.filtered_invalid_date_count) ?? 0;
  const selectionMode = normalizeId(rangeSelectionMeta.selection_mode);
  const presetKey = normalizeId(rangeSelectionMeta.preset_key);
  const completenessMeta = useMemo(() => asRecord(batchMeta.import_completeness), [batchMeta]);
  // A window the connector could not fully read must say so here. Silence would let a
  // partly loaded period pass as closed, and nobody comes back to a period that looks done.
  const isPartialWindow = completenessMeta.partial === true;
  const truncationUnresolvedCount =
    parseFiniteNumber(completenessMeta.truncation_unresolved_count) ?? 0;

  const brandNameById = useMemo(() => {
    const map: Record<string, string> = {};
    brands.forEach((brand) => {
      map[brand.id] = brand.name;
    });
    return map;
  }, [brands]);

  const standardBrandResolutions = useMemo(
    () => brandResolutions.filter((resolution) => (resolution.suggested_confidence ?? 0) > 0),
    [brandResolutions],
  );
  const newBrandResolutions = useMemo(
    () => brandResolutions.filter((resolution) => (resolution.suggested_confidence ?? 0) === 0),
    [brandResolutions],
  );

  const applyCardRemap = async (cardId: string) => {
    const mapping = cardMappings.find((item) => item.cardId === cardId);
    if (!mapping || mapping.targetAccountId === mapping.currentAccountId) return;

    setRemapPendingCardId(cardId);
    try {
      if (isPendingReview) {
        const accessToken = await getAccessToken();
        await callMoneyImportAction<MoneyImportRemapPreviewCardResult>(
          {
            action: "remap_preview_card",
            batch_id: batchId ?? "",
            card_id: cardId,
            target_account_id: mapping.targetAccountId,
          },
          accessToken,
        );
        toast.success("Preview card mapping updated.");
      } else {
        const supabase = createClient();
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
      }
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

  const handleSaveBrandResolution = async (resolution: EditableBrandResolution) => {
    if (!resolution.id) return;
    if (
      resolution.selected_action === "match_existing" &&
      !normalizeId(resolution.selected_brand_id)
    ) {
      return;
    }

    setBrandResolutionPendingId(resolution.id);
    try {
      const accessToken = await getAccessToken();
      const payload = await callMoneyImportAction<MoneyImportUpdateBrandResolutionResult>(
        {
          action: "update_brand_resolution",
          resolution_id: resolution.id,
          selected_action: resolution.selected_action,
          selected_brand_id:
            resolution.selected_action === "match_existing"
              ? normalizeId(resolution.selected_brand_id)
              : null,
        },
        accessToken,
      );

      setBrandResolutions((current) =>
        current.map((item) =>
          item.id === resolution.id
            ? {
                ...item,
                selected_action: payload.selected_action,
                selected_brand_id: payload.selected_brand_id,
              }
            : item,
        ),
      );
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : "Failed to save brand resolution",
      );
    } finally {
      setBrandResolutionPendingId(null);
    }
  };

  const updateBrandResolution = (nextResolution: EditableBrandResolution) => {
    setBrandResolutions((current) =>
      current.map((item) => (item.id === nextResolution.id ? nextResolution : item)),
    );
    void handleSaveBrandResolution(nextResolution);
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
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">{t("money.importResultsTitle")}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" asChild>
            <Link href="/money/import/history">{t("money.importViewHistory")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/money/import" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t("money.importAnotherFile")}
            </Link>
          </Button>
        </div>
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
          <div>{`Parsed rows: ${parsedRowCount}`}</div>
          <div>{`Selected range: ${formatRangeSummary(batch.window_from, batch.window_to)}`}</div>
          <div>{`Range mode: ${selectionMode ?? "-"}${presetKey ? ` (${presetKey})` : ""}`}</div>
          <div>{`Imported / in range: ${inRangeRowCount}`}</div>
          <div>{`Filtered out of range: ${filteredOutOfRangeCount}`}</div>
          <div>{`Invalid date rows: ${filteredInvalidDateCount}`}</div>
          {summaryWithoutFullDetails && <div>{summaryWithoutFullDetails}</div>}
          {isPartialWindow && (
            <div
              className="sm:col-span-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400"
              data-testid="import-partial-window-warning"
            >
              {t("money.importPartialWindowWarning", { count: truncationUnresolvedCount })}
            </div>
          )}
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

      {isPendingReview && brandResolutions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Brand review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {standardBrandResolutions.map((resolution) => {
              const suggestedBrandName = resolution.suggested_brand_id
                ? (brandNameById[resolution.suggested_brand_id] ?? "Unknown brand")
                : null;
              return (
                <div key={resolution.id} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {resolution.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element -- imported source brand logos are arbitrary remote URLs
                        <img
                          src={resolution.logo_url}
                          alt={`${resolution.source_name} logo`}
                          className="h-8 w-8 shrink-0 rounded object-contain"
                        />
                      ) : null}
                      <div>
                        <div className="font-medium">{resolution.source_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {`Confidence: ${resolution.suggested_confidence}`}
                        </div>
                        {suggestedBrandName ? (
                          <div className="text-sm text-muted-foreground">{suggestedBrandName}</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {resolution.suggested_reason ?? "create_new"}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-[220px_minmax(0,1fr)_auto] md:items-center">
                    <select
                      data-testid={`brand-resolution-action-${resolution.id}`}
                      value={resolution.selected_action}
                      disabled={brandResolutionPendingId === resolution.id}
                      onChange={(event) => {
                        const nextAction = event.target
                          .value as EditableBrandResolution["selected_action"];
                        updateBrandResolution({
                          ...resolution,
                          selected_action: nextAction,
                          selected_brand_id:
                            nextAction === "match_existing"
                              ? (resolution.selected_brand_id ?? resolution.suggested_brand_id)
                              : null,
                        });
                      }}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="create_new">Create new canonical brand</option>
                      <option value="match_existing">Match existing canonical brand</option>
                    </select>

                    <select
                      data-testid={`brand-resolution-brand-${resolution.id}`}
                      value={resolution.selected_brand_id ?? ""}
                      disabled={
                        resolution.selected_action !== "match_existing" ||
                        brandResolutionPendingId === resolution.id
                      }
                      onChange={(event) => {
                        const nextBrandId = event.target.value || null;
                        updateBrandResolution({
                          ...resolution,
                          selected_brand_id: nextBrandId,
                        });
                      }}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                    >
                      <option value="">Select canonical brand</option>
                      {brands.map((brand) => (
                        <option key={brand.id} value={brand.id}>
                          {brand.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}

            {newBrandResolutions.length > 0 && (
              <div className="rounded-md border border-dashed">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium"
                  onClick={() => setShowNewBrandResolutions((current) => !current)}
                  aria-expanded={showNewBrandResolutions}
                >
                  <span>{`New Brands to review (${newBrandResolutions.length})`}</span>
                  {showNewBrandResolutions ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {showNewBrandResolutions && (
                  <div className="space-y-3 border-t px-3 py-3">
                    {newBrandResolutions.map((resolution) => {
                      const suggestedBrandName = resolution.suggested_brand_id
                        ? (brandNameById[resolution.suggested_brand_id] ?? "Unknown brand")
                        : null;
                      return (
                        <div key={resolution.id} className="rounded-md border p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              {resolution.logo_url ? (
                                // eslint-disable-next-line @next/next/no-img-element -- imported source brand logos are arbitrary remote URLs
                                <img
                                  src={resolution.logo_url}
                                  alt={`${resolution.source_name} logo`}
                                  className="h-8 w-8 shrink-0 rounded object-contain"
                                />
                              ) : null}
                              <div>
                                <div className="font-medium">{resolution.source_name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {`Confidence: ${resolution.suggested_confidence}`}
                                </div>
                                {suggestedBrandName ? (
                                  <div className="text-sm text-muted-foreground">
                                    {suggestedBrandName}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {resolution.suggested_reason ?? "create_new"}
                            </div>
                          </div>

                          <div className="mt-3 grid gap-2 md:grid-cols-[220px_240px_auto] md:items-center">
                            <select
                              data-testid={`brand-resolution-action-${resolution.id}`}
                              value={resolution.selected_action}
                              disabled={brandResolutionPendingId === resolution.id}
                              onChange={(event) => {
                                const nextAction = event.target.value as
                                  | "create_new"
                                  | "match_existing";
                                updateBrandResolution({
                                  ...resolution,
                                  selected_action: nextAction,
                                  selected_brand_id:
                                    nextAction === "match_existing"
                                      ? (resolution.selected_brand_id ??
                                        resolution.suggested_brand_id)
                                      : null,
                                });
                              }}
                              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                            >
                              <option value="create_new">Create new canonical brand</option>
                              <option value="match_existing">Match existing canonical brand</option>
                            </select>

                            <select
                              data-testid={`brand-resolution-brand-${resolution.id}`}
                              value={resolution.selected_brand_id ?? ""}
                              disabled={
                                resolution.selected_action !== "match_existing" ||
                                brandResolutionPendingId === resolution.id
                              }
                              onChange={(event) => {
                                const nextBrandId = event.target.value || null;
                                updateBrandResolution({
                                  ...resolution,
                                  selected_brand_id: nextBrandId,
                                });
                              }}
                              className="h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"
                            >
                              <option value="">Select canonical brand</option>
                              {brands.map((brand) => (
                                <option key={brand.id} value={brand.id}>
                                  {brand.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
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

      {hasReceiptSkippedWarning && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4 text-sm text-amber-950">{receiptWarningMessage}</CardContent>
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
          {(filteredOutOfRangeCount > 0 || filteredInvalidDateCount > 0) && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowFilteredRows((current) => !current)}
            >
              {showFilteredRows ? "Hide filtered rows" : "Show filtered rows"}
            </Button>
          )}

          {visibleGroupedForFilter.length === 0 && (
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
                  const sourceCategoryName = readSourceCategoryName(payload);
                  const sourceBrandName = readSourceBrandName(payload);
                  const operationIconUrl = readOperationIconUrl(payload);
                  const receiptEnrichmentStatus = readReceiptEnrichmentStatus(tx);
                  const hasReceiptSkipped = hasReceiptSkippedMarker(tx);
                  const isExpanded = Boolean(expandedTxIds[tx.id]);
                  const lineItemsLabel = `Line items (${lines.length})`;
                  const rowTone = index % 2 === 0 ? "bg-background" : "bg-muted/10";

                  return (
                    <section
                      key={tx.id}
                      ref={(node) => {
                        rowRefs.current[tx.id] = node;
                      }}
                      className={`border-b ${rowTone}`}
                    >
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
                          <div className="flex items-center gap-2">
                            {operationIconUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element -- imported source icons are arbitrary remote URLs
                              <img
                                src={operationIconUrl}
                                alt=""
                                className="h-5 w-5 shrink-0 rounded object-contain"
                              />
                            ) : null}
                            <div className="truncate font-medium">{merchant}</div>
                          </div>
                          <div className="mt-1 text-muted-foreground">{txComment}</div>
                          {sourceBrandName || sourceCategoryName ? (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              {sourceBrandName ? <span>{sourceBrandName}</span> : null}
                              {sourceCategoryName ? <span>{sourceCategoryName}</span> : null}
                            </div>
                          ) : null}
                          {hasReceiptSkipped ? (
                            <div className="mt-2">
                              <Badge
                                variant="outline"
                                className="border-amber-300 bg-amber-50 text-amber-950"
                              >
                                {receiptEnrichmentStatus === "rate_limited" ||
                                receiptEnrichmentStatus === "skipped_after_budget"
                                  ? "Receipt line items skipped (rate limited)"
                                  : "Receipt line items skipped"}
                              </Badge>
                            </div>
                          ) : null}
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
