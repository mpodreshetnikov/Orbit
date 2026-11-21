import { describe, expect, it } from "vitest";
import { spendingReportFxSyncRange } from "./money-spending-report-sync";

describe("spendingReportFxSyncRange", () => {
  it("caps sync end at today when the period is still open", () => {
    expect(
      spendingReportFxSyncRange({ start: "2026-10-01", end: "2026-10-31" }, "2026-10-28"),
    ).toEqual({ start: "2026-10-01", end: "2026-10-28" });
  });

  it("uses the period end when the period finished before today", () => {
    expect(
      spendingReportFxSyncRange({ start: "2026-10-01", end: "2026-10-20" }, "2026-10-28"),
    ).toEqual({ start: "2026-10-01", end: "2026-10-20" });
  });

  it("syncs a single day that equals today", () => {
    expect(
      spendingReportFxSyncRange({ start: "2026-10-28", end: "2026-10-28" }, "2026-10-28"),
    ).toEqual({ start: "2026-10-28", end: "2026-10-28" });
  });

  it("skips sync when the whole period is still ahead", () => {
    expect(
      spendingReportFxSyncRange({ start: "2026-11-01", end: "2026-11-30" }, "2026-10-28"),
    ).toBeNull();
  });
});
