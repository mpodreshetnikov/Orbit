#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type FailureCategory =
  | "AUTH_BLOCKED"
  | "API_DISCOVERY_MISSED"
  | "API_4XX_5XX"
  | "DOM_SELECTOR_DRIFT"
  | "ENRICHMENT_RATE_LIMITED"
  | "MAPPING_DROP";

interface ParsedArgs {
  artifactPath?: string;
  outputPath?: string;
  reportPath?: string;
  csvPath?: string;
  maxRows: number;
  printReport: boolean;
  sourceId: string;
}

interface AnalysisContext {
  artifact: Record<string, unknown>;
  artifactPath: string;
  artifactDir: string;
}

export interface TbankDebugDiagnostics {
  generated_at: string;
  artifact_path: string;
  rows_count: number;
  invalid_posted_at: number;
  rows_without_line_items: number;
  range_coverage: {
    window_from: string | null;
    parsed_through_at: string | null;
    window_to: string | null;
    covers_window_from: boolean;
  };
  api_vs_dom_used: {
    extraction_method: string | null;
    fallback_used: boolean | null;
    api_operation_count: number;
    mapped_row_count: number;
  };
  status_histogram: Record<string, number>;
  error_signatures: string[];
  mapping_drop_total: number;
  receipt_enrichment: {
    requested_count: number;
    success_count: number;
    rate_limited_count: number;
    skipped_after_budget_count: number;
    failed_count: number;
    retry_attempts_total: number;
    stopped_after_budget: boolean;
    base_pause_between_receipts_ms: number;
    line_items_skipped_count: number;
  };
  categories: FailureCategory[];
  passed: boolean;
}

function normalizeSourceKey(value: string): string {
  const normalized = value.trim().toLowerCase();
  const withoutSuffix = normalized.replace(/_web$/, "").replace(/-web$/, "");
  return withoutSuffix.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "source";
}

function toObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toIsoString(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeCurrencyCode(value: unknown): string | null {
  const text = normalizeText(value)?.toUpperCase() ?? null;
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    if (text === "643") return "RUB";
    if (text === "840") return "USD";
    if (text === "978") return "EUR";
  }
  const code = text.match(/[A-Z]{3}/);
  return code ? code[0] : null;
}

function extractOperationFromRow(row: Record<string, unknown>): Record<string, unknown> | null {
  return toObject(toObject(row.raw_payload)?.operation);
}

function deriveSourceComment(row: Record<string, unknown>): string | null {
  return (
    normalizeText(row.source_comment) ??
    normalizeText(row.comment) ??
    normalizeText(extractOperationFromRow(row)?.message) ??
    normalizeText(extractOperationFromRow(row)?.comment)
  );
}

function deriveCashbackAmount(row: Record<string, unknown>): number | null {
  const explicit = toNumber(row.cashback_amount);
  if (explicit !== null) return explicit;
  const operation = extractOperationFromRow(row);
  if (!operation) return null;

  const fromSummary = toNumber(toObject(operation.loyaltyBonusSummary)?.amount);
  if (fromSummary !== null) return fromSummary;

  const fromCashbackAmount = toNumber(toObject(operation.cashbackAmount)?.value);
  if (fromCashbackAmount !== null) return fromCashbackAmount;

  const fromCashback = toNumber(operation.cashback);
  if (fromCashback !== null) return fromCashback;

  const loyaltyBonus = Array.isArray(operation.loyaltyBonus) ? operation.loyaltyBonus : [];
  let sum = 0;
  let hasItems = false;
  for (const entry of loyaltyBonus) {
    const value = toNumber(toObject(toObject(entry)?.amount)?.value);
    if (value === null) continue;
    hasItems = true;
    sum += value;
  }
  return hasItems ? sum : null;
}

function deriveCashbackCurrency(
  row: Record<string, unknown>,
  cashbackAmount: number | null,
): string | null {
  const explicit = normalizeCurrencyCode(row.cashback_currency);
  if (explicit) return explicit;
  if (cashbackAmount === null) return null;

  const operation = extractOperationFromRow(row);
  const cashbackCurrency = toObject(toObject(operation?.cashbackAmount)?.currency);
  const loyaltyCurrency = toObject(toObject(operation?.loyaltyUnits)?.currency);
  return (
    normalizeCurrencyCode(cashbackCurrency?.strCode) ??
    normalizeCurrencyCode(cashbackCurrency?.name) ??
    normalizeCurrencyCode(cashbackCurrency?.code) ??
    normalizeCurrencyCode(loyaltyCurrency?.strCode) ??
    normalizeCurrencyCode(loyaltyCurrency?.name) ??
    normalizeCurrencyCode(loyaltyCurrency?.code) ??
    normalizeCurrencyCode(row.currency)
  );
}

function extractParseOutput(artifact: Record<string, unknown>): Record<string, unknown> | null {
  const direct = toObject(artifact.parse_output);
  if (direct) return direct;
  const runResponse = toObject(artifact.run_response);
  const result = toObject(runResponse?.result);
  return toObject(result?.parse_output);
}

function extractRows(artifact: Record<string, unknown>): Record<string, unknown>[] {
  const parseOutput = extractParseOutput(artifact);
  const rows = parseOutput?.["rows"];
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

function extractParseDebug(artifact: Record<string, unknown>): Record<string, unknown> {
  const parseOutput = extractParseOutput(artifact);
  return toObject(parseOutput?.["debug"]) ?? {};
}

function extractErrorSignatures(artifact: Record<string, unknown>): string[] {
  const signatures: string[] = [];
  const run = toObject(artifact.debug_run);
  const runContext = toObject(run?.run);
  const runError = runContext?.error_message;
  if (typeof runError === "string" && runError.trim()) {
    signatures.push(runError);
  }
  const events = Array.isArray(run?.events) ? run.events : [];
  for (const eventInput of events) {
    const event = toObject(eventInput);
    const attrs = toObject(event?.attrs);
    const errorMessage = attrs?.error_message;
    if (typeof errorMessage === "string" && errorMessage.trim()) {
      signatures.push(errorMessage);
    }
  }
  return Array.from(new Set(signatures));
}

function sumHistogramStatuses(histogram: Record<string, number>): number {
  let total = 0;
  for (const [statusCode, count] of Object.entries(histogram)) {
    const code = Number(statusCode);
    if (Number.isFinite(code) && code >= 400) {
      total += count;
    }
  }
  return total;
}

function countInvalidPostedAt(rows: Record<string, unknown>[]): number {
  let invalidCount = 0;
  for (const row of rows) {
    const iso = toIsoString(row.posted_at);
    if (!iso) invalidCount += 1;
  }
  return invalidCount;
}

function countRowsWithoutLineItems(rows: Record<string, unknown>[]): number {
  let count = 0;
  for (const row of rows) {
    const lineItems = row.line_items;
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
      count += 1;
    }
  }
  return count;
}

function countReceiptLineItemsSkipped(rows: Record<string, unknown>[]): number {
  let count = 0;
  for (const row of rows) {
    if (
      row.receipt_enrichment_status === "rate_limited" ||
      row.receipt_enrichment_status === "skipped_after_budget" ||
      row.receipt_line_items_skipped === true
    ) {
      count += 1;
      continue;
    }

    const payload = toObject(row.payload);
    if (
      payload?.receipt_enrichment_status === "rate_limited" ||
      payload?.receipt_enrichment_status === "skipped_after_budget" ||
      payload?.receipt_line_items_skipped === true
    ) {
      count += 1;
      continue;
    }

    const rawPayload = toObject(payload?.raw_payload);
    const enrichment = toObject(rawPayload?.enrichment);
    const shoppingReceipt = toObject(enrichment?.shopping_receipt);
    if (shoppingReceipt?.line_items_skipped === true) {
      count += 1;
    }
  }
  return count;
}

function includesAuthBlockedSignal(value: string): boolean {
  const text = value.toLowerCase();
  return (
    text.includes("unauthorized") ||
    text.includes("not authorized") ||
    text.includes("sign in") ||
    text.includes("captcha") ||
    text.includes("verify") ||
    text.includes("human verification")
  );
}

function resolveRangeCoverage(
  artifact: Record<string, unknown>,
  parsedThroughAt: string | null,
  windowTo: string | null,
): TbankDebugDiagnostics["range_coverage"] {
  const metadata = toObject(artifact.metadata);
  const run = toObject(artifact.debug_run);
  const runContext = toObject(run?.run);

  const windowFrom =
    toIsoString(metadata?.window_from) ||
    toIsoString(runContext?.window_from) ||
    toIsoString(toObject(artifact.run_response)?.windowFrom) ||
    null;

  const fromMs = toNumber(windowFrom ? new Date(windowFrom).getTime() : null);
  const throughMs = toNumber(parsedThroughAt ? new Date(parsedThroughAt).getTime() : null);

  return {
    window_from: windowFrom,
    parsed_through_at: parsedThroughAt,
    window_to: windowTo,
    covers_window_from:
      typeof fromMs === "number" &&
      Number.isFinite(fromMs) &&
      typeof throughMs === "number" &&
      Number.isFinite(throughMs)
        ? throughMs <= fromMs
        : false,
  };
}

export function analyzeArtifactBundle(
  artifact: Record<string, unknown>,
  artifactPath = "unknown",
): TbankDebugDiagnostics {
  const rows = extractRows(artifact);
  const parseDebug = extractParseDebug(artifact);
  const parseOutput = extractParseOutput(artifact);
  const histogram = (toObject(parseDebug.response_status_histogram) ?? {}) as Record<
    string,
    number
  >;
  const discoveredEndpoints = toObject(parseDebug.discovered_endpoints) ?? {};
  const extractionMethod =
    typeof parseDebug.extraction_method === "string" ? parseDebug.extraction_method : null;
  const fallbackUsed =
    typeof parseDebug.fallback_used === "boolean" ? parseDebug.fallback_used : null;
  const mappedRowCount = toNumber(parseDebug.mapped_row_count) ?? rows.length;
  const apiOperationCount = toNumber(parseDebug.api_operation_count) ?? 0;
  const mappingDropCounts = (toObject(parseDebug.mapping_drop_counts) ?? {}) as Record<
    string,
    number
  >;
  const mappingDropTotal = Object.values(mappingDropCounts).reduce(
    (sum, count) => sum + (Number.isFinite(count) ? count : 0),
    0,
  );
  const receiptEnrichmentDebug = toObject(parseDebug.receipt_enrichment) ?? {};
  const receiptLineItemsSkippedCount = countReceiptLineItemsSkipped(rows);

  const parsedThroughAt = toIsoString(parseOutput?.["parsedThroughAt"]) ?? null;
  const windowTo = toIsoString(parseOutput?.["windowTo"]) ?? null;

  const diagnostics: TbankDebugDiagnostics = {
    generated_at: new Date().toISOString(),
    artifact_path: artifactPath,
    rows_count: rows.length,
    invalid_posted_at: countInvalidPostedAt(rows),
    rows_without_line_items: countRowsWithoutLineItems(rows),
    range_coverage: resolveRangeCoverage(artifact, parsedThroughAt, windowTo),
    api_vs_dom_used: {
      extraction_method: extractionMethod,
      fallback_used: fallbackUsed,
      api_operation_count: apiOperationCount,
      mapped_row_count: mappedRowCount,
    },
    status_histogram: histogram,
    error_signatures: extractErrorSignatures(artifact),
    mapping_drop_total: mappingDropTotal,
    receipt_enrichment: {
      requested_count: toNumber(receiptEnrichmentDebug.requested_count) ?? 0,
      success_count: toNumber(receiptEnrichmentDebug.success_count) ?? 0,
      rate_limited_count: toNumber(receiptEnrichmentDebug.rate_limited_count) ?? 0,
      skipped_after_budget_count: toNumber(receiptEnrichmentDebug.skipped_after_budget_count) ?? 0,
      failed_count: toNumber(receiptEnrichmentDebug.failed_count) ?? 0,
      retry_attempts_total: toNumber(receiptEnrichmentDebug.retry_attempts_total) ?? 0,
      stopped_after_budget: receiptEnrichmentDebug.stopped_after_budget === true,
      base_pause_between_receipts_ms:
        toNumber(receiptEnrichmentDebug.base_pause_between_receipts_ms) ?? 0,
      line_items_skipped_count: receiptLineItemsSkippedCount,
    },
    categories: [],
    passed: true,
  };

  if (
    diagnostics.error_signatures.some((signature) => includesAuthBlockedSignal(signature)) ||
    includesAuthBlockedSignal(String(parseDebug.blocked_reason ?? ""))
  ) {
    diagnostics.categories.push("AUTH_BLOCKED");
  }

  if (extractionMethod === "dom" && typeof discoveredEndpoints.operations_api !== "string") {
    diagnostics.categories.push("API_DISCOVERY_MISSED");
  }

  if (sumHistogramStatuses(histogram) > 0) {
    diagnostics.categories.push("API_4XX_5XX");
  }

  if (extractionMethod === "dom" && rows.length === 0) {
    diagnostics.categories.push("DOM_SELECTOR_DRIFT");
  }

  if (
    diagnostics.receipt_enrichment.rate_limited_count > 0 ||
    diagnostics.receipt_enrichment.skipped_after_budget_count > 0 ||
    diagnostics.receipt_enrichment.line_items_skipped_count > 0
  ) {
    diagnostics.categories.push("ENRICHMENT_RATE_LIMITED");
  }

  if (
    mappingDropTotal > 0 ||
    diagnostics.invalid_posted_at > 0 ||
    diagnostics.rows_without_line_items > 0
  ) {
    diagnostics.categories.push("MAPPING_DROP");
  }

  diagnostics.categories = Array.from(new Set(diagnostics.categories));
  diagnostics.passed = diagnostics.categories.length === 0;
  return diagnostics;
}

async function resolveArtifactPath(
  candidatePath: string | undefined,
  sourceId: string,
): Promise<string> {
  const sourceKey = normalizeSourceKey(sourceId);
  const baseDir = path.resolve(process.cwd(), ".tmp", "scraper-debug", sourceKey);
  const resolveLatest = async (): Promise<string> => {
    const entries = await fs.readdir(baseDir, { withFileTypes: true }).catch(() => []);
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    if (directories.length === 0) {
      throw new Error(`No artifacts found in ${baseDir}`);
    }
    return path.join(baseDir, directories[0]);
  };

  if (candidatePath) {
    const resolvedCandidate = path.resolve(process.cwd(), candidatePath);
    const exists = await fs
      .stat(resolvedCandidate)
      .then(() => true)
      .catch(() => false);
    if (exists) {
      return resolvedCandidate;
    }
    process.stderr.write(
      `[analyze] Artifact path not found: ${resolvedCandidate}. Falling back to latest artifact.\n`,
    );
    return resolveLatest();
  }

  return resolveLatest();
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    maxRows: Number.MAX_SAFE_INTEGER,
    printReport: false,
    sourceId: "tbank_web",
  };
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--artifact" && argv[index + 1]) {
      parsed.artifactPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--output" && argv[index + 1]) {
      parsed.outputPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--report" && argv[index + 1]) {
      parsed.reportPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--csv" && argv[index + 1]) {
      parsed.csvPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (current === "--max-rows" && argv[index + 1]) {
      const parsedNumber = Number(argv[index + 1]);
      if (Number.isFinite(parsedNumber) && parsedNumber > 0) {
        parsed.maxRows = Math.max(1, Math.floor(parsedNumber));
      }
      index += 1;
      continue;
    }
    if (current === "--print-report") {
      parsed.printReport = true;
      continue;
    }
    if (current === "--source" && argv[index + 1]) {
      const sourceInput = argv[index + 1].trim();
      if (sourceInput) parsed.sourceId = sourceInput;
      index += 1;
    }
  }
  return parsed;
}

async function loadArtifactContext(
  candidatePath: string | undefined,
  sourceId: string,
): Promise<AnalysisContext> {
  const resolvedPath = await resolveArtifactPath(candidatePath, sourceId);
  const stats = await fs.stat(resolvedPath);
  if (stats.isFile()) {
    const raw = await fs.readFile(resolvedPath, "utf8");
    const artifact = JSON.parse(raw) as Record<string, unknown>;
    return {
      artifact,
      artifactPath: resolvedPath,
      artifactDir: path.dirname(resolvedPath),
    };
  }

  const artifactJsonPath = path.join(resolvedPath, "artifact.json");
  const raw = await fs.readFile(artifactJsonPath, "utf8");
  const artifact = JSON.parse(raw) as Record<string, unknown>;
  return {
    artifact,
    artifactPath: resolvedPath,
    artifactDir: resolvedPath,
  };
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function escapeMarkdownCell(value: unknown): string {
  const normalized = normalizeCell(value);
  if (!normalized) return "";
  return normalized.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeCsvCell(value: unknown): string {
  const normalized = normalizeCell(value);
  if (!normalized) return "";
  const escaped = normalized.replace(/"/g, '""').replace(/\r?\n/g, " ");
  return /[",]/.test(escaped) ? `"${escaped}"` : escaped;
}

interface RowIssue {
  row_index: number;
  posted_at: string | null;
  amount: number | null;
  currency: string | null;
  merchant_name: string | null;
  external_id: string | null;
  issue_codes: string[];
}

function buildRowIssues(rows: Record<string, unknown>[]): RowIssue[] {
  const externalIdCounts = new Map<string, number>();
  for (const row of rows) {
    const externalId = typeof row.external_id === "string" ? row.external_id.trim() : "";
    if (!externalId) continue;
    externalIdCounts.set(externalId, (externalIdCounts.get(externalId) ?? 0) + 1);
  }

  const issues: RowIssue[] = [];
  rows.forEach((row, index) => {
    const issueCodes: string[] = [];
    const postedAt = toIsoString(row.posted_at);
    if (!postedAt) issueCodes.push("INVALID_POSTED_AT");

    const lineItems = Array.isArray(row.line_items) ? row.line_items : [];
    if (lineItems.length === 0) issueCodes.push("NO_LINE_ITEMS");

    const amount = toNumber(row.amount);
    if (amount === null) issueCodes.push("INVALID_AMOUNT");

    const currency = typeof row.currency === "string" ? row.currency.trim() : "";
    if (!currency) issueCodes.push("MISSING_CURRENCY");

    const externalId = typeof row.external_id === "string" ? row.external_id.trim() : "";
    if (!externalId) {
      issueCodes.push("MISSING_EXTERNAL_ID");
    } else if ((externalIdCounts.get(externalId) ?? 0) > 1) {
      issueCodes.push("DUPLICATE_EXTERNAL_ID");
    }

    if (issueCodes.length === 0) return;
    issues.push({
      row_index: index,
      posted_at: postedAt,
      amount,
      currency: currency || null,
      merchant_name:
        typeof row.merchant_name === "string" && row.merchant_name.trim()
          ? row.merchant_name.trim()
          : null,
      external_id: externalId || null,
      issue_codes: issueCodes,
    });
  });

  return issues;
}

function topMerchants(
  rows: Record<string, unknown>[],
  limit: number,
): Array<{
  merchant_name: string;
  count: number;
  total_amount: number;
}> {
  const stats = new Map<string, { count: number; total_amount: number }>();
  for (const row of rows) {
    const merchantRaw =
      typeof row.merchant_name === "string" && row.merchant_name.trim()
        ? row.merchant_name.trim()
        : "(empty)";
    const amount = toNumber(row.amount) ?? 0;
    const current = stats.get(merchantRaw) ?? { count: 0, total_amount: 0 };
    current.count += 1;
    current.total_amount += amount;
    stats.set(merchantRaw, current);
  }

  return Array.from(stats.entries())
    .map(([merchant_name, stat]) => ({ merchant_name, ...stat }))
    .sort((a, b) => b.count - a.count || Math.abs(b.total_amount) - Math.abs(a.total_amount))
    .slice(0, Math.max(limit, 1));
}

interface TransactionReportRow {
  row_index: number;
  posted_at: string | null;
  amount: number | null;
  currency: string | null;
  transaction_type: string | null;
  status: string | null;
  merchant_name: string | null;
  mcc: string | null;
  source_comment: string | null;
  cashback_amount: number | null;
  cashback_currency: string | null;
  is_transfer: boolean | null;
  account_hint: string | null;
  external_id: string | null;
  line_items_count: number;
  human_comment: string;
}

interface LineItemReportRow {
  row_index: number;
  line_index: number;
  external_id: string | null;
  title: string | null;
  amount: number | null;
  quantity: number | null;
  unit: string | null;
  raw_payload: string | null;
  human_comment: string;
}

function buildTransactionRows(
  rows: Record<string, unknown>[],
  maxRows: number,
): TransactionReportRow[] {
  return rows.slice(0, Math.max(1, maxRows)).map((row, index) => {
    const rawPayload = toObject(row.raw_payload);
    const accountHint =
      typeof row.account_hint === "string"
        ? row.account_hint
        : typeof rawPayload?.account_hint === "string"
          ? rawPayload.account_hint
          : null;
    const cashbackAmount = deriveCashbackAmount(row);
    return {
      row_index: index,
      posted_at: toIsoString(row.posted_at),
      amount: toNumber(row.amount),
      currency: typeof row.currency === "string" ? row.currency : null,
      transaction_type: typeof row.transaction_type === "string" ? row.transaction_type : null,
      status: typeof row.status === "string" ? row.status : null,
      merchant_name: typeof row.merchant_name === "string" ? row.merchant_name : null,
      mcc: typeof row.mcc === "string" ? row.mcc : null,
      source_comment: deriveSourceComment(row),
      cashback_amount: cashbackAmount,
      cashback_currency: deriveCashbackCurrency(row, cashbackAmount),
      is_transfer: typeof row.is_transfer === "boolean" ? row.is_transfer : null,
      account_hint: accountHint,
      external_id: typeof row.external_id === "string" ? row.external_id : null,
      line_items_count: Array.isArray(row.line_items) ? row.line_items.length : 0,
      human_comment: "",
    };
  });
}

function buildLineItemRows(rows: Record<string, unknown>[], maxRows: number): LineItemReportRow[] {
  const selected = rows.slice(0, Math.max(1, maxRows));
  const lineRows: LineItemReportRow[] = [];
  selected.forEach((row, rowIndex) => {
    const externalId = typeof row.external_id === "string" ? row.external_id : null;
    const lineItems = Array.isArray(row.line_items) ? row.line_items : [];
    lineItems.forEach((lineItemInput, lineIndex) => {
      const lineItem = toObject(lineItemInput);
      lineRows.push({
        row_index: rowIndex,
        line_index: lineIndex,
        external_id: externalId,
        title: typeof lineItem?.title === "string" ? lineItem.title : null,
        amount: toNumber(lineItem?.amount),
        quantity: toNumber(lineItem?.quantity),
        unit: typeof lineItem?.unit === "string" ? lineItem.unit : null,
        raw_payload: lineItem?.raw_payload ? JSON.stringify(lineItem.raw_payload) : null,
        human_comment: "",
      });
    });
  });
  return lineRows;
}

function buildRowsPreviewCsv(transactionRows: TransactionReportRow[]): string {
  const headers = [
    "row_index",
    "posted_at",
    "amount",
    "currency",
    "transaction_type",
    "status",
    "merchant_name",
    "mcc",
    "source_comment",
    "cashback_amount",
    "cashback_currency",
    "is_transfer",
    "account_hint",
    "external_id",
    "line_items_count",
    "human_comment",
  ];
  const lines = [headers.join(",")];
  for (const row of transactionRows) {
    lines.push(
      [
        row.row_index,
        row.posted_at,
        row.amount,
        row.currency,
        row.transaction_type,
        row.status,
        row.merchant_name,
        row.mcc,
        row.source_comment,
        row.cashback_amount,
        row.cashback_currency,
        row.is_transfer,
        row.account_hint,
        row.external_id,
        row.line_items_count,
        row.human_comment,
      ]
        .map((value) => escapeCsvCell(value))
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

function toMarkdownTable(
  headers: string[],
  rows: Array<Array<string | number | boolean | null>>,
): string {
  const headerLine = `| ${headers.map((value) => escapeMarkdownCell(value)).join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map(
    (row) => `| ${row.map((value) => escapeMarkdownCell(value)).join(" | ")} |`,
  );
  return [headerLine, separatorLine, ...rowLines].join("\n");
}

function buildHumanReportMarkdown(
  diagnostics: TbankDebugDiagnostics,
  artifact: Record<string, unknown>,
  transactionRows: TransactionReportRow[],
  lineItemRows: LineItemReportRow[],
  rowIssues: RowIssue[],
): string {
  const parseDebug = extractParseDebug(artifact);
  const mappingDropCounts = toObject(parseDebug.mapping_drop_counts) ?? {};
  const merchants = topMerchants(extractRows(artifact), 15);
  const statusRows = Object.entries(diagnostics.status_histogram).sort(
    ([a], [b]) => Number(a) - Number(b),
  );

  const verdict = diagnostics.passed ? "PASS" : "FAIL";
  const categories = diagnostics.categories.length > 0 ? diagnostics.categories.join(", ") : "none";
  const signatures =
    diagnostics.error_signatures.length > 0 ? diagnostics.error_signatures.join(" | ") : "none";

  const reportParts: string[] = [];
  reportParts.push(`# Source Parse Validation Report`);
  reportParts.push("");
  reportParts.push(`- Generated at: ${diagnostics.generated_at}`);
  reportParts.push(`- Artifact path: ${diagnostics.artifact_path}`);
  reportParts.push(`- Verdict: ${verdict}`);
  reportParts.push(`- Failure categories: ${categories}`);
  reportParts.push(`- Error signatures: ${signatures}`);
  reportParts.push("");
  reportParts.push(`## Parsing Summary`);
  reportParts.push(
    toMarkdownTable(
      [
        "rows_count",
        "invalid_posted_at",
        "rows_without_line_items",
        "mapping_drop_total",
        "receipt_line_items_skipped_count",
        "extraction_method",
        "fallback_used",
      ],
      [
        [
          diagnostics.rows_count,
          diagnostics.invalid_posted_at,
          diagnostics.rows_without_line_items,
          diagnostics.mapping_drop_total,
          diagnostics.receipt_enrichment.line_items_skipped_count,
          diagnostics.api_vs_dom_used.extraction_method,
          diagnostics.api_vs_dom_used.fallback_used,
        ],
      ],
    ),
  );
  reportParts.push("");
  reportParts.push(`## Receipt Enrichment`);
  reportParts.push(
    toMarkdownTable(
      [
        "requested_count",
        "success_count",
        "rate_limited_count",
        "skipped_after_budget_count",
        "failed_count",
        "retry_attempts_total",
        "stopped_after_budget",
        "base_pause_between_receipts_ms",
        "line_items_skipped_count",
      ],
      [
        [
          diagnostics.receipt_enrichment.requested_count,
          diagnostics.receipt_enrichment.success_count,
          diagnostics.receipt_enrichment.rate_limited_count,
          diagnostics.receipt_enrichment.skipped_after_budget_count,
          diagnostics.receipt_enrichment.failed_count,
          diagnostics.receipt_enrichment.retry_attempts_total,
          diagnostics.receipt_enrichment.stopped_after_budget,
          diagnostics.receipt_enrichment.base_pause_between_receipts_ms,
          diagnostics.receipt_enrichment.line_items_skipped_count,
        ],
      ],
    ),
  );
  reportParts.push("");
  reportParts.push(`## Range Coverage`);
  reportParts.push(
    toMarkdownTable(
      ["window_from", "parsed_through_at", "window_to", "covers_window_from"],
      [
        [
          diagnostics.range_coverage.window_from,
          diagnostics.range_coverage.parsed_through_at,
          diagnostics.range_coverage.window_to,
          diagnostics.range_coverage.covers_window_from,
        ],
      ],
    ),
  );
  reportParts.push("");
  reportParts.push(`## API/DOM Diagnostics`);
  reportParts.push(
    toMarkdownTable(
      ["api_operation_count", "mapped_row_count"],
      [
        [
          diagnostics.api_vs_dom_used.api_operation_count,
          diagnostics.api_vs_dom_used.mapped_row_count,
        ],
      ],
    ),
  );
  reportParts.push("");
  reportParts.push(`## HTTP Status Histogram`);
  if (statusRows.length === 0) {
    reportParts.push("_No HTTP status histogram entries captured._");
  } else {
    reportParts.push(
      toMarkdownTable(
        ["status_code", "count"],
        statusRows.map(([statusCode, count]) => [statusCode, count]),
      ),
    );
  }
  reportParts.push("");
  reportParts.push(`## Mapping Drop Counts`);
  const mappingEntries = Object.entries(mappingDropCounts);
  if (mappingEntries.length === 0) {
    reportParts.push("_No mapping drop counters captured._");
  } else {
    reportParts.push(
      toMarkdownTable(
        ["drop_reason", "count"],
        mappingEntries.map(([reason, count]) => [reason, toNumber(count) ?? 0]),
      ),
    );
  }
  reportParts.push("");
  reportParts.push(`## Top Merchants`);
  if (merchants.length === 0) {
    reportParts.push("_No rows captured._");
  } else {
    reportParts.push(
      toMarkdownTable(
        ["merchant_name", "count", "total_amount"],
        merchants.map((merchant) => [
          merchant.merchant_name,
          merchant.count,
          merchant.total_amount,
        ]),
      ),
    );
  }
  reportParts.push("");
  reportParts.push(`## Potential Row Issues (first 50)`);
  if (rowIssues.length === 0) {
    reportParts.push("_No row-level issues detected by automated checks._");
  } else {
    reportParts.push(
      toMarkdownTable(
        [
          "row_index",
          "posted_at",
          "amount",
          "currency",
          "merchant_name",
          "external_id",
          "issue_codes",
        ],
        rowIssues
          .slice(0, 50)
          .map((issue) => [
            issue.row_index,
            issue.posted_at,
            issue.amount,
            issue.currency,
            issue.merchant_name,
            issue.external_id,
            issue.issue_codes.join(","),
          ]),
      ),
    );
  }
  reportParts.push("");
  reportParts.push(`## Transactions (${transactionRows.length} rows)`);
  if (transactionRows.length === 0) {
    reportParts.push("_No transactions captured._");
  } else {
    reportParts.push(
      toMarkdownTable(
        [
          "row_index",
          "posted_at",
          "amount",
          "currency",
          "transaction_type",
          "status",
          "merchant_name",
          "mcc",
          "source_comment",
          "cashback_amount",
          "cashback_currency",
          "is_transfer",
          "account_hint",
          "external_id",
          "line_items_count",
          "human_comment",
        ],
        transactionRows.map((row) => [
          row.row_index,
          row.posted_at,
          row.amount,
          row.currency,
          row.transaction_type,
          row.status,
          row.merchant_name,
          row.mcc,
          row.source_comment,
          row.cashback_amount,
          row.cashback_currency,
          row.is_transfer,
          row.account_hint,
          row.external_id,
          row.line_items_count,
          row.human_comment,
        ]),
      ),
    );
  }
  reportParts.push("");
  reportParts.push(`## Line Items (${lineItemRows.length} rows)`);
  if (lineItemRows.length === 0) {
    reportParts.push("_No line items captured._");
  } else {
    reportParts.push(
      toMarkdownTable(
        [
          "row_index",
          "line_index",
          "external_id",
          "title",
          "amount",
          "quantity",
          "unit",
          "raw_payload",
          "human_comment",
        ],
        lineItemRows.map((line) => [
          line.row_index,
          line.line_index,
          line.external_id,
          line.title,
          line.amount,
          line.quantity,
          line.unit,
          line.raw_payload,
          line.human_comment,
        ]),
      ),
    );
  }

  return `${reportParts.join("\n")}\n`;
}

export interface AnalysisWriteOptions {
  diagnosticsPath?: string;
  reportPath?: string;
  csvPath?: string;
  maxRows?: number;
}

export async function writeAnalysisArtifacts(
  artifact: Record<string, unknown>,
  artifactPath: string,
  artifactDir: string,
  options: AnalysisWriteOptions = {},
): Promise<{
  diagnostics: TbankDebugDiagnostics;
  diagnosticsPath: string;
  reportPath: string;
  csvPath: string;
}> {
  const diagnostics = analyzeArtifactBundle(artifact, artifactPath);
  const maxRows =
    Number.isFinite(options.maxRows) && (options.maxRows ?? 0) > 0
      ? Math.floor(options.maxRows as number)
      : Number.MAX_SAFE_INTEGER;
  const transactionRows = buildTransactionRows(extractRows(artifact), maxRows);
  const lineItemRows = buildLineItemRows(extractRows(artifact), maxRows);
  const rowIssues = buildRowIssues(extractRows(artifact));
  const reportMarkdown = buildHumanReportMarkdown(
    diagnostics,
    artifact,
    transactionRows,
    lineItemRows,
    rowIssues,
  );
  const previewCsv = buildRowsPreviewCsv(transactionRows);

  const diagnosticsPath = options.diagnosticsPath ?? path.join(artifactDir, "diagnostics.json");
  const reportPath = options.reportPath ?? path.join(artifactDir, "report.md");
  const csvPath = options.csvPath ?? path.join(artifactDir, "rows-preview.csv");

  await fs.mkdir(path.dirname(diagnosticsPath), { recursive: true });
  await fs.writeFile(`${diagnosticsPath}`, `${JSON.stringify(diagnostics, null, 2)}\n`, "utf8");
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, reportMarkdown, "utf8");
  await fs.mkdir(path.dirname(csvPath), { recursive: true });
  await fs.writeFile(csvPath, previewCsv, "utf8");

  return { diagnostics, diagnosticsPath, reportPath, csvPath };
}

async function runCli(): Promise<void> {
  const args = parseArgs(process.argv);
  const { artifact, artifactPath, artifactDir } = await loadArtifactContext(
    args.artifactPath,
    args.sourceId,
  );
  const { diagnostics, diagnosticsPath, reportPath, csvPath } = await writeAnalysisArtifacts(
    artifact,
    artifactPath,
    artifactDir,
    {
      diagnosticsPath: args.outputPath ? path.resolve(process.cwd(), args.outputPath) : undefined,
      reportPath: args.reportPath ? path.resolve(process.cwd(), args.reportPath) : undefined,
      csvPath: args.csvPath ? path.resolve(process.cwd(), args.csvPath) : undefined,
      maxRows: args.maxRows,
    },
  );

  process.stdout.write(`[analyze] diagnostics: ${diagnosticsPath}\n`);
  process.stdout.write(`[analyze] report: ${reportPath}\n`);
  process.stdout.write(`[analyze] rows csv: ${csvPath}\n`);
  process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`);
  if (args.printReport) {
    const reportMarkdown = await fs.readFile(reportPath, "utf8");
    process.stdout.write("\n");
    process.stdout.write(reportMarkdown);
  }
  if (!diagnostics.passed) {
    process.exitCode = 1;
  }
}

const invokedScript = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedScript) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
