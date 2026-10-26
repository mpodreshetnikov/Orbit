import { describe, expect, it } from "vitest";
import {
  batchesInWindow,
  feedQueryForReviewPeriod,
  importOutcome,
  importReviewWindow,
  summarizeImportBatches,
} from "./money-import-review";

const now = new Date(2026, 9, 26, 12, 0, 0);

function batch(createdAt: Date, status: string, inserted = 0, skipped = 0, errors = 0) {
  return {
    created_at: createdAt.toISOString(),
    status: status as "completed",
    inserted_count: inserted,
    skipped_count: skipped,
    error_count: errors,
  };
}

describe("importReviewWindow", () => {
  it("covers the last 7 and 30 days for a week and a month", () => {
    expect(importReviewWindow("week", now)).toEqual({
      from: new Date(2026, 9, 19, 12, 0, 0),
      to: now,
    });
    expect(importReviewWindow("month", now).from).toEqual(new Date(2026, 8, 26, 12, 0, 0));
  });

  it("reads custom days as whole local days and ignores what is not a date", () => {
    expect(importReviewWindow("custom", now, { from: "2026-10-01", to: "2026-10-05" })).toEqual({
      from: new Date(2026, 9, 1, 0, 0, 0, 0),
      to: new Date(2026, 9, 5, 23, 59, 59, 999),
    });
    expect(importReviewWindow("custom", now, { from: "yesterday" })).toEqual({
      from: null,
      to: null,
    });
    expect(importReviewWindow("all", now)).toEqual({ from: null, to: null });
  });
});

describe("batchesInWindow and summarizeImportBatches", () => {
  const batches = [
    batch(new Date(2026, 9, 25), "completed", 10, 2, 1),
    batch(new Date(2026, 9, 24), "rolled_back", 5),
    batch(new Date(2026, 9, 23), "failed"),
    batch(new Date(2026, 9, 22), "running", 3),
    batch(new Date(2026, 8, 1), "completed", 100),
  ];

  it("keeps the batches started inside the window", () => {
    expect(batchesInWindow(batches, importReviewWindow("week", now))).toHaveLength(4);
    expect(batchesInWindow(batches, importReviewWindow("all", now))).toHaveLength(5);
    expect(batchesInWindow([{ created_at: "nonsense" }], { from: null, to: null })).toEqual([]);
  });

  it("adds up only what applied batches landed and counts rollbacks and failures apart", () => {
    expect(
      summarizeImportBatches(batchesInWindow(batches, importReviewWindow("week", now))),
    ).toEqual({ imports: 4, inserted: 10, skipped: 2, errors: 1, failed: 1, rolledBack: 1 });
  });
});

describe("feedQueryForReviewPeriod", () => {
  it("points at the feed's matching window", () => {
    expect(feedQueryForReviewPeriod("week")).toBe("preset=7d");
    expect(feedQueryForReviewPeriod("month")).toBe("preset=30d");
    expect(feedQueryForReviewPeriod("custom", { from: "2026-10-01", to: "2026-10-05" })).toBe(
      "preset=custom&from=2026-10-01&to=2026-10-05",
    );
    expect(feedQueryForReviewPeriod("custom", { from: "2026-10-01" })).toBeNull();
    expect(feedQueryForReviewPeriod("all")).toBeNull();
  });
});

describe("importOutcome", () => {
  it("names what an import's page leads with", () => {
    expect(importOutcome("running")).toBe("running");
    expect(importOutcome("completed")).toBe("applied");
    expect(importOutcome("pending")).toBe("awaiting");
    expect(importOutcome("rolled_back")).toBe("rolled_back");
    expect(importOutcome("failed")).toBe("failed");
    expect(importOutcome("discarded")).toBe("discarded");
  });
});
