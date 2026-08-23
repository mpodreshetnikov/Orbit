// deno-lint-ignore-file require-await
import { assertEquals } from "std/assert/assert-equals";
import { assertJsonResponse } from "../_shared/testing/response.ts";
import { remapPreviewCardAction } from "./remap-preview-card.ts";
import type { MoneyImportRepository } from "./repository.ts";
import type { AuthContext, CanonicalTransactionRowInput } from "./types.ts";

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

function createRepositoryMock(options: {
  batch?: Record<string, unknown> | null;
  rows?: Record<string, unknown>[];
  resultingCardId?: string | null;
}) {
  const insertedRows: Record<string, unknown>[] = [];

  const repository: MoneyImportRepository = {
    authenticateAllowedUser: async () => null,
    getSessionByToken: async () => null,
    getGrantByToken: async () => null,
    markGrantUsed: async () => {},
    findLastImportedAt: async () => null,
    createImportSession: async () => ({ id: "session-1" }),
    getImportSessionForUser: async () => null,
    getImportSessionById: async () => null,
    updateImportSession: async () => {},
    createImportBatch: async () => "batch-1",
    getImportBatch: async () => options.batch ?? null,
    getImportBatchForUser: async () => options.batch ?? null,
    updateImportBatch: async () => {},
    getExistingTransactionStates: async () => [],
    listReportRowsByBatch: async () => options.rows ?? [],
    deleteReportRowsByBatch: async () => {},
    resolveAccountIdForRow: async () => {
      throw new Error("unused");
    },
    resolveCardIdForRow: async () => options.resultingCardId ?? null,
    findExistingTransactionId: async () => null,
    findAdoptableTransactionId: async () => null,
    findExistingLineItemId: async () => null,
    repairExistingTransactionDetails: async () => ({
      replaced_synthetic_line_items: false,
      has_only_synthetic_line_items: false,
      has_real_line_items: false,
      blocked_by_manual_edit: false,
    }),
    insertOrResolveTransaction: async () => {
      throw new Error("unused");
    },
    insertLineItemIfNew: async () => {
      throw new Error("unused");
    },
    insertReportRow: async (payload) => {
      insertedRows.push(payload);
      return `report-${insertedRows.length}`;
    },
  };

  return { repository, insertedRows };
}

Deno.test("remapPreviewCardAction validates required parameters and auth", async () => {
  const { repository } = createRepositoryMock({});

  assertEquals(
    (
      await assertJsonResponse<{ error: string }>(
        await remapPreviewCardAction({}, userAuth, { repository }),
        400,
      )
    ).error,
    "batch_id is required",
  );
  assertEquals(
    (
      await assertJsonResponse<{ error: string }>(
        await remapPreviewCardAction({ batch_id: "batch-1" }, userAuth, { repository }),
        400,
      )
    ).error,
    "card_id is required",
  );
  assertEquals(
    (
      await assertJsonResponse<{ error: string }>(
        await remapPreviewCardAction({ batch_id: "batch-1", card_id: "card-1" }, userAuth, {
          repository,
        }),
        400,
      )
    ).error,
    "target_account_id is required",
  );
  assertEquals(
    (
      await assertJsonResponse<{ error: string }>(
        await remapPreviewCardAction(
          {
            batch_id: "batch-1",
            card_id: "card-1",
            target_account_id: "acc-2",
          },
          { mode: "session", token: "token", session: { id: "session-1" } },
          { repository },
        ),
        401,
      )
    ).error,
    "Unauthorized",
  );
});

Deno.test(
  "remapPreviewCardAction rejects missing batch, invalid status, and unmapped cards",
  async () => {
    assertEquals(
      (
        await assertJsonResponse<{ error: string }>(
          await remapPreviewCardAction(
            {
              batch_id: "batch-1",
              card_id: "card-1",
              target_account_id: "acc-2",
            },
            userAuth,
            { repository: createRepositoryMock({ batch: null }).repository },
          ),
          404,
        )
      ).error,
      "Batch not found",
    );

    assertEquals(
      (
        await assertJsonResponse<{ error: string }>(
          await remapPreviewCardAction(
            {
              batch_id: "batch-1",
              card_id: "card-1",
              target_account_id: "acc-2",
            },
            userAuth,
            {
              repository: createRepositoryMock({
                batch: { id: "batch-1", status: "completed" },
              }).repository,
            },
          ),
          409,
        )
      ).error,
      "Batch is not awaiting review",
    );

    assertEquals(
      (
        await assertJsonResponse<{ error: string }>(
          await remapPreviewCardAction(
            {
              batch_id: "batch-1",
              card_id: "card-1",
              target_account_id: "acc-2",
            },
            userAuth,
            {
              repository: createRepositoryMock({
                batch: { id: "batch-1", status: "pending" },
                rows: [],
              }).repository,
            },
          ),
          404,
        )
      ).error,
      "Preview card mapping not found in batch",
    );
  },
);

Deno.test(
  "remapPreviewCardAction rejects rows without hint or target card resolution",
  async () => {
    const hintlessRows = [
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
          card_id: "card-1",
          raw_payload: {},
        }),
      },
    ];

    assertEquals(
      (
        await assertJsonResponse<{ error: string }>(
          await remapPreviewCardAction(
            {
              batch_id: "batch-1",
              card_id: "card-1",
              target_account_id: "acc-2",
            },
            userAuth,
            {
              repository: createRepositoryMock({
                batch: { id: "batch-1", status: "pending" },
                rows: hintlessRows,
              }).repository,
            },
          ),
          400,
        )
      ).error,
      "Preview card hint is missing",
    );

    const unresolvedRows = [
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
          card_id: "card-1",
          account_hint: "1234",
          raw_payload: { account_hint: "**** 1234" },
        }),
      },
    ];

    assertEquals(
      (
        await assertJsonResponse<{ error: string }>(
          await remapPreviewCardAction(
            {
              batch_id: "batch-1",
              card_id: "card-1",
              target_account_id: "acc-2",
            },
            userAuth,
            {
              repository: createRepositoryMock({
                batch: { id: "batch-1", status: "pending" },
                rows: unresolvedRows,
                resultingCardId: null,
              }).repository,
            },
          ),
          400,
        )
      ).error,
      "Could not resolve target preview card",
    );
  },
);

Deno.test(
  "remapPreviewCardAction rewrites matching preview rows and preserves line items",
  async () => {
    const { repository, insertedRows } = createRepositoryMock({
      batch: { id: "batch-1", status: "pending" },
      resultingCardId: "card-target",
      rows: [
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
            card_id: "card-1",
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
        {
          id: "row-3",
          batch_id: "batch-1",
          parent_row_id: null,
          row_kind: "transaction",
          source_row_index: 1,
          source_line_index: null,
          status: "inserted",
          message: null,
          transaction_id: null,
          line_item_id: null,
          payload: txRow({
            external_id: "other-tx",
            account_id: "acc-9",
            account_hint: "9999",
            card_id: "card-9",
            raw_payload: { account_hint: "**** 9999" },
          }),
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
          card_id: "card-1",
          target_account_id: "acc-2",
        },
        userAuth,
        { repository },
      ),
      200,
    );

    assertEquals(payload, {
      batch_id: "batch-1",
      previous_card_id: "card-1",
      resulting_card_id: "card-target",
      target_account_id: "acc-2",
      updated_row_count: 1,
    });

    const rewrittenTransaction = insertedRows[0]?.payload as Record<string, unknown>;
    assertEquals(rewrittenTransaction.account_id, "acc-2");
    assertEquals(rewrittenTransaction.card_id, "card-target");
    assertEquals(
      (rewrittenTransaction.raw_payload as Record<string, unknown>).account_hint,
      "1234",
    );

    const preservedLineItem = insertedRows[2];
    assertEquals(preservedLineItem.parent_row_id, "report-1");

    const untouchedTransaction = insertedRows[1]?.payload as Record<string, unknown>;
    assertEquals(untouchedTransaction.account_id, "acc-9");
    assertEquals(untouchedTransaction.card_id, "card-9");
  },
);
