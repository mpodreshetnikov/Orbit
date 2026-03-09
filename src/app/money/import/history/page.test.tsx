import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MoneyImportHistoryPage from "./page";

let selectedPersonIdState: string | null = "person-1";
let batchesResult:
  | { data: unknown; error: { message: string } | null }
  | Promise<{ data: unknown; error: { message: string } | null }> = {
  data: [],
  error: null,
};

const eqMock = vi.fn();
const orderMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (key === "money.importHistoryResultsSummary" && values) {
      return `${values.inserted}/${values.skipped}/${values.errors}`;
    }
    return key;
  },
}));

vi.mock("@/stores/ui-store", () => ({
  useUIStore: (selector: (state: { selectedPersonId: string | null }) => unknown) =>
    selector({ selectedPersonId: selectedPersonIdState }),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== "money_import_batches") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select() {
          return this;
        },
        eq(...args: unknown[]) {
          eqMock(...args);
          return this;
        },
        order(...args: unknown[]) {
          orderMock(...args);
          return this;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason?: unknown) => unknown) {
          return Promise.resolve(batchesResult).then(resolve, reject);
        },
      };
    },
  }),
}));

function makeBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: "batch-1",
    source: "tbank_csv",
    payer_person_id: "person-1",
    import_type: "file",
    status: "completed",
    file_path: null,
    session_id: null,
    window_from: null,
    window_to: null,
    parsed_through_at: null,
    parsed_transactions_count: 4,
    inserted_count: 3,
    skipped_count: 1,
    error_count: 0,
    completed_at: "2026-03-01T08:30:00.000Z",
    created_at: "2026-03-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("MoneyImportHistoryPage", () => {
  beforeEach(() => {
    selectedPersonIdState = "person-1";
    batchesResult = { data: [], error: null };
    eqMock.mockReset();
    orderMock.mockReset();
  });

  it("shows the person selection prompt when no person is selected", () => {
    selectedPersonIdState = null;

    render(<MoneyImportHistoryPage />);

    expect(screen.getByText("person.selectPrompt")).toBeInTheDocument();
  });

  it("shows a loading state while batches are being fetched", () => {
    batchesResult = new Promise(() => undefined);

    render(<MoneyImportHistoryPage />);

    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("shows error and empty states", async () => {
    batchesResult = { data: null, error: { message: "history load failed" } };

    const errorView = render(<MoneyImportHistoryPage />);

    expect(await screen.findByText("history load failed")).toBeInTheDocument();
    errorView.unmount();

    batchesResult = { data: [], error: null };
    render(<MoneyImportHistoryPage />);

    expect(await screen.findByText("money.importHistoryEmptyTitle")).toBeInTheDocument();
    expect(screen.getByText("money.importHistoryEmptyHint")).toBeInTheDocument();
  });

  it("queries selected-person batches, renders newest first, and links to reports", async () => {
    batchesResult = {
      data: [
        makeBatch({
          id: "batch-newest",
          status: "running",
          created_at: "2026-03-02T09:00:00.000Z",
          completed_at: null,
          parsed_transactions_count: 8,
          inserted_count: 0,
          skipped_count: 0,
          error_count: 1,
        }),
        makeBatch({
          id: "batch-oldest",
          status: "completed",
          created_at: "2026-03-01T08:00:00.000Z",
          completed_at: "2026-03-01T08:30:00.000Z",
        }),
      ],
      error: null,
    };

    const { container } = render(<MoneyImportHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText("money.importHistoryTitle")).toBeInTheDocument();
    });

    expect(eqMock).toHaveBeenCalledWith("payer_person_id", "person-1");
    expect(orderMock).toHaveBeenCalledWith("created_at", { ascending: false });

    const rows = within(screen.getByTestId("import-history-table")).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(within(rows[1]!).getByText("money.importBatchStatusRunning")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("money.importBatchStatusCompleted")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("8")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("0/0/1")).toBeInTheDocument();
    expect(within(rows[2]!).getByText("3/1/0")).toBeInTheDocument();

    const reportLinks = screen.getAllByRole("link", { name: "money.importOpenReport" });
    expect(reportLinks[0]).toHaveAttribute("href", "/money/import/reports/batch-newest");
    expect(reportLinks[1]).toHaveAttribute("href", "/money/import/reports/batch-oldest");

    expect(container.textContent?.indexOf("batch-newest")).toBeLessThan(
      container.textContent?.indexOf("batch-oldest") ?? Number.POSITIVE_INFINITY,
    );
  });

  it("renders badges for every supported batch status", async () => {
    batchesResult = {
      data: [
        makeBatch({ id: "batch-pending", status: "pending" }),
        makeBatch({ id: "batch-running", status: "running" }),
        makeBatch({ id: "batch-completed", status: "completed" }),
        makeBatch({ id: "batch-failed", status: "failed" }),
        makeBatch({ id: "batch-discarded", status: "discarded" }),
      ],
      error: null,
    };

    render(<MoneyImportHistoryPage />);

    expect(await screen.findByText("money.importBatchStatusPending")).toBeInTheDocument();
    expect(screen.getByText("money.importBatchStatusRunning")).toBeInTheDocument();
    expect(screen.getByText("money.importBatchStatusCompleted")).toBeInTheDocument();
    expect(screen.getByText("money.importBatchStatusFailed")).toBeInTheDocument();
    expect(screen.getByText("money.importBatchStatusDiscarded")).toBeInTheDocument();
  });
});
