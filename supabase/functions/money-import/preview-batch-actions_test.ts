// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type {
  AuthContext,
  BatchBrandResolutionInput,
  CanonicalTransactionRowInput,
} from "./types.ts";
import {
  applyBatchAction,
  discardBatchAction,
  previewRowsAction,
  remapPreviewCardAction,
} from "./preview-batch-actions.ts";

interface RepoState {
  batchUpdates: Array<{ batchId: string; patch: Record<string, unknown> }>;
  reportRows: Record<string, unknown>[];
  deletedBatchIds: string[];
  listedBatchIds: string[];
  brandResolutions: Array<{ batchId: string; payload: BatchBrandResolutionInput }>;
  resolveCardCalls: Array<{
    accountId: string;
    row: CanonicalTransactionRowInput;
    createIfMissing: boolean | undefined;
  }>;
}

function createRepositoryMock(
  options: {
    batch?: Record<string, unknown> | null;
    batchRows?: Record<string, unknown>[];
  } = {},
): { repository: MoneyImportRepository; state: RepoState } {
  const state: RepoState = {
    batchUpdates: [],
    reportRows: [],
    deletedBatchIds: [],
    listedBatchIds: [],
    brandResolutions: [],
    resolveCardCalls: [],
  };

  const repository: MoneyImportRepository = {
    authenticateAllowedUser: async () => null,
    getSessionByToken: async () => null,
    findLastImportedAt: async () => null,
    createImportSession: async () => ({ id: "session-1" }),
    getImportSessionForUser: async () => null,
    getImportSessionById: async () => null,
    updateImportSession: async () => {},
    createImportBatch: async () => "batch-1",
    getImportBatch: async () =>
      options.batch === undefined
        ? {
            id: "batch-1",
            status: "running",
            payer_person_id: "person-1",
            source: "tbank_web",
            import_type: "file",
            file_path: null,
            parsed_transactions_count: 0,
            inserted_count: 0,
            skipped_count: 0,
            error_count: 0,
          }
        : options.batch,
    updateImportBatch: async (batchId, patch) => {
      state.batchUpdates.push({ batchId, patch });
    },
    previewBrandResolutionForRow: async (row) => {
      const sourceBrand = row.source_brand as Record<string, unknown> | null | undefined;
      const sourceKey =
        sourceBrand && typeof sourceBrand.source_key === "string" ? sourceBrand.source_key : null;
      if (!sourceKey) return null;
      return {
        source: row.source ?? "manual",
        source_key: sourceKey,
        source_name: typeof sourceBrand?.name === "string" ? sourceBrand.name : "Unknown brand",
        suggested_brand_id: null,
        suggested_confidence: 70,
        suggested_reason: "logo_match",
        selected_action: "create_new",
        selected_brand_id: null,
      };
    },
    upsertBatchBrandResolution: async (batchId, payload) => {
      state.brandResolutions.push({ batchId, payload });
    },
    getExistingTransactionStates: async () => [],
    listBatchBrandResolutions: async () => [],
    updateBatchBrandResolutionSelection: async () => {},
    listReportRowsByBatch: async (batchId) => {
      state.listedBatchIds.push(batchId);
      return options.batchRows ?? [];
    },
    deleteReportRowsByBatch: async (batchId) => {
      state.deletedBatchIds.push(batchId);
    },
    findExistingTransactionId: async (row) => (row.external_id === "dup-tx" ? "tx-existing" : null),
    findExistingLineItemId: async (transactionId, _importHash) =>
      transactionId === "tx-existing" ? "line-existing" : null,
    repairExistingTransactionDetails: async () => ({
      replaced_synthetic_line_items: false,
      has_only_synthetic_line_items: false,
      has_real_line_items: false,
    }),
    resolveAccountIdForRow: async (
      _payerPersonId: string,
      row: CanonicalTransactionRowInput,
      _fallbackSource: string,
      defaultAccountId?: string | null,
    ) => {
      if (row.external_id === "account-error") {
        throw new Error("No money account found for source tbank");
      }
      return row.account_id ?? defaultAccountId ?? "acc-1";
    },
    resolveCardIdForRow: async (accountId, row, createIfMissing) => {
      state.resolveCardCalls.push({ accountId, row, createIfMissing });
      const hint =
        row.account_hint ?? (row.raw_payload?.account_hint as string | undefined) ?? null;
      if (hint === "9999" || hint === "**** 9999") return "card-existing";
      if (hint === "1234" || hint === "**** 1234") return "card-created";
      if (hint === "5678" || hint === "**** 5678") return "card-target";
      return null;
    },
    insertOrResolveTransaction: async (row) => ({
      transactionId: row.external_id === "dup-tx" ? "tx-existing" : "tx-new",
      inserted: row.external_id !== "dup-tx",
    }),
    insertLineItemIfNew: async (_transactionId, lineItem) => ({
      lineItemId: lineItem.title === "duplicate-line" ? "line-existing" : "line-new",
      inserted: lineItem.title !== "duplicate-line",
    }),
    insertReportRow: async (payload) => {
      state.reportRows.push(payload);
      return `report-${state.reportRows.length}`;
    },
  };

  return { repository, state };
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
    source: "tbank_web",
    line_items: [],
    ...partial,
  };
}

Deno.test("previewRowsAction predicts row outcomes without mutating transactions", async () => {
  const { repository, state } = createRepositoryMock();

  const payload = await assertJsonResponse<{
    inserted: number;
    skipped: number;
    error_count: number;
  }>(
    await previewRowsAction(
      {
        payer_person_id: "person-1",
        source: "tbank_web",
        batch_id: "batch-1",
        rows: [
          txRow({ external_id: "fresh-tx", line_items: [{ title: "new-line", amount: 10 }] }),
          txRow({ external_id: "dup-tx", line_items: [{ title: "duplicate-line", amount: 5 }] }),
          txRow({ external_id: "account-error" }),
        ],
      },
      userAuth,
      { repository, now: () => new Date("2026-01-01T00:00:00.000Z") },
    ),
    200,
  );

  assertEquals(payload.inserted, 1);
  assertEquals(payload.skipped, 1);
  assertEquals(payload.error_count, 1);
  assertEquals(state.batchUpdates.length, 1);
  assertEquals(state.batchUpdates[0].patch.status, "pending");
  assertEquals(state.reportRows.length, 5);
  assertEquals(state.resolveCardCalls[0]?.createIfMissing, true);
});

Deno.test("previewRowsAction resolves and stores card ids for preview rows", async () => {
  const { repository, state } = createRepositoryMock();

  await assertJsonResponse(
    await previewRowsAction(
      {
        payer_person_id: "person-1",
        source: "tbank_web",
        batch_id: "batch-1",
        rows: [
          txRow({
            external_id: "fresh-tx",
            account_hint: "1234",
            raw_payload: { account_hint: "**** 1234" },
          }),
        ],
      },
      userAuth,
      { repository, now: () => new Date("2026-01-01T00:00:00.000Z") },
    ),
    200,
  );

  const firstTxRow = state.reportRows.find((row) => row.row_kind === "transaction");
  assertEquals((firstTxRow?.payload as Record<string, unknown>)?.card_id, "card-created");
});

Deno.test("previewRowsAction stores batch brand resolutions without applying them", async () => {
  const { repository, state } = createRepositoryMock();

  await assertJsonResponse(
    await previewRowsAction(
      {
        payer_person_id: "person-1",
        source: "tbank_web",
        batch_id: "batch-1",
        rows: [
          txRow({
            external_id: "fresh-tx",
            source_brand: {
              source_key: "known-brand",
              name: "Known Brand",
            },
          }),
        ],
      },
      userAuth,
      { repository, now: () => new Date("2026-01-01T00:00:00.000Z") },
    ),
    200,
  );

  assertEquals(state.brandResolutions.length, 1);
  assertEquals(state.brandResolutions[0]?.batchId, "batch-1");
  assertEquals(state.brandResolutions[0]?.payload.source_key, "known-brand");
  assertEquals(state.brandResolutions[0]?.payload.selected_action, "create_new");
});

Deno.test("applyBatchAction replays stored preview rows into final rows", async () => {
  const { repository, state } = createRepositoryMock({
    batch: {
      id: "batch-1",
      status: "pending",
      payer_person_id: "person-1",
      source: "tbank_web",
      import_type: "file",
      file_path: "bank.csv",
      parsed_transactions_count: 2,
      inserted_count: 1,
      skipped_count: 1,
      error_count: 0,
    },
    batchRows: [
      {
        id: "row-1",
        row_kind: "transaction",
        payload: txRow({
          external_id: "fresh-tx",
          line_items: [{ title: "new-line", amount: 10 }],
        }),
      },
      {
        id: "row-2",
        row_kind: "line_item",
        payload: { title: "new-line", amount: 10 },
      },
    ],
  });

  const payload = await assertJsonResponse<{
    inserted: number;
    skipped: number;
    error_count: number;
  }>(
    await applyBatchAction(
      {
        batch_id: "batch-1",
      },
      userAuth,
      { repository, now: () => new Date("2026-01-01T00:00:00.000Z") },
    ),
    200,
  );

  assertEquals(payload.inserted, 1);
  assertEquals(payload.skipped, 0);
  assertEquals(payload.error_count, 0);
  assertEquals(state.listedBatchIds, ["batch-1"]);
  assertEquals(state.deletedBatchIds, ["batch-1"]);
  assertEquals(state.batchUpdates[0].patch.status, "running");
  assertEquals(state.batchUpdates[state.batchUpdates.length - 1].patch.status, "completed");
});

Deno.test("applyBatchAction validates request auth and batch state", async () => {
  const missingBatchIdRepo = createRepositoryMock();
  const missingBatchId = await assertJsonResponse<{ error: string }>(
    await applyBatchAction({}, userAuth, { repository: missingBatchIdRepo.repository }),
    400,
  );
  assertEquals(missingBatchId.error, "batch_id is required");

  const unauthorized = await assertJsonResponse<{ error: string }>(
    await applyBatchAction(
      { batch_id: "batch-1" },
      { mode: "session", token: "token", session: { id: "session-1" } },
      { repository: missingBatchIdRepo.repository },
    ),
    401,
  );
  assertEquals(unauthorized.error, "Unauthorized");

  const notFoundRepo = createRepositoryMock({ batch: null });
  const notFound = await assertJsonResponse<{ error: string }>(
    await applyBatchAction({ batch_id: "batch-1" }, userAuth, {
      repository: notFoundRepo.repository,
    }),
    404,
  );
  assertEquals(notFound.error, "Batch not found");

  const conflictRepo = createRepositoryMock({
    batch: {
      id: "batch-1",
      status: "completed",
      payer_person_id: "person-1",
      source: "tbank_web",
    },
  });
  const conflict = await assertJsonResponse<{ error: string }>(
    await applyBatchAction({ batch_id: "batch-1" }, userAuth, {
      repository: conflictRepo.repository,
    }),
    409,
  );
  assertEquals(conflict.error, "Batch is not awaiting review");

  const missingPayerRepo = createRepositoryMock({
    batch: {
      id: "batch-1",
      status: "pending",
      payer_person_id: null,
      source: "tbank_web",
    },
  });
  const missingPayer = await assertJsonResponse<{ error: string }>(
    await applyBatchAction({ batch_id: "batch-1" }, userAuth, {
      repository: missingPayerRepo.repository,
    }),
    400,
  );
  assertEquals(missingPayer.error, "Batch payer is missing");
});

Deno.test("applyBatchAction records duplicate transactions and line item failures", async () => {
  const { repository, state } = createRepositoryMock({
    batch: {
      id: "batch-1",
      status: "pending",
      payer_person_id: "person-1",
      source: "tbank_web",
      import_type: "file",
      file_path: "bank.csv",
      parsed_transactions_count: 2,
      inserted_count: 0,
      skipped_count: 0,
      error_count: 0,
      parsed_through_at: null,
      window_from: "2026-01-01T00:00:00.000Z",
      window_to: "2026-01-31T23:59:59.000Z",
    },
    batchRows: [
      {
        id: "row-dup",
        row_kind: "transaction",
        status: "inserted",
        message: null,
        payload: txRow({
          external_id: "dup-tx",
          posted_at: "2026-01-20T09:00:00.000Z",
          line_items: [{ title: "duplicate-line", amount: 10 }],
        }),
      },
      {
        id: "row-err",
        row_kind: "transaction",
        status: "inserted",
        message: null,
        payload: txRow({
          external_id: "fresh-tx",
          posted_at: "2026-01-22T09:00:00.000Z",
          line_items: [{ title: "broken-line", amount: 10 }],
        }),
      },
    ],
  });
  repository.insertLineItemIfNew = async (_transactionId, lineItem) => {
    if (lineItem.title === "broken-line") {
      throw new Error("Line item import failed");
    }
    return {
      lineItemId: lineItem.title === "duplicate-line" ? "line-existing" : "line-new",
      inserted: lineItem.title !== "duplicate-line",
    };
  };

  const payload = await assertJsonResponse<{
    inserted: number;
    skipped: number;
    error_count: number;
    row_results: Array<{
      status: string;
      message?: string | null;
      line_results?: Array<{ status: string; message?: string | null }>;
    }>;
  }>(
    await applyBatchAction({ batch_id: "batch-1" }, userAuth, {
      repository,
      now: () => new Date("2026-01-31T23:59:59.000Z"),
    }),
    200,
  );

  assertEquals(payload.inserted, 1);
  assertEquals(payload.skipped, 1);
  assertEquals(payload.error_count, 1);
  assertEquals(payload.row_results[0]?.status, "skipped");
  assertEquals(payload.row_results[0]?.message, "Duplicate transaction");
  assertEquals(payload.row_results[0]?.line_results?.[0]?.status, "skipped");
  assertEquals(payload.row_results[0]?.line_results?.[0]?.message, "Duplicate line item");
  assertEquals(payload.row_results[1]?.status, "inserted");
  assertEquals(payload.row_results[1]?.line_results?.[0]?.status, "error");
  assertEquals(payload.row_results[1]?.line_results?.[0]?.message, "Line item import failed");
  assertEquals(
    state.batchUpdates[state.batchUpdates.length - 1].patch.parsed_through_at,
    "2026-01-20T09:00:00.000Z",
  );
});

Deno.test("applyBatchAction preserves invalid-date preview rows as errors", async () => {
  const { repository, state } = createRepositoryMock({
    batch: {
      id: "batch-1",
      status: "pending",
      payer_person_id: "person-1",
      source: "tbank_web",
      import_type: "file",
      parsed_transactions_count: 1,
      inserted_count: 0,
      skipped_count: 0,
      error_count: 0,
    },
    batchRows: [
      {
        id: "row-invalid-date",
        row_kind: "transaction",
        status: "error",
        message: "Invalid posted_at for selected import range",
        payload: txRow({
          external_id: "bad-date",
          posted_at: "bad-date",
        }),
      },
    ],
  });

  const payload = await assertJsonResponse<{
    inserted: number;
    skipped: number;
    error_count: number;
    row_results: Array<{ status: string; message?: string | null }>;
  }>(
    await applyBatchAction({ batch_id: "batch-1" }, userAuth, {
      repository,
      now: () => new Date("2026-01-31T23:59:59.000Z"),
    }),
    200,
  );

  assertEquals(payload.inserted, 0);
  assertEquals(payload.skipped, 0);
  assertEquals(payload.error_count, 1);
  assertEquals(payload.row_results[0]?.status, "error");
  assertEquals(payload.row_results[0]?.message, "Invalid posted_at for selected import range");
  assertEquals(state.reportRows.filter((row) => row.row_kind === "transaction").length, 1);
});

Deno.test("discardBatchAction marks preview batch discarded", async () => {
  const { repository, state } = createRepositoryMock({
    batch: {
      id: "batch-1",
      status: "pending",
      payer_person_id: "person-1",
      source: "tbank_web",
    },
  });

  const payload = await assertJsonResponse<{ batch_id: string; status: string }>(
    await discardBatchAction({ batch_id: "batch-1" }, userAuth, {
      repository,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    }),
    200,
  );

  assertEquals(payload.batch_id, "batch-1");
  assertEquals(payload.status, "discarded");
  assertEquals(state.batchUpdates.length, 1);
  assertEquals(state.batchUpdates[0].patch.status, "discarded");
});

Deno.test(
  "remapPreviewCardAction rewrites pending preview rows to the selected account",
  async () => {
    const { repository, state } = createRepositoryMock({
      batch: {
        id: "batch-1",
        status: "pending",
        payer_person_id: "person-1",
        source: "tbank_web",
      },
      batchRows: [
        {
          id: "row-1",
          batch_id: "batch-1",
          parent_row_id: null,
          row_kind: "transaction",
          source_row_index: 0,
          source_line_index: null,
          status: "inserted",
          message: null,
          transaction_id: null,
          line_item_id: null,
          payload: txRow({
            external_id: "fresh-tx",
            account_id: "acc-1",
            account_hint: "1234",
            card_id: "card-created",
            raw_payload: { account_hint: "**** 1234" },
          }),
        },
        {
          id: "row-2",
          batch_id: "batch-1",
          parent_row_id: "row-1",
          row_kind: "line_item",
          source_row_index: 0,
          source_line_index: 0,
          status: "inserted",
          message: null,
          transaction_id: null,
          line_item_id: null,
          payload: { title: "line", amount: 10 },
        },
      ],
    });

    const payload = await assertJsonResponse<{
      batch_id: string;
      previous_card_id: string;
      resulting_card_id: string;
      target_account_id: string;
      updated_row_count: number;
    }>(
      await remapPreviewCardAction(
        {
          batch_id: "batch-1",
          card_id: "card-created",
          target_account_id: "acc-2",
        },
        userAuth,
        { repository },
      ),
      200,
    );

    assertEquals(payload.batch_id, "batch-1");
    assertEquals(payload.previous_card_id, "card-created");
    assertEquals(payload.resulting_card_id, "card-created");
    assertEquals(payload.target_account_id, "acc-2");
    assertEquals(payload.updated_row_count, 1);
    assertEquals(state.deletedBatchIds, ["batch-1"]);
    assertEquals(state.resolveCardCalls[state.resolveCardCalls.length - 1]?.accountId, "acc-2");
    assertEquals(state.resolveCardCalls[state.resolveCardCalls.length - 1]?.createIfMissing, true);

    const rewrittenTxRow = state.reportRows.find((row) => row.row_kind === "transaction");
    assertEquals((rewrittenTxRow?.payload as Record<string, unknown>)?.account_id, "acc-2");
    assertEquals((rewrittenTxRow?.payload as Record<string, unknown>)?.card_id, "card-created");

    const rewrittenLineItemRow = state.reportRows.find((row) => row.row_kind === "line_item");
    assertEquals(rewrittenLineItemRow?.parent_row_id, "report-1");
  },
);

Deno.test(
  "previewRowsAction records filtered rows without line items for selected range",
  async () => {
    const { repository, state } = createRepositoryMock();

    const payload = await assertJsonResponse<{
      inserted: number;
      skipped: number;
      error_count: number;
      row_results: Array<{ status: string; message?: string | null }>;
    }>(
      await previewRowsAction(
        {
          payer_person_id: "person-1",
          source: "tbank_web",
          batch_id: "batch-1",
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
              posted_at: "bad-date",
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
    assertEquals(payload.row_results[0].message, "Outside selected import range");
    assertEquals(payload.row_results[1].message, "Invalid posted_at for selected import range");

    const transactionRows = state.reportRows.filter((row) => row.row_kind === "transaction");
    const lineRows = state.reportRows.filter((row) => row.row_kind === "line_item");
    assertEquals(transactionRows.length, 3);
    assertEquals(lineRows.length, 1);
  },
);

Deno.test("applyBatchAction does not replay filtered preview rows", async () => {
  const { repository, state } = createRepositoryMock({
    batch: {
      id: "batch-1",
      status: "pending",
      payer_person_id: "person-1",
      source: "tbank_web",
      import_type: "file",
      file_path: "bank.csv",
      parsed_transactions_count: 2,
      inserted_count: 0,
      skipped_count: 1,
      error_count: 1,
      window_from: "2026-01-10T00:00:00.000Z",
      window_to: "2026-01-20T23:59:59.000Z",
    },
    batchRows: [
      {
        id: "row-outside",
        row_kind: "transaction",
        status: "skipped",
        message: "Outside selected import range",
        payload: txRow({
          external_id: "before-range",
          posted_at: "2026-01-05T09:00:00.000Z",
          line_items: [{ title: "before-line", amount: 10 }],
        }),
      },
      {
        id: "row-valid",
        row_kind: "transaction",
        status: "inserted",
        message: null,
        payload: txRow({
          external_id: "in-range",
          posted_at: "2026-01-12T09:00:00.000Z",
          line_items: [{ title: "kept-line", amount: 10 }],
        }),
      },
      {
        id: "row-valid-line",
        row_kind: "line_item",
        payload: { title: "kept-line", amount: 10 },
      },
    ],
  });

  const payload = await assertJsonResponse<{
    inserted: number;
    skipped: number;
    error_count: number;
    row_results: Array<{ status: string; message?: string | null }>;
  }>(
    await applyBatchAction(
      {
        batch_id: "batch-1",
      },
      userAuth,
      { repository, now: () => new Date("2026-01-01T00:00:00.000Z") },
    ),
    200,
  );

  assertEquals(payload.inserted, 1);
  assertEquals(payload.skipped, 1);
  assertEquals(payload.error_count, 0);
  assertEquals(payload.row_results[0].message, "Outside selected import range");
  assertEquals(payload.row_results[1].status, "inserted");
  assertEquals(state.reportRows.filter((row) => row.row_kind === "line_item").length, 1);
});
