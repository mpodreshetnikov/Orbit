// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { previewRowsAction } from "./preview-rows.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type {
  AuthContext,
  BatchBrandResolutionInput,
  CanonicalTransactionRowInput,
} from "./types.ts";

interface PreviewRowsRepoState {
  batch: Record<string, unknown> | null;
  session: Record<string, unknown> | null;
  batchUpdates: Array<{ batchId: string; patch: Record<string, unknown> }>;
  sessionUpdates: Array<{ sessionId: string; patch: Record<string, unknown> }>;
  reportRows: Record<string, unknown>[];
  deletedReportRowsCount: number;
  deletedBatchBrandResolutionsCount: number;
  batchBrandResolutions: BatchBrandResolutionInput[];
}

function createRepositoryMock(
  options: {
    batch?: Record<string, unknown> | null;
    session?: Record<string, unknown> | null;
  } = {},
): { repository: MoneyImportRepository; state: PreviewRowsRepoState } {
  const state: PreviewRowsRepoState = {
    batch:
      options.batch === undefined
        ? {
            id: "batch-1",
            status: "running",
            parsed_transactions_count: 0,
            inserted_count: 0,
            skipped_count: 0,
            error_count: 0,
            meta: null,
          }
        : options.batch,
    session: options.session ?? null,
    batchUpdates: [],
    sessionUpdates: [],
    reportRows: [],
    deletedReportRowsCount: 0,
    deletedBatchBrandResolutionsCount: 0,
    batchBrandResolutions: [],
  };

  const repository: MoneyImportRepository = {
    authenticateAllowedUser: async () => null,
    getSessionByToken: async () => null,
    findLastImportedAt: async () => null,
    createImportSession: async () => ({ id: "session-1" }),
    getImportSessionForUser: async () => state.session,
    getImportSessionById: async () => state.session,
    updateImportSession: async (sessionId, patch) => {
      state.sessionUpdates.push({ sessionId, patch });
      if (state.session && state.session.id === sessionId) {
        Object.assign(state.session, patch);
      }
    },
    createImportBatch: async (payload) => {
      state.batch = {
        id: "batch-created",
        status: "running",
        parsed_transactions_count: 0,
        inserted_count: 0,
        skipped_count: 0,
        error_count: 0,
        ...payload,
      };
      return "batch-created";
    },
    getImportBatch: async (batchId) =>
      state.batch && state.batch.id === batchId ? state.batch : null,
    getImportBatchForUser: async (batchId) =>
      state.batch && state.batch.id === batchId ? state.batch : null,
    updateImportBatch: async (batchId, patch) => {
      state.batchUpdates.push({ batchId, patch });
      if (state.batch && state.batch.id === batchId) {
        Object.assign(state.batch, patch);
      }
    },
    resolveAccountIdForRow: async (_payerPersonId, row, _fallbackSource, defaultAccountId) =>
      row.account_id ?? defaultAccountId ?? "acc-1",
    resolveCardIdForRow: async () => null,
    getExistingTransactionStates: async () => [],
    previewBrandResolutionForRow: async () => null,
    upsertBatchBrandResolution: async (_batchId, payload) => {
      const existingIndex = state.batchBrandResolutions.findIndex(
        (item) => item.source === payload.source && item.source_key === payload.source_key,
      );
      if (existingIndex >= 0) {
        state.batchBrandResolutions[existingIndex] = payload;
        return;
      }
      state.batchBrandResolutions.push(payload);
    },
    deleteBatchBrandResolutionsByBatch: async () => {
      state.deletedBatchBrandResolutionsCount += 1;
      state.batchBrandResolutions = [];
    },
    getBatchBrandResolutionById: async () => null,
    listBatchBrandResolutions: async () => [],
    updateBatchBrandResolutionSelection: async () => {},
    findExistingTransactionId: async (row) => (row.external_id === "dup-tx" ? "tx-dup" : null),
    findExistingLineItemId: async () => null,
    repairExistingTransactionDetails: async () => ({
      replaced_synthetic_line_items: false,
      has_only_synthetic_line_items: false,
      has_real_line_items: false,
      blocked_by_manual_edit: false,
    }),
    insertOrResolveTransaction: async () => ({ transactionId: "unused", inserted: true }),
    insertLineItemIfNew: async () => ({ lineItemId: "unused", inserted: true }),
    insertReportRow: async (payload) => {
      state.reportRows.push(payload);
      return `report-${state.reportRows.length}`;
    },
    listReportRowsByBatch: async () => state.reportRows,
    deleteReportRowsByBatch: async () => {
      state.deletedReportRowsCount += 1;
      state.reportRows = [];
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

function createSessionAuth(session: Record<string, unknown>): AuthContext {
  return {
    mode: "session",
    token: "session-token",
    session,
  };
}

function txRow(partial: Partial<CanonicalTransactionRowInput> = {}): CanonicalTransactionRowInput {
  return {
    source: "tbank_web",
    posted_at: "2026-01-15T12:00:00.000Z",
    amount: 10,
    currency: "RUB",
    transaction_type: "expense",
    status: "posted",
    merchant_name: "Coffee",
    is_transfer: false,
    line_items: [{ title: "Coffee", amount: 10 }],
    ...partial,
  };
}

Deno.test(
  "previewRowsAction preserves single-shot behavior when chunk metadata is absent",
  async () => {
    const { repository, state } = createRepositoryMock({ batch: null });

    const payload = await assertJsonResponse<{
      batch_id: string;
      inserted: number;
      skipped: number;
      error_count: number;
      row_results: Array<{ idx: number; status: string }>;
    }>(
      await previewRowsAction(
        {
          payer_person_id: "person-1",
          source: "tbank_web",
          import_type: "file",
          rows: [txRow({ external_id: "ok-1" })],
        },
        userAuth,
        { repository, now: () => new Date("2026-03-09T00:00:00.000Z") },
      ),
      200,
    );

    assertEquals(payload.batch_id, "batch-created");
    assertEquals(payload.inserted, 1);
    assertEquals(payload.skipped, 0);
    assertEquals(payload.error_count, 0);
    assertEquals(payload.row_results[0].idx, 0);
    assertEquals(payload.row_results[0].status, "inserted");
    assertEquals(state.deletedReportRowsCount, 1);
    assertEquals(state.deletedBatchBrandResolutionsCount, 1);
    assertEquals(state.batch?.status, "pending");
    assertEquals(state.batch?.parsed_transactions_count, 1);
  },
);

Deno.test("previewRowsAction persists receipt skip fields on transaction report rows", async () => {
  const { repository, state } = createRepositoryMock({ batch: null });

  await assertJsonResponse(
    await previewRowsAction(
      {
        payer_person_id: "person-1",
        source: "tbank_web",
        import_type: "file",
        rows: [
          txRow({
            external_id: "receipt-skip-1",
            receipt_request_key: "auth-1",
            receipt_enrichment_status: "rate_limited",
          }),
        ],
      },
      userAuth,
      { repository, now: () => new Date("2026-03-09T00:00:00.000Z") },
    ),
    200,
  );

  const transactionRow = state.reportRows.find((row) => row.row_kind === "transaction");
  assertEquals(transactionRow?.receipt_request_key, "auth-1");
  assertEquals(transactionRow?.receipt_enrichment_status, "rate_limited");
});

Deno.test(
  "previewRowsAction accumulates chunked preview state and keeps absolute source row indexes",
  async () => {
    const rangeSelectionMeta = {
      selection_mode: "preset",
      preset_key: "1y",
      prompted_for_history: true,
      last_imported_at_at_decision_time: null,
      stale_threshold_days: 365,
    };
    const session = {
      id: "session-1",
      batch_id: "batch-1",
      source: "tbank_web",
      payer_person_id: "person-1",
      status: "running",
      revoked_at: null,
      expires_at: "2999-01-01T00:00:00.000Z",
      meta: {
        parsed_row_count: 99,
        range_selection_meta: rangeSelectionMeta,
      },
    };
    const { repository, state } = createRepositoryMock({
      batch: {
        id: "batch-1",
        status: "running",
        parsed_transactions_count: 99,
        inserted_count: 99,
        skipped_count: 99,
        error_count: 99,
        meta: {
          parsed_row_count: 99,
          in_range_row_count: 98,
          filtered_out_of_range_count: 1,
          filtered_invalid_date_count: 0,
          range_selection_meta: rangeSelectionMeta,
        },
      },
      session,
    });
    const sessionAuth = createSessionAuth(session);

    const firstChunkPayload = await assertJsonResponse<{
      inserted: number;
      skipped: number;
      error_count: number;
      row_results: Array<{ idx: number; status: string }>;
    }>(
      await previewRowsAction(
        {
          rows: [txRow({ external_id: "ok-1" }), txRow({ external_id: "dup-tx" })],
          parsed_transactions_count: 3,
          chunk_index: 0,
          chunk_count: 2,
          row_offset: 0,
          total_row_count: 3,
          is_final_chunk: false,
          meta: {
            range_selection_meta: rangeSelectionMeta,
          },
        },
        sessionAuth,
        { repository, now: () => new Date("2026-03-09T00:00:00.000Z") },
      ),
      200,
    );

    assertEquals(firstChunkPayload.inserted, 1);
    assertEquals(firstChunkPayload.skipped, 1);
    assertEquals(firstChunkPayload.error_count, 0);
    assertEquals(
      firstChunkPayload.row_results.map((row) => row.idx),
      [0, 1],
    );
    assertEquals(state.deletedReportRowsCount, 1);
    assertEquals(state.deletedBatchBrandResolutionsCount, 1);
    assertEquals(state.batch?.status, "running");
    assertEquals(state.batch?.inserted_count, 1);
    assertEquals(state.batch?.skipped_count, 1);
    assertEquals(state.batch?.error_count, 0);
    assertEquals((state.batch?.meta as Record<string, unknown>).parsed_row_count, 2);
    assertEquals(
      (
        (state.batch?.meta as Record<string, unknown>).range_selection_meta as Record<
          string,
          unknown
        >
      ).preset_key,
      "1y",
    );

    const secondChunkPayload = await assertJsonResponse<{
      inserted: number;
      skipped: number;
      error_count: number;
      row_results: Array<{ idx: number; status: string; message?: string | null }>;
    }>(
      await previewRowsAction(
        {
          rows: [txRow({ posted_at: "not-a-date" })],
          parsed_transactions_count: 3,
          chunk_index: 1,
          chunk_count: 2,
          row_offset: 2,
          total_row_count: 3,
          is_final_chunk: true,
        },
        sessionAuth,
        { repository, now: () => new Date("2026-03-09T00:00:00.000Z") },
      ),
      200,
    );

    assertEquals(secondChunkPayload.inserted, 0);
    assertEquals(secondChunkPayload.skipped, 0);
    assertEquals(secondChunkPayload.error_count, 1);
    assertEquals(secondChunkPayload.row_results[0].idx, 2);
    assertEquals(
      secondChunkPayload.row_results[0].message,
      "Invalid posted_at for selected import range",
    );
    assertEquals(state.deletedReportRowsCount, 1);
    assertEquals(state.deletedBatchBrandResolutionsCount, 1);
    assertEquals(state.batch?.status, "pending");
    assertEquals(state.batch?.parsed_transactions_count, 3);
    assertEquals(state.batch?.inserted_count, 1);
    assertEquals(state.batch?.skipped_count, 1);
    assertEquals(state.batch?.error_count, 1);
    assertEquals((state.batch?.meta as Record<string, unknown>).parsed_row_count, 3);
    assertEquals((state.batch?.meta as Record<string, unknown>).filtered_invalid_date_count, 1);
    const transactionRows = state.reportRows.filter((row) => row.row_kind === "transaction");
    assertEquals(
      transactionRows.map((row) => row.source_row_index),
      [0, 1, 2],
    );
    assertEquals(state.session?.status, "running");
  },
);

Deno.test("previewRowsAction clears parsed rows once per preview attempt", async () => {
  const { repository, state } = createRepositoryMock({
    batch: {
      id: "batch-1",
      status: "running",
      payer_person_id: "person-1",
      source: "tbank_web",
      parsed_transactions_count: 0,
      inserted_count: 0,
      skipped_count: 0,
      error_count: 0,
      meta: null,
    },
  });

  const chunkZero = {
    batch_id: "batch-1",
    payer_person_id: "person-1",
    source: "tbank_web",
    rows: [txRow({ external_id: "ok-1" })],
    chunk_index: 0,
    chunk_count: 2,
    row_offset: 0,
    total_row_count: 2,
    is_final_chunk: false,
    preview_attempt_id: "attempt-1",
  };

  await assertJsonResponse(
    await previewRowsAction(chunkZero, userAuth, {
      repository,
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    }),
    200,
  );
  assertEquals(state.deletedReportRowsCount, 1);

  // A replay of chunk zero within the same attempt must not wipe what already landed.
  await assertJsonResponse(
    await previewRowsAction(chunkZero, userAuth, {
      repository,
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    }),
    200,
  );
  assertEquals(state.deletedReportRowsCount, 1);

  // A genuinely new run carries a new attempt id and starts from a clean batch.
  await assertJsonResponse(
    await previewRowsAction({ ...chunkZero, preview_attempt_id: "attempt-2" }, userAuth, {
      repository,
      now: () => new Date("2026-03-09T00:00:00.000Z"),
    }),
    200,
  );
  assertEquals(state.deletedReportRowsCount, 2);

  // Callers that send no attempt id keep the previous behaviour.
  const { repository: legacyRepository, state: legacyState } = createRepositoryMock({
    batch: {
      id: "batch-1",
      status: "running",
      payer_person_id: "person-1",
      source: "tbank_web",
      parsed_transactions_count: 0,
      inserted_count: 0,
      skipped_count: 0,
      error_count: 0,
      meta: null,
    },
  });
  const legacyChunkZero = { ...chunkZero };
  delete (legacyChunkZero as Record<string, unknown>).preview_attempt_id;
  for (let attempt = 0; attempt < 2; attempt++) {
    await assertJsonResponse(
      await previewRowsAction(legacyChunkZero, userAuth, {
        repository: legacyRepository,
        now: () => new Date("2026-03-09T00:00:00.000Z"),
      }),
      200,
    );
  }
  assertEquals(legacyState.deletedReportRowsCount, 2);
});
