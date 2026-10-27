import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MoneyImportHistoryPage from "./page";
import { feedQueryForReviewPeriod } from "@/types/money-import-review";

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
    return values ? `${key} ${Object.values(values).join(" ")}` : key;
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
        makeBatch({ id: "batch-rolled-back", status: "rolled_back" }),
      ],
      error: null,
    };

    render(<MoneyImportHistoryPage />);

    expect(await screen.findByText("money.importBatchStatusPending")).toBeInTheDocument();
    expect(screen.getByText("money.importBatchStatusRunning")).toBeInTheDocument();
    expect(screen.getByText("money.importBatchStatusCompleted")).toBeInTheDocument();
    expect(screen.getByText("money.importBatchStatusFailed")).toBeInTheDocument();
    expect(screen.getByText("money.importBatchStatusDiscarded")).toBeInTheDocument();
    expect(screen.getByText("money.importBatchStatusRolledBack")).toBeInTheDocument();
  });

  it("reviews the imports of the last week, a custom period, or all time", async () => {
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    batchesResult = {
      data: [
        makeBatch({ id: "batch-recent", created_at: daysAgo(2), inserted_count: 5 }),
        makeBatch({ id: "batch-undone", created_at: daysAgo(3), status: "rolled_back" }),
        makeBatch({ id: "batch-old", created_at: daysAgo(20), inserted_count: 40 }),
      ],
      error: null,
    };

    render(<MoneyImportHistoryPage />);

    const summary = await screen.findByTestId("import-review-summary");
    expect(summary).toHaveTextContent("money.importReviewSummary 3 45 2 0");
    expect(screen.queryByRole("link", { name: "money.importReviewOpenFeed" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "money.importReviewPeriodWeek" }));
    expect(summary).toHaveTextContent("money.importReviewSummary 2 5 1 0");
    expect(summary).toHaveTextContent("money.importReviewRolledBack 1");
    expect(within(screen.getByTestId("import-history-table")).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "money.importReviewOpenFeed" })).toHaveAttribute(
      "href",
      "/money/transactions?preset=7d",
    );

    await userEvent.click(screen.getByRole("button", { name: "money.importReviewPeriodCustom" }));
    const day = (offset: number) => daysAgo(offset).slice(0, 10);
    fireEvent.change(screen.getByLabelText("money.importReviewFrom"), {
      target: { value: day(25) },
    });
    fireEvent.change(screen.getByLabelText("money.importReviewTo"), {
      target: { value: day(15) },
    });
    expect(summary).toHaveTextContent("money.importReviewSummary 1 40 1 0");
    expect(screen.getByRole("link", { name: "money.importReviewOpenFeed" })).toHaveAttribute(
      "href",
      `/money/transactions?${feedQueryForReviewPeriod("custom", { from: day(25), to: day(15) })}`,
    );

    fireEvent.change(screen.getByLabelText("money.importReviewTo"), {
      target: { value: day(24) },
    });
    expect(summary).toHaveTextContent("money.importReviewEmpty");
  });

  it("labels an import nobody started, and shows the window each batch covered", async () => {
    batchesResult = {
      data: [
        makeBatch({
          id: "batch-auto",
          source: "tbank_web",
          import_type: "web_export",
          status: "pending",
          window_from: "2026-07-31T09:11:35.308Z",
          window_to: "2026-08-31T09:11:35.308Z",
          meta: { unattended: true, parse_strategy: "full" },
        }),
        makeBatch({
          id: "batch-manual",
          source: "tbank_web",
          import_type: "web_export",
          status: "pending",
          meta: { parse_strategy: "fast" },
        }),
      ],
      error: null,
    };

    render(<MoneyImportHistoryPage />);

    // Two batches from one unattended visit are two windows; the label says nobody started them.
    expect(await screen.findByText("money.importHistoryImportTypeUnattended")).toBeInTheDocument();
    expect(screen.getByText("31.07.2026 – 31.08.2026")).toBeInTheDocument();
    expect(screen.getByText("money.importHistoryImportTypeWebExport")).toBeInTheDocument();
  });
});
