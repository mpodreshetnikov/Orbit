// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { applyRowsAction } from "./apply-rows.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { EdgeTelemetry } from "../_shared/observability.ts";
import type { AuthContext, CanonicalTransactionRowInput } from "./types.ts";

interface ApplyRowsRepoState {
  createdBatchPayloads: Record<string, unknown>[];
  sessionUpdates: Array<{ sessionId: string; patch: Record<string, unknown> }>;
  batchUpdates: Array<{ batchId: string; patch: Record<string, unknown> }>;
  reportRows: Record<string, unknown>[];
  insertedTransactions: CanonicalTransactionRowInput[];
  repairedTransactions: Array<{ transactionId: string; row: CanonicalTransactionRowInput }>;
  resolvedCardRows: Array<{ accountId: string; row: CanonicalTransactionRowInput }>;
  resolvedAccountRows: Array<{
    payerPersonId: string;
    fallbackSource: string;
    row: CanonicalTransactionRowInput;
    defaultAccountId: string | null;
  }>;
  appliedCategoryPipelineCalls: Array<{
    lineItemIds: string[];
    personId: string;
    triggerSource: string;
    forceOverwriteLocked: boolean;
  }>;
}

function createRepositoryMock(
  options: {
    batchBefore?: Record<string, unknown> | null;
    updateBatchError?: string | null;
    applyCategoryRulePipelineError?: string | null;
  } = {},
): { repository: MoneyImportRepository; state: ApplyRowsRepoState } {
  const state: ApplyRowsRepoState = {
    createdBatchPayloads: [],
    sessionUpdates: [],
    batchUpdates: [],
    reportRows: [],
    insertedTransactions: [],
    repairedTransactions: [],
    resolvedCardRows: [],
    resolvedAccountRows: [],
    appliedCategoryPipelineCalls: [],
  };

  let txCounter = 0;
  let lineCounter = 0;

  const repository: MoneyImportRepository = {
    authenticateAllowedUser: async () => null,
    getSessionByToken: async () => null,
    findLastImportedAt: async () => null,
    createImportSession: async () => ({ id: "session-1" }),
    getImportSessionForUser: async () => null,
    getImportSessionById: async () => null,
    updateImportSession: async (sessionId, patch) => {
      state.sessionUpdates.push({ sessionId, patch });
    },
    createImportBatch: async (payload) => {
      state.createdBatchPayloads.push(payload);
      return "batch-created";
    },
    getImportBatch: async () =>
      options.batchBefore === undefined
        ? {
            id: "batch-1",
            parsed_transactions_count: 0,
            inserted_count: 0,
            skipped_count: 0,
            error_count: 0,
          }
        : options.batchBefore,
    getImportBatchForUser: async () =>
      options.batchBefore === undefined
        ? {
            id: "batch-1",
            parsed_transactions_count: 0,
            inserted_count: 0,
            skipped_count: 0,
            error_count: 0,
          }
        : options.batchBefore,
    updateImportBatch: async (batchId, patch) => {
      if (options.updateBatchError) throw new Error(options.updateBatchError);
      state.batchUpdates.push({ batchId, patch });
    },
    getExistingTransactionStates: async () => [],
    listReportRowsByBatch: async () => [],
    deleteReportRowsByBatch: async () => {},
    resolveAccountIdForRow: async (
      payerPersonId: string,
      row: CanonicalTransactionRowInput,
      fallbackSource: string,
      defaultAccountId?: string | null,
    ) => {
      state.resolvedAccountRows.push({
        payerPersonId,
        fallbackSource,
        row,
        defaultAccountId: defaultAccountId ?? null,
      });
      if (row.external_id === "account-error") {
        throw new Error("No money account found for source tbank");
      }
      return row.account_id ?? defaultAccountId ?? "acc-1";
    },
    resolveCardIdForRow: async (accountId, row) => {
      state.resolvedCardRows.push({ accountId, row });
      if (row.external_id === "card-error") {
        throw new Error("card resolve failed");
      }
      if (row.external_id === "card-none") return null;
      return "card-1";
    },
    findExistingTransactionId: async (row) => (row.external_id === "dup-tx" ? "tx-dup" : null),
    findExistingLineItemId: async () => null,
    insertOrResolveTransaction: async (row) => {
      if (row.external_id === "dup-tx") {
        return { transactionId: "tx-dup", inserted: false };
      }
      if (row.external_id === "dup-synthetic") {
        return { transactionId: "tx-synth", inserted: false };
      }
      if (row.external_id === "err-tx") {
        throw new Error("row insert failed");
      }
      state.insertedTransactions.push(row);
      txCounter += 1;
      return { transactionId: `tx-${txCounter}`, inserted: true };
    },
    repairExistingTransactionDetails: async (
      transactionId: string,
      row: CanonicalTransactionRowInput,
    ) => {
      state.repairedTransactions.push({ transactionId, row });
      return {
        replaced_synthetic_line_items: transactionId === "tx-synth",
        has_only_synthetic_line_items: transactionId === "tx-synth",
        has_real_line_items: transactionId !== "tx-synth",
        blocked_by_manual_edit: false,
      };
    },
    insertLineItemIfNew: async (_transactionId, lineItem) => {
      if (lineItem.title === "dup") return { lineItemId: "line-dup", inserted: false };
      if (lineItem.title === "err") throw new Error("line item failed");
      lineCounter += 1;
      return { lineItemId: `line-${lineCounter}`, inserted: true };
    },
    insertReportRow: async (payload) => {
      state.reportRows.push(payload);
      return `report-${state.reportRows.length}`;
    },
    applyCategoryRulePipeline: async (
      lineItemIds: string[],
      personId: string,
      triggerSource: string,
      forceOverwriteLocked = false,
    ) => {
      if (options.applyCategoryRulePipelineError) {
        throw new Error(options.applyCategoryRulePipelineError);
      }
      state.appliedCategoryPipelineCalls.push({
        lineItemIds,
        personId,
        triggerSource,
        forceOverwriteLocked,
      });
      return { runs: [] };
    },
  };

  return { repository, state };
}

function createTelemetryMock(): {
  telemetry: EdgeTelemetry;
  infoEvents: Array<{ message: string; attrs?: Record<string, unknown> }>;
  warnEvents: Array<{ message: string; attrs?: Record<string, unknown> }>;
  spans: Array<{ name: string; ended: number }>;
} {
  const infoEvents: Array<{ message: string; attrs?: Record<string, unknown> }> = [];
  const warnEvents: Array<{ message: string; attrs?: Record<string, unknown> }> = [];
  const spans: Array<{ name: string; ended: number }> = [];

  const telemetry = {
    context: {
      component: "money-import",
      traceId: "trace-1",
      requestId: "request-1",
      env: "local",
      release: "dev-local",
    },
    debug: () => {},
    info: (message: string, attrs?: Record<string, unknown>) => {
      infoEvents.push({ message, attrs });
    },
    warn: (message: string, attrs?: Record<string, unknown>) => {
      warnEvents.push({ message, attrs });
    },
    error: () => {},
    startSpan: (name: string) => {
      spans.push({ name, ended: 0 });
      return {
        traceId: "trace-1",
        spanId: "span-1",
        requestId: "request-1",
        traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
        log: () => {},
        end: async () => {
          spans[spans.length - 1].ended += 1;
        },
      };
    },
  } as unknown as EdgeTelemetry;

  return { telemetry, infoEvents, warnEvents, spans };
}

const userAuth: AuthContext = {
  mode: "user",
  token: "token",
  userId: "user-1",
  email: "user@example.com",
};

function txRow(partial: Partial<CanonicalTransactionRowInput> = {}): CanonicalTransactionRowInput {
  return {
    posted_at: "2026-01-01T00:00:00.000Z",
    amount: 10,
    transaction_type: "expense",
    ...partial,
  };
}

Deno.test("applyRowsAction validates rows array and payer person", async () => {
  const { repository } = createRepositoryMock();

  const badRowsPayload = await assertJsonResponse<{ error: string }>(
    await applyRowsAction({ rows: "nope" }, userAuth, { repository }),
    400,
  );
  assertEquals(badRowsPayload.error, "rows must be an array");

  const missingPayerPayload = await assertJsonResponse<{ error: string }>(
    await applyRowsAction({ rows: [txRow()] }, userAuth, { repository }),
    400,
  );
  assertEquals(missingPayerPayload.error, "payer_person_id is required");
});

Deno.test("applyRowsAction rejects expired session auth", async () => {
  const { repository } = createRepositoryMock();
  const sessionAuth: AuthContext = {
    mode: "session",
    token: "session-token",
    session: {
      id: "session-1",
      status: "running",
      revoked_at: null,
      expires_at: "2026-01-01T00:00:00.000Z",
    },
  };

  const payload = await assertJsonResponse<{ error: string }>(
    await applyRowsAction(
      {
        rows: [txRow()],
      },
      sessionAuth,
      { repository },
    ),
    401,
  );

  assertEquals(payload.error, "Import session expired or revoked");
});

Deno.test(
  "applyRowsAction carries receipt skip fields into transaction inserts and report rows",
  async () => {
    const { repository, state } = createRepositoryMock();

    await assertJsonResponse(
      await applyRowsAction(
        {
          rows: [
            txRow({
              external_id: "receipt-skip-1",
              receipt_request_key: "auth-1",
              receipt_enrichment_status: "rate_limited",
            }),
          ],
          payer_person_id: "person-1",
        },
        userAuth,
        { repository },
      ),
      200,
    );

    assertEquals(state.insertedTransactions.length, 1);
    const insertedTransaction = state.insertedTransactions[0];
    assertEquals(insertedTransaction.receipt_request_key, "auth-1");
    assertEquals(insertedTransaction.receipt_enrichment_status, "rate_limited");

    const transactionRow = state.reportRows.find((row) => row.row_kind === "transaction");
    assertEquals(transactionRow?.receipt_request_key, "auth-1");
    assertEquals(transactionRow?.receipt_enrichment_status, "rate_limited");
  },
);

Deno.test("applyRowsAction returns 404 when target batch does not exist", async () => {
  const { repository } = createRepositoryMock({ batchBefore: null });
  const payload = await assertJsonResponse<{ error: string }>(
    await applyRowsAction(
      {
        rows: [txRow()],
        payer_person_id: "person-1",
        batch_id: "missing-batch",
      },
      userAuth,
      { repository },
    ),
    404,
  );
  assertEquals(payload.error, "Batch not found");
});

Deno.test(
  "applyRowsAction handles inserted/skipped/error rows and line-item branches",
  async () => {
    const { repository, state } = createRepositoryMock({
      batchBefore: {
        id: "batch-1",
        parsed_transactions_count: 5,
        inserted_count: 1,
        skipped_count: 1,
        error_count: 1,
      },
    });

    const payload = await assertJsonResponse<{
      inserted: number;
      skipped: number;
      error_count: number;
      row_results: Array<{ status: string }>;
    }>(
      await applyRowsAction(
        {
          payer_person_id: "person-1",
          source: "tbank_web",
          rows: [
            txRow({
              external_id: "ok-1",
              line_items: [{ title: "ok" }, { title: "dup" }, { title: "err" }],
            }),
            txRow({ external_id: "dup-tx" }),
            txRow({ posted_at: "bad-date" }),
          ],
        },
        userAuth,
        {
          repository,
          now: () => new Date("2026-01-01T00:00:00.000Z"),
        },
      ),
      200,
    );

    assertEquals(payload.inserted, 1);
    assertEquals(payload.skipped, 1);
    assertEquals(payload.error_count, 2);
    assertEquals(payload.row_results.length, 3);
    assertEquals(payload.row_results[0].status, "inserted");
    assertEquals(payload.row_results[1].status, "skipped");
    assertEquals(payload.row_results[2].status, "error");
    assertEquals(state.batchUpdates.length, 1);
    assertEquals(state.batchUpdates[0].patch.status, "completed");
    assertEquals(state.resolvedCardRows.length > 0, true);
    assertEquals(state.appliedCategoryPipelineCalls.length, 1);
    assertEquals(state.appliedCategoryPipelineCalls[0].personId, "person-1");
    assertEquals(state.appliedCategoryPipelineCalls[0].triggerSource, "import_auto");
    assertEquals(state.appliedCategoryPipelineCalls[0].lineItemIds, ["line-1", "line-2"]);
    const firstTxRow = state.reportRows.find((row) => row.row_kind === "transaction");
    assertEquals((firstTxRow?.payload as Record<string, unknown>).card_id, "card-1");
  },
);

Deno.test(
  "applyRowsAction repairs duplicate transactions by replacing synthetic line items with real receipt items",
  async () => {
    const { repository, state } = createRepositoryMock();

    const payload = await assertJsonResponse<{
      inserted: number;
      skipped: number;
      error_count: number;
      row_results: Array<{ status: string; line_results?: Array<{ status: string }> }>;
    }>(
      await applyRowsAction(
        {
          payer_person_id: "person-1",
          source: "tbank_web",
          rows: [
            txRow({
              external_id: "dup-synthetic",
              receipt_enrichment_status: "ok",
              line_items: [
                { title: "Milk", amount: 4, raw_payload: { source: "receipt" } },
                { title: "Bread", amount: 6, raw_payload: { source: "receipt" } },
              ],
            }),
          ],
        },
        userAuth,
        { repository },
      ),
      200,
    );

    assertEquals(payload.inserted, 0);
    assertEquals(payload.skipped, 1);
    assertEquals(payload.error_count, 0);
    assertEquals(state.repairedTransactions.length, 1);
    assertEquals(state.repairedTransactions[0].transactionId, "tx-synth");
    assertEquals(state.appliedCategoryPipelineCalls[0]?.lineItemIds, ["line-1", "line-2"]);
    assertEquals(payload.row_results[0].line_results?.[0]?.status, "inserted");
    assertEquals(payload.row_results[0].line_results?.[1]?.status, "inserted");
  },
);

Deno.test("applyRowsAction emits row error aggregation telemetry", async () => {
  const { repository } = createRepositoryMock();
  const { telemetry, infoEvents, warnEvents } = createTelemetryMock();

  const payload = await assertJsonResponse<{
    inserted: number;
    skipped: number;
    error_count: number;
  }>(
    await applyRowsAction(
      {
        payer_person_id: "person-1",
        source: "tbank_web",
        rows: [
          txRow({ external_id: "account-error" }),
          txRow({ external_id: "dup-tx" }),
          txRow({ posted_at: "bad-date" }),
        ],
      },
      userAuth,
      { repository, telemetry },
    ),
    200,
  );

  assertEquals(payload.inserted, 0);
  assertEquals(payload.skipped, 1);
  assertEquals(payload.error_count, 2);

  const completedEvent = infoEvents.find(
    (event) => event.message === "money_import_apply_rows_completed",
  );
  assertEquals(completedEvent?.attrs?.error_no_account_count, 1);
  assertEquals(completedEvent?.attrs?.error_duplicate_transaction_count, 1);
  assertEquals(completedEvent?.attrs?.error_validation_count, 1);
  assertEquals(completedEvent?.attrs?.error_other_count, 0);
  assertEquals(
    typeof completedEvent?.attrs?.top_error_message === "string" ||
      completedEvent?.attrs?.top_error_message === null,
    true,
  );

  const noAccountWarn = warnEvents.find(
    (event) => event.message === "money_import_apply_rows_no_account_for_source",
  );
  assertEquals(noAccountWarn?.attrs?.source, "tbank");
  assertEquals(noAccountWarn?.attrs?.row_index, 0);
});

Deno.test("applyRowsAction persists category pipeline failures into batch meta", async () => {
  const { repository, state } = createRepositoryMock({
    applyCategoryRulePipelineError: "category pipeline exploded",
  });
  const { telemetry, warnEvents } = createTelemetryMock();

  await assertJsonResponse(
    await applyRowsAction(
      {
        payer_person_id: "person-1",
        source: "tbank_web",
        rows: [
          txRow({
            external_id: "ok-with-category-pipeline-failure",
            line_items: [{ title: "ok" }],
          }),
        ],
      },
      userAuth,
      { repository, telemetry },
    ),
    200,
  );

  assertEquals(state.batchUpdates.length, 1);
  assertEquals(
    (
      (state.batchUpdates[0].patch.meta as Record<string, unknown>).category_pipeline as Record<
        string,
        unknown
      >
    ).status,
    "failed",
  );
  assertEquals(
    (
      (state.batchUpdates[0].patch.meta as Record<string, unknown>).category_pipeline as Record<
        string,
        unknown
      >
    ).error_message,
    "category pipeline exploded",
  );
  assertEquals(
    warnEvents.some(
      (event) => event.message === "money_import_apply_rows_category_pipeline_failed",
    ),
    true,
  );
});

Deno.test("applyRowsAction runs session flow and keeps batch status running", async () => {
  const { repository, state } = createRepositoryMock();
  const sessionAuth: AuthContext = {
    mode: "session",
    token: "session-token",
    session: {
      id: "session-1",
      batch_id: "batch-1",
      source: "tbank_web",
      payer_person_id: "person-1",
      status: "created",
      revoked_at: null,
      expires_at: "2999-01-01T00:00:00.000Z",
    },
  };

  const payload = await assertJsonResponse<{
    inserted: number;
    skipped: number;
    error_count: number;
  }>(
    await applyRowsAction(
      {
        rows: [txRow({ external_id: "ok-1" })],
      },
      sessionAuth,
      {
        repository,
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    ),
    200,
  );

  assertEquals(payload.inserted, 1);
  assertEquals(payload.skipped, 0);
  assertEquals(payload.error_count, 0);
  assertEquals(state.sessionUpdates.length >= 2, true);
  assertEquals(state.batchUpdates[0].patch.status, "running");
});

Deno.test("applyRowsAction returns 400 when batch update fails", async () => {
  const { repository } = createRepositoryMock({ updateBatchError: "update failed" });
  const payload = await assertJsonResponse<{ error: string }>(
    await applyRowsAction(
      {
        rows: [txRow()],
        payer_person_id: "person-1",
      },
      userAuth,
      { repository },
    ),
    400,
  );
  assertEquals(payload.error, "update failed");
});

Deno.test("applyRowsAction forwards default_account_id into account resolver", async () => {
  const { repository, state } = createRepositoryMock();
  await assertJsonResponse(
    await applyRowsAction(
      {
        rows: [txRow({ external_id: "ok-default" })],
        payer_person_id: "person-1",
        source: "tbank_web",
        default_account_id: "acc-default",
      },
      userAuth,
      { repository },
    ),
    200,
  );

  assertEquals(state.resolvedAccountRows.length, 1);
  assertEquals(state.resolvedAccountRows[0].defaultAccountId, "acc-default");
});

Deno.test(
  "applyRowsAction maps account-native rows to the default account without creating a card",
  async () => {
    const { repository, state } = createRepositoryMock();

    const payload = await assertJsonResponse<{
      inserted: number;
      skipped: number;
      error_count: number;
      row_results: Array<{ status: string; transaction_id?: string | null }>;
    }>(
      await applyRowsAction(
        {
          rows: [
            txRow({
              external_id: "card-none",
              source: "tbank_web",
              transaction_type: "income",
              raw_payload: {
                connector_source: "tbank_web",
                account_hint: null,
                operation: {
                  description: "Проценты на остаток",
                  merchantKey: "Проценты на остаток",
                  subgroup: { name: "Бонусы" },
                  spendingCategory: { name: "Проценты" },
                  categoryInfo: {
                    bankCategory: { name: "Проценты" },
                  },
                  cardNumber: "220070******7770",
                },
              },
            }),
          ],
          payer_person_id: "person-1",
          source: "tbank_web",
          default_account_id: "acc-default",
        },
        userAuth,
        { repository },
      ),
      200,
    );

    assertEquals(payload.inserted, 1);
    assertEquals(payload.skipped, 0);
    assertEquals(payload.error_count, 0);
    assertEquals(payload.row_results[0]?.status, "inserted");
    assertEquals(state.resolvedAccountRows.length, 1);
    assertEquals(state.resolvedAccountRows[0]?.defaultAccountId, "acc-default");
    assertEquals(state.resolvedCardRows.length, 1);
    assertEquals(state.resolvedCardRows[0]?.accountId, "acc-default");
    assertEquals(state.resolvedCardRows[0]?.row.account_hint ?? null, null);
  },
);

Deno.test(
  "applyRowsAction filters rows outside selected range and keeps raw payload in report rows",
  async () => {
    const { repository, state } = createRepositoryMock();

    const payload = await assertJsonResponse<{
      inserted: number;
      skipped: number;
      error_count: number;
      row_results: Array<{ status: string; message?: string | null }>;
    }>(
      await applyRowsAction(
        {
          payer_person_id: "person-1",
          source: "tbank_web",
          window_from: "2026-01-10T00:00:00.000Z",
          window_to: "2026-01-20T23:59:59.000Z",
          rows: [
            txRow({
              external_id: "before-range",
              posted_at: "2026-01-05T09:00:00.000Z",
              raw_payload: { original: "before" },
              line_items: [{ title: "before-line", amount: 10 }],
            }),
            txRow({
              external_id: "bad-date",
              posted_at: "not-a-date",
              raw_payload: { original: "bad-date" },
              line_items: [{ title: "bad-line", amount: 10 }],
            }),
            txRow({
              external_id: "in-range",
              posted_at: "2026-01-12T09:00:00.000Z",
              raw_payload: { original: "in-range" },
              line_items: [{ title: "kept-line", amount: 10 }],
            }),
          ],
        },
        userAuth,
        { repository },
      ),
      200,
    );

    assertEquals(payload.inserted, 1);
    assertEquals(payload.skipped, 1);
    assertEquals(payload.error_count, 1);
    assertEquals(payload.row_results[0].status, "skipped");
    assertEquals(payload.row_results[0].message, "Outside selected import range");
    assertEquals(payload.row_results[1].status, "error");
    assertEquals(payload.row_results[1].message, "Invalid posted_at for selected import range");
    assertEquals(payload.row_results[2].status, "inserted");

    const transactionRows = state.reportRows.filter((row) => row.row_kind === "transaction");
    const lineRows = state.reportRows.filter((row) => row.row_kind === "line_item");
    assertEquals(transactionRows.length, 3);
    assertEquals(lineRows.length, 1);
    assertEquals(transactionRows[0].message, "Outside selected import range");
    assertEquals(
      (
        (transactionRows[0].payload as Record<string, unknown>).raw_payload as Record<
          string,
          unknown
        >
      ).original,
      "before",
    );
    assertEquals(transactionRows[1].message, "Invalid posted_at for selected import range");
    assertEquals(
      (
        (transactionRows[1].payload as Record<string, unknown>).raw_payload as Record<
          string,
          unknown
        >
      ).original,
      "bad-date",
    );
  },
);
