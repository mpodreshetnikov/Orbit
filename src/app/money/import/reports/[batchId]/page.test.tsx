import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MoneyImportReportPage from "./page";

let paramsState: { batchId?: string } = { batchId: "batch-1" };
let batchResult: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};
let rowsResult: { data: unknown; error: { message: string } | null } = {
  data: null,
  error: null,
};

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
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
  }),
}));

function makeBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "batch-1",
    source: "tbank_csv",
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
        posted_at: "2026-01-01T09:00:00.000Z",
        amount: -250,
        currency: "RUB",
        merchant_name: "Store A",
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
        posted_at: "2026-01-01T10:00:00.000Z",
        amount: -100,
        currency: "RUB",
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
  });

  it("shows missing batch id error", async () => {
    paramsState = {};
    render(<MoneyImportReportPage />);

    expect(await screen.findByText("Batch id is missing")).toBeInTheDocument();
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

  it("renders grouped report details and row statuses", async () => {
    batchResult = { data: makeBatch(), error: null };
    rowsResult = { data: makeRows(), error: null };

    render(<MoneyImportReportPage />);

    await waitFor(() => {
      expect(screen.getByText("money.importResultsTitle")).toBeInTheDocument();
    });

    expect(screen.getByText("Store A")).toBeInTheDocument();
    expect(screen.getByText("Store B")).toBeInTheDocument();
    expect(screen.getByText("Item A")).toBeInTheDocument();
    expect(screen.getByText("No line items reported.")).toBeInTheDocument();
    expect(screen.getByText("money.importResultRowInserted")).toBeInTheDocument();
    expect(screen.getByText("money.importResultRowSkipped")).toBeInTheDocument();
    expect(screen.getByText("money.importResultRowError")).toBeInTheDocument();
  });

  it("renders empty grouped rows state", async () => {
    batchResult = { data: makeBatch({ completed_at: null }), error: null };
    rowsResult = { data: [], error: null };

    render(<MoneyImportReportPage />);

    expect(await screen.findByText("No rows imported for this batch.")).toBeInTheDocument();
  });
});
