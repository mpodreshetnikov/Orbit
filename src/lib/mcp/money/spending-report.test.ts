import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMoneySpendingReport } from "./spending-report";

describe("fetchMoneySpendingReport", () => {
  const rpc = vi.fn();
  const invoke = vi.fn();
  const supabase = { rpc, functions: { invoke } } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    invoke.mockResolvedValue({ data: null, error: null });
    rpc.mockResolvedValue({
      data: {
        period: {
          start: "2026-11-01",
          end: "2026-11-30",
          days: 30,
          previous_start: "2026-10-02",
          previous_end: "2026-10-31",
          last_year: 2025,
        },
        currency: "RUB",
        totals: {
          income: 1,
          expense: 2,
          net: -1,
          previous_income: 0,
          previous_expense: 0,
          previous_net: 0,
          last_year_income: 0,
          last_year_expense: 0,
          last_year_net: 0,
        },
        forecast: null,
        categories: [],
        days: [],
        merchants: [],
        fx_status: { status: "ok", missing: [] },
      },
      error: null,
    });
  });

  it("syncs FX then calls money_get_spending_report", async () => {
    const report = await fetchMoneySpendingReport(supabase, {
      personId: "p-1",
      period: { start: "2026-11-01", end: "2026-11-30" },
      currency: "RUB",
      accountIds: [],
      categoryId: null,
      today: "2026-11-09",
    });

    expect(invoke).toHaveBeenCalledWith("money-fx-sync", {
      body: {
        start_date: "2026-11-01",
        end_date: "2026-11-09",
        base_currency: "USD",
        quote_currencies: ["RUB"],
      },
    });
    expect(rpc).toHaveBeenCalledWith("money_get_spending_report", {
      p_person_id: "p-1",
      p_start: "2026-11-01",
      p_end: "2026-11-30",
      p_report_currency: "RUB",
      p_account_ids: null,
      p_category_id: null,
      p_today: "2026-11-09",
    });
    expect(report.totals.expense).toBe(2);
  });

  it("skips FX sync for a period entirely in the future", async () => {
    await fetchMoneySpendingReport(supabase, {
      personId: "p-1",
      period: { start: "2026-12-01", end: "2026-12-31" },
      currency: "USD",
      accountIds: ["a-1"],
      categoryId: "food",
      today: "2026-11-09",
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      "money_get_spending_report",
      expect.objectContaining({
        p_account_ids: ["a-1"],
        p_category_id: "food",
        p_report_currency: "USD",
      }),
    );
  });
});
