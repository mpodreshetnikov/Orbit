import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MoneyImportReportPage from "./page";

const importActionMock = vi.fn();

vi.mock("../../money-import-client", () => ({
  getAccessToken: vi.fn(async () => "access-token"),
  callMoneyImportAction: (...args: unknown[]) => importActionMock(...args),
}));

let paramsState: { batchId?: string } = { batchId: "batch-1" };
let batchResult: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};
let rowsResult: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};
let accountsResult: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};
let cardsResult: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};
let brandResolutionsResult: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};
let brandsResult: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};
const rpcMock = vi.fn();

// The key, plus any values, so "Line items (1)" is distinguishable from "Line items (2)".
// One function for the whole test, as next-intl's is stable for a locale: a fresh `t` on every
// render would re-run every effect that depends on it.
const translate = (key: string, values?: Record<string, string | number>) =>
  values ? `${key} ${Object.values(values).join(" ")}` : key;

vi.mock("next-intl", () => ({
  useTranslations: () => translate,
}));

vi.mock("next/navigation", () => ({
  useParams: () => paramsState,
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "money_import_batches") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          single: async () => batchResult,
        };
      }

      if (table === "money_accounts") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          in() {
            return this;
          },
          order() {
            return this;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve(accountsResult).then(resolve);
          },
        };
      }

      if (table === "money_cards") {
        return {
          select() {
            return this;
          },
          in() {
            return this;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve(cardsResult).then(resolve);
          },
        };
      }

      if (table === "money_import_batch_brand_resolutions") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          order() {
            return this;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve(brandResolutionsResult).then(resolve);
          },
        };
      }

      if (table === "money_transaction_brands") {
        return {
          select() {
            return this;
          },
          order() {
            return this;
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve(brandsResult).then(resolve);
          },
        };
      }

      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(rowsResult).then(resolve);
        },
      };
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}));

function makeBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "batch-1",
    source: "tbank_csv",
    payer_person_id: "person-1",
    status: "done",
    parsed_transactions_count: 2,
    inserted_count: 1,
    skipped_count: 1,
    completed_at: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

function makeRows() {
  return [
    {
      id: "tx-1",
      batch_id: "batch-1",
      parent_row_id: null,
      row_kind: "transaction",
      source_row_index: 1,
      source_line_index: null,
      status: "inserted",
      message: "inserted ok",
      payload: {
        account_id: "account-1",
        card_id: "card-1",
        posted_at: "2026-01-01T09:00:00.000Z",
        amount: -250,
        currency: "RUB",
        cashback_amount: 25,
        cashback_currency: "RUB",
        merchant_name: "Store A",
        comment: "Main row comment",
        operation_icon_url: "https://cdn.example.com/store-a.png",
        source_category_id: "cat-1",
        source_category_name: "Food",
        source_brand: {
          name: "Store Brand",
          logo_url: "https://cdn.example.com/store-brand.png",
        },
        raw_payload: { debug: "hidden" },
      },
      created_at: "2026-01-01T09:00:00.000Z",
    },
    {
      id: "line-1",
      batch_id: "batch-1",
      parent_row_id: "tx-1",
      row_kind: "line_item",
      source_row_index: 1,
      source_line_index: 1,
      status: "error",
      message: "line error",
      payload: {
        title: "Item A",
        amount: -125,
        quantity: 2,
        unit: "pcs",
        cashback_amount: 10,
        cashback_currency: "RUB",
        comment: "Line item comment",
        raw_payload: { debug: "hidden" },
      },
      created_at: "2026-01-01T09:00:01.000Z",
    },
    {
      id: "tx-2",
      batch_id: "batch-1",
      parent_row_id: null,
      row_kind: "transaction",
      source_row_index: 2,
      source_line_index: null,
      status: "skipped",
      message: "duplicate",
      payload: {
        account_id: "account-1",
        posted_at: "2026-01-01T10:00:00.000Z",
        amount: 100,
        currency: "RUB",
        cashback_amount: 0,
        cashback_currency: "RUB",
        merchant_name: "Store B",
      },
      created_at: "2026-01-01T10:00:00.000Z",
    },
  ];
}

describe("MoneyImportReportPage", () => {
  beforeEach(() => {
    paramsState = { batchId: "batch-1" };
    batchResult = { data: null, error: null };
    rowsResult = { data: null, error: null };
    accountsResult = { data: [], error: null };
    cardsResult = { data: [], error: null };
    brandResolutionsResult = { data: [], error: null };
    brandsResult = { data: [], error: null };
    rpcMock.mockReset();
    importActionMock.mockReset();
  });

  it("shows missing batch id error", async () => {
    paramsState = {};
    render(<MoneyImportReportPage />);

    expect(await screen.findByText("money.importReportBatchIdMissing")).toBeInTheDocument();
  });

  it("shows batch fetch error and rows fetch error states", async () => {
    batchResult = { data: null, error: { message: "Batch not found from db" } };
    render(<MoneyImportReportPage />);
    expect(await screen.findByText("Batch not found from db")).toBeInTheDocument();

    batchResult = { data: makeBatch(), error: null };
    rowsResult = { data: null, error: { message: "Rows fetch failed" } };
    render(<MoneyImportReportPage />);
    expect(await screen.findByText("Rows fetch failed")).toBeInTheDocument();
  });

  it("renders readable report table with expandable line items and JSON modal", async () => {
    batchResult = { data: makeBatch(), error: null };
    rowsResult = { data: makeRows(), error: null };
    accountsResult = {
      data: [{ id: "account-1", account_label: "Main account" }],
      error: null,
    };
    cardsResult = {
      data: [
        {
          id: "card-1",
          account_id: "account-1",
          card_label: "Travel card",
          last4: "1234",
        },
      ],
      error: null,
    };

    render(<MoneyImportReportPage />);

    await waitFor(() => {
      expect(screen.getByText("money.importResultsTitle")).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "money.importViewHistory" })).toHaveAttribute(
      "href",
      "/money/import/history",
    );

    expect(screen.getByTestId("report-table-header-row")).toBeInTheDocument();
    expect(screen.getByText("money.importReportColumnDate")).toBeInTheDocument();
    expect(screen.getByText("money.importReportColumnStatus")).toBeInTheDocument();
    expect(screen.getByText("money.importReportColumnAmount")).toBeInTheDocument();
    expect(screen.getByText("money.importReportColumnCashback")).toBeInTheDocument();
    expect(screen.getByText("money.importReportColumnCard")).toBeInTheDocument();
    expect(screen.getByText("money.importReportColumnDetails")).toBeInTheDocument();

    expect(screen.getByText("Store A")).toBeInTheDocument();
    expect(screen.getByText("Store B")).toBeInTheDocument();
    expect(screen.getByText("Main row comment")).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("Store Brand")).toBeInTheDocument();
    expect(screen.getByText("Main account / Travel card")).toBeInTheDocument();
    expect(screen.getByText("money.importResultRowInserted")).toBeInTheDocument();
    expect(screen.getByText("money.importResultRowSkipped")).toBeInTheDocument();
    expect(screen.queryByText("money.importResultRowError")).not.toBeInTheDocument();
    expect(screen.getByText("-250 RUB")).toBeInTheDocument();
    expect(screen.getByText("25 RUB")).toBeInTheDocument();
    expect(screen.getByText("money.importReportLineItemsCount 1")).toBeInTheDocument();

    expect(screen.queryByText(/payload_json/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^account_id$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^card_id$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw_payload/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Source$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^External$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Type$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Account$/i)).not.toBeInTheDocument();

    const user = userEvent.setup();
    const storeARow = screen.getByText("Store A").closest("section");
    expect(storeARow).not.toBeNull();
    await user.click(within(storeARow!).getByRole("button", { name: /^JSON$/i }));

    expect(
      await screen.findByRole("heading", {
        name: /money\.importReportTransactionPayloadTitle Store A/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/"merchant_name": "Store A"/)).toBeInTheDocument();
    expect(screen.getByText(/"raw_payload"/)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", {
          name: /money\.importReportTransactionPayloadTitle Store A/,
        }),
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /money\.importReportLineItemsCount 1/ }));

    expect(await screen.findByText("Item A")).toBeInTheDocument();
    expect(screen.getByText("money.importReportLineNumber 1")).toBeInTheDocument();
    expect(screen.getByText("-125 RUB")).toBeInTheDocument();
    expect(screen.getByText("10 RUB")).toBeInTheDocument();
    expect(screen.getByText("2 pcs")).toBeInTheDocument();
    expect(screen.getByText("Line item comment")).toBeInTheDocument();
    expect(screen.getByText("money.importResultRowError")).toBeInTheDocument();

    const jsonButtonsAfterExpand = screen.getAllByRole("button", { name: /^JSON$/i });
    await user.click(jsonButtonsAfterExpand[2]!);
    expect(
      await screen.findByRole("heading", { name: /money\.importReportLinePayloadTitle Item A/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/"title": "Item A"/)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /money\.importReportLinePayloadTitle Item A/ }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows dom fallback warning for tbank web batches", async () => {
    batchResult = {
      data: makeBatch({
        source: "tbank_web",
      }),
      error: null,
    };
    rowsResult = {
      data: [
        {
          id: "tx-dom",
          batch_id: "batch-1",
          parent_row_id: null,
          row_kind: "transaction",
          source_row_index: 1,
          source_line_index: null,
          status: "inserted",
          message: null,
          payload: {
            posted_at: "2026-01-01T09:00:00.000Z",
            amount: -10,
            currency: "RUB",
            merchant_name: "Fallback store",
            raw_payload: {
              connector_source: "tbank_web",
              extraction_method: "dom",
            },
          },
          created_at: "2026-01-01T09:00:00.000Z",
        },
      ],
      error: null,
    };

    render(<MoneyImportReportPage />);

    expect(await screen.findByText("money.importReportDomFallbackWarning")).toBeInTheDocument();
  });

  it("shows transactions without full details count for tbank web batches", async () => {
    batchResult = {
      data: makeBatch({
        source: "tbank_web",
      }),
      error: null,
    };
    rowsResult = {
      data: [
        {
          id: "tx-receipt-skip",
          batch_id: "batch-1",
          parent_row_id: null,
          row_kind: "transaction",
          source_row_index: 1,
          source_line_index: null,
          status: "inserted",
          message: null,
          receipt_enrichment_status: "rate_limited",
          payload: {
            posted_at: "2026-01-01T09:00:00.000Z",
            amount: -10,
            currency: "RUB",
            merchant_name: "Receipt-limited store",
            receipt_enrichment_status: "rate_limited",
          },
          created_at: "2026-01-01T09:00:00.000Z",
        },
        {
          id: "tx-receipt-budget",
          batch_id: "batch-1",
          parent_row_id: null,
          row_kind: "transaction",
          source_row_index: 2,
          source_line_index: null,
          status: "inserted",
          message: null,
          payload: {
            posted_at: "2026-01-01T10:00:00.000Z",
            amount: -20,
            currency: "RUB",
            merchant_name: "Receipt-budget store",
            receipt_enrichment_status: "skipped_after_budget",
          },
          created_at: "2026-01-01T10:00:00.000Z",
        },
      ],
      error: null,
    };

    render(<MoneyImportReportPage />);

    expect(
      await screen.findByText("money.importReportSummaryWithoutDetails 2"),
    ).toBeInTheDocument();
    expect(await screen.findByText("money.importReportReceiptWarning 2")).toBeInTheDocument();
  });

  it("shows transaction posted date and orders transactions by newest date first", async () => {
    batchResult = { data: makeBatch(), error: null };
    rowsResult = {
      data: [
        {
          id: "tx-older",
          batch_id: "batch-1",
          parent_row_id: null,
          row_kind: "transaction",
          source_row_index: 1,
          source_line_index: null,
          status: "inserted",
          message: null,
          payload: {
            posted_at: "2026-01-01T09:00:00.000Z",
            amount: -10,
            currency: "RUB",
            merchant_name: "Older store",
          },
          created_at: "2026-01-03T09:00:00.000Z",
        },
        {
          id: "tx-newer",
          batch_id: "batch-1",
          parent_row_id: null,
          row_kind: "transaction",
          source_row_index: 2,
          source_line_index: null,
          status: "inserted",
          message: null,
          payload: {
            posted_at: "2026-01-02T11:30:00.000Z",
            amount: -20,
            currency: "RUB",
            merchant_name: "Newer store",
          },
          created_at: "2026-01-01T08:00:00.000Z",
        },
      ],
      error: null,
    };

    const { container } = render(<MoneyImportReportPage />);

    await waitFor(() => {
      expect(screen.getByText("Older store")).toBeInTheDocument();
      expect(screen.getByText("Newer store")).toBeInTheDocument();
    });

    const scrollBody = screen.getByTestId("report-table-scroll-body");
    expect(scrollBody.textContent).toContain("02.01.2026");
    expect(scrollBody.textContent).toContain("01.01.2026");

    const newerStore = screen.getByText("Newer store");
    const olderStore = screen.getByText("Older store");
    const newerSection = newerStore.closest("section");
    const olderSection = olderStore.closest("section");

    expect(newerSection).not.toBeNull();
    expect(olderSection).not.toBeNull();
    expect(
      newerSection!.compareDocumentPosition(olderSection as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(container.textContent?.indexOf("Newer store")).toBeLessThan(
      container.textContent?.indexOf("Older store") ?? Number.POSITIVE_INFINITY,
    );
  });

  it("renders empty grouped rows state", async () => {
    batchResult = { data: makeBatch({ completed_at: null }), error: null };
    rowsResult = { data: [], error: null };

    render(<MoneyImportReportPage />);

    expect(await screen.findByText("money.importReportNoRows")).toBeInTheDocument();
  });

  it("shows pending preview actions, applies batch, and keeps card mapping available", async () => {
    batchResult = {
      data: makeBatch({
        status: "pending",
        completed_at: null,
        source: "tbank_web",
      }),
      error: null,
    };
    rowsResult = { data: makeRows(), error: null };
    accountsResult = {
      data: [{ id: "account-1", account_label: "Main account" }],
      error: null,
    };
    cardsResult = {
      data: [
        {
          id: "card-1",
          account_id: "account-1",
          card_label: "Travel card",
          last4: "1234",
        },
      ],
      error: null,
    };
    importActionMock.mockResolvedValue({
      batch_id: "batch-1",
      inserted: 1,
      skipped: 0,
      error_count: 0,
      row_results: [],
    });

    render(<MoneyImportReportPage />);

    expect(await screen.findByText("money.importPendingReviewBanner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "money.importApplyBatch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "money.importDiscardBatch" })).toBeInTheDocument();
    expect(screen.getByText("money.importReportCardMapping")).toBeInTheDocument();
    expect(screen.getByTestId("card-remap-apply-card-1")).toBeDisabled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "money.importApplyBatch" }));

    await waitFor(() => {
      expect(importActionMock).toHaveBeenCalledWith(
        {
          action: "apply_batch",
          batch_id: "batch-1",
        },
        "access-token",
      );
    });
  });

  it("renders pending brand decisions and auto-saves overrides before apply", async () => {
    batchResult = {
      data: makeBatch({
        status: "pending",
        completed_at: null,
        source: "tbank_web",
      }),
      error: null,
    };
    rowsResult = { data: makeRows(), error: null };
    brandResolutionsResult = {
      data: [
        {
          id: "resolution-1",
          batch_id: "batch-1",
          source: "tbank",
          source_key: "known-brand",
          source_name: "Known Brand",
          website_url: "https://known.example.com",
          logo_url: "https://cdn.example.com/known-brand.png",
          base_color: null,
          base_text_color: null,
          suggested_brand_id: "brand-1",
          suggested_confidence: 90,
          suggested_reason: "name_match",
          selected_action: "create_new",
          selected_brand_id: null,
          created_at: "2026-01-01T10:00:00.000Z",
          updated_at: "2026-01-01T10:00:00.000Z",
        },
      ],
      error: null,
    };
    brandsResult = {
      data: [
        { id: "brand-1", name: "Known Brand", slug: "known-brand" },
        { id: "brand-2", name: "Manual Brand", slug: "manual-brand" },
      ],
      error: null,
    };
    importActionMock.mockResolvedValue({
      ok: true,
    });

    render(<MoneyImportReportPage />);

    expect(await screen.findByText("money.importReportBrandReview")).toBeInTheDocument();
    expect(await screen.findByText("money.importReportBrandConfidence 90")).toBeInTheDocument();
    expect(screen.getAllByText("Known Brand").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("img", { name: "money.importReportBrandLogoAlt Known Brand" }),
    ).toHaveAttribute("src", "https://cdn.example.com/known-brand.png");

    fireEvent.change(screen.getByTestId("brand-resolution-action-resolution-1"), {
      target: { value: "match_existing" },
    });
    fireEvent.change(screen.getByTestId("brand-resolution-brand-resolution-1"), {
      target: { value: "brand-2" },
    });

    expect(screen.queryByTestId("brand-resolution-save-resolution-1")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(importActionMock).toHaveBeenCalledWith(
        {
          action: "update_brand_resolution",
          resolution_id: "resolution-1",
          selected_action: "match_existing",
          selected_brand_id: "brand-2",
        },
        "access-token",
      );
    });
  });

  it("hides zero-confidence brand decisions inside a collapsed new brands block", async () => {
    batchResult = {
      data: makeBatch({
        status: "pending",
        completed_at: null,
        source: "tbank_web",
      }),
      error: null,
    };
    rowsResult = { data: makeRows(), error: null };
    brandResolutionsResult = {
      data: [
        {
          id: "resolution-1",
          batch_id: "batch-1",
          source: "tbank",
          source_key: "known-brand",
          source_name: "Known Brand",
          website_url: "https://known.example.com",
          logo_url: "https://cdn.example.com/known-brand.png",
          base_color: null,
          base_text_color: null,
          suggested_brand_id: "brand-1",
          suggested_confidence: 90,
          suggested_reason: "name_match",
          selected_action: "create_new",
          selected_brand_id: null,
          created_at: "2026-01-01T10:00:00.000Z",
          updated_at: "2026-01-01T10:00:00.000Z",
        },
        {
          id: "resolution-2",
          batch_id: "batch-1",
          source: "tbank",
          source_key: "new-brand",
          source_name: "Unseen Brand",
          website_url: "https://unseen.example.com",
          logo_url: "https://cdn.example.com/unseen-brand.png",
          base_color: null,
          base_text_color: null,
          suggested_brand_id: null,
          suggested_confidence: 0,
          suggested_reason: "create_new",
          selected_action: "create_new",
          selected_brand_id: null,
          created_at: "2026-01-01T10:00:00.000Z",
          updated_at: "2026-01-01T10:00:00.000Z",
        },
      ],
      error: null,
    };
    brandsResult = {
      data: [{ id: "brand-1", name: "Known Brand", slug: "known-brand" }],
      error: null,
    };

    render(<MoneyImportReportPage />);

    expect(await screen.findByText("money.importReportBrandReview")).toBeInTheDocument();
    expect(screen.getByText("money.importReportBrandConfidence 90")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /money\.importReportNewBrandsToReview/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Unseen Brand")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /money\.importReportNewBrandsToReview/ }));

    expect(await screen.findByText("Unseen Brand")).toBeInTheDocument();
    expect(screen.getByText("money.importReportBrandConfidence 0")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "money.importReportBrandLogoAlt Unseen Brand" }),
    ).toHaveAttribute("src", "https://cdn.example.com/unseen-brand.png");
  });

  it("shows discarded batch state without review actions", async () => {
    batchResult = {
      data: makeBatch({
        status: "discarded",
        completed_at: "2026-01-01T10:30:00.000Z",
      }),
      error: null,
    };
    rowsResult = { data: makeRows(), error: null };

    render(<MoneyImportReportPage />);

    expect(await screen.findByText("money.importDiscardedBanner")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "money.importApplyBatch" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "money.importDiscardBatch" }),
    ).not.toBeInTheDocument();
  });

  it("virtualizes long report lists and updates scroll position", async () => {
    batchResult = { data: makeBatch({ parsed_transactions_count: 65 }), error: null };
    rowsResult = {
      data: Array.from({ length: 65 }).map((_, index) => ({
        id: `tx-${index + 1}`,
        batch_id: "batch-1",
        parent_row_id: null,
        row_kind: "transaction",
        source_row_index: index + 1,
        source_line_index: null,
        status: "inserted",
        message: null,
        payload: {
          posted_at: "2026-01-01T09:00:00.000Z",
          amount: -(index + 1),
          currency: "RUB",
          merchant_name: `Store ${index + 1}`,
        },
        created_at: "2026-01-01T09:00:00.000Z",
      })),
      error: null,
    };

    render(<MoneyImportReportPage />);

    expect(await screen.findByText("Store 1")).toBeInTheDocument();

    const scrollBody = screen.getByTestId("report-table-scroll-body");
    Object.defineProperty(scrollBody, "scrollTop", {
      configurable: true,
      value: 2400,
      writable: true,
    });
    fireEvent.scroll(scrollBody);

    await waitFor(() => {
      expect(screen.queryByText("Store 1")).not.toBeInTheDocument();
    });
  });

  it("keeps long lists virtualized while expanded rows are toggled", async () => {
    batchResult = { data: makeBatch({ parsed_transactions_count: 65 }), error: null };
    rowsResult = {
      data: [
        ...Array.from({ length: 65 }).map((_, index) => ({
          id: `tx-${index + 1}`,
          batch_id: "batch-1",
          parent_row_id: null,
          row_kind: "transaction",
          source_row_index: index + 1,
          source_line_index: null,
          status: "inserted",
          message: null,
          payload: {
            posted_at: "2026-02-01T09:00:00.000Z",
            amount: -(index + 1),
            currency: "RUB",
            merchant_name: `Store ${index + 1}`,
          },
          created_at: "2026-03-01T09:00:00.000Z",
        })),
        {
          id: "line-50-1",
          batch_id: "batch-1",
          parent_row_id: "tx-50",
          row_kind: "line_item",
          source_row_index: 50,
          source_line_index: 1,
          status: "inserted",
          message: null,
          payload: {
            title: "Expanded item",
            amount: -50,
            currency: "RUB",
            quantity: 1,
            unit: "pcs",
          },
          created_at: "2026-03-10T09:00:01.000Z",
        },
      ],
      error: null,
    };

    const user = userEvent.setup();
    render(<MoneyImportReportPage />);

    expect(await screen.findByTestId("report-table-scroll-body")).toBeInTheDocument();

    const scrollBody = screen.getByTestId("report-table-scroll-body");
    Object.defineProperty(scrollBody, "scrollTop", {
      configurable: true,
      value: 3600,
      writable: true,
    });
    fireEvent.scroll(scrollBody);

    await waitFor(() => {
      expect(screen.queryByText("Store 1")).not.toBeInTheDocument();
      expect(screen.getByText("Store 50")).toBeInTheDocument();
    });

    const store50Row = screen.getByText("Store 50").closest("section");
    expect(store50Row).not.toBeNull();

    await user.click(
      within(store50Row!).getByRole("button", { name: /money\.importReportLineItemsCount 1/ }),
    );

    expect(await screen.findByText("Expanded item")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByText("Store 1")).not.toBeInTheDocument();
    });

    await user.click(
      within(store50Row!).getByRole("button", { name: /money\.importReportLineItemsCount 1/ }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Expanded item")).not.toBeInTheDocument();
      expect(screen.queryByText("Store 1")).not.toBeInTheDocument();
      expect(screen.getByText("Store 50")).toBeInTheDocument();
    });
  });

  it("does not re-enter row measurement indefinitely after scrolling", async () => {
    batchResult = { data: makeBatch({ parsed_transactions_count: 65 }), error: null };
    rowsResult = {
      data: Array.from({ length: 65 }).map((_, index) => ({
        id: `tx-${index + 1}`,
        batch_id: "batch-1",
        parent_row_id: null,
        row_kind: "transaction",
        source_row_index: index + 1,
        source_line_index: null,
        status: "inserted",
        message: null,
        payload: {
          posted_at: "2026-01-01T09:00:00.000Z",
          amount: -(index + 1),
          currency: "RUB",
          merchant_name: `Store ${index + 1}`,
        },
        created_at: "2026-01-01T09:00:00.000Z",
      })),
      error: null,
    };

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    let unstableMeasurements = false;
    let measurementCount = 0;

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        if (!unstableMeasurements) {
          return 96;
        }
        measurementCount += 1;
        return measurementCount % 2 === 0 ? 96 : 97;
      },
    });

    try {
      render(<MoneyImportReportPage />);

      expect(await screen.findByText("Store 1")).toBeInTheDocument();

      const scrollBody = screen.getByTestId("report-table-scroll-body");
      Object.defineProperty(scrollBody, "scrollTop", {
        configurable: true,
        value: 2400,
        writable: true,
      });

      unstableMeasurements = true;
      fireEvent.scroll(scrollBody);

      await waitFor(() => {
        expect(screen.queryByText("Store 1")).not.toBeInTheDocument();
      });

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("Maximum update depth exceeded"),
      );
    } finally {
      consoleErrorSpy.mockRestore();
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      } else {
        // Match the pre-test environment when offsetHeight was inherited.
        Reflect.deleteProperty(HTMLElement.prototype, "offsetHeight");
      }
    }
  });

  it("renders card mapping panel for current batch cards and calls remap rpc", async () => {
    batchResult = {
      data: makeBatch({
        source: "tbank_web",
        payer_person_id: "person-1",
      }),
      error: null,
    };
    rowsResult = { data: makeRows(), error: null };
    accountsResult = {
      data: [
        { id: "account-1", account_label: "Main account" },
        { id: "account-2", account_label: "Reserve account" },
      ],
      error: null,
    };
    cardsResult = {
      data: [
        {
          id: "card-1",
          account_id: "account-1",
          card_label: "Travel card",
          last4: "1234",
        },
      ],
      error: null,
    };
    rpcMock.mockResolvedValue({
      data: [{ resulting_card_id: "card-1", moved_transactions_count: 2, merged: false }],
      error: null,
    });

    render(<MoneyImportReportPage />);

    expect(await screen.findByText("money.importReportCardMapping")).toBeInTheDocument();
    expect(screen.getByText("Travel card")).toBeInTheDocument();
    const user = userEvent.setup();

    fireEvent.change(screen.getByTestId("card-remap-select-card-1"), {
      target: { value: "account-2" },
    });
    await user.click(screen.getByTestId("card-remap-apply-card-1"));

    await waitFor(() => {
      expect(rpcMock).toHaveBeenCalledWith("money_reassign_card_account", {
        p_card_id: "card-1",
        p_target_account_id: "account-2",
      });
    });
  });
});
