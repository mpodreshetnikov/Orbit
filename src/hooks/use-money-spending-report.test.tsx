import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";
import {
  moneySpendingReportQueryKey,
  useMoneySpendingReport,
} from "@/hooks/use-money-spending-report";

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

function renderHookWithQueryClient<T>(hook: () => T) {
  const queryClient = createTestQueryClient();
  const wrapper = createTestQueryWrapper(queryClient);
  return {
    queryClient,
    ...renderHook(hook, { wrapper }),
  };
}

describe("useMoneySpendingReport (UX filters)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    vi.useRealTimers();
  });

  it("passes brand and merchant filters and returns UX forecast fields", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    const invoke = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const rpc = vi.fn(async () => ({
      data: {
        period: {
          start: "2026-10-01",
          end: "2026-10-31",
          days: 31,
          compare_days: 28,
          previous_start: "2026-09-01",
          previous_end: "2026-09-30",
          previous_compare_end: "2026-09-28",
          last_year: 2025,
        },
        currency: "RUB",
        totals: { expense: 2200 },
        forecast: { expense: 2500, income: 3000, days_left: 3 },
        merchants: [{ name: "Cafe", expense: 100, previous_expense: 40, transaction_count: 2 }],
        categories: [],
        days: [],
        fx_status: { status: "ok" },
      },
      error: null,
    }));
    createClientMock.mockReturnValue({ functions: { invoke }, rpc });

    const { result } = renderHookWithQueryClient(() =>
      useMoneySpendingReport({
        personId: "person-1",
        period: { start: "2026-10-01", end: "2026-10-31" },
        currency: "RUB",
        accountIds: ["acc-2", "acc-1"],
        categoryId: "food",
        brandId: "brand-1",
        merchantName: "Cafe",
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith("money_get_spending_report", {
      p_person_id: "person-1",
      p_start: "2026-10-01",
      p_end: "2026-10-31",
      p_report_currency: "RUB",
      p_account_ids: ["acc-2", "acc-1"],
      p_category_id: "food",
      p_brand_id: "brand-1",
      p_merchant_name: "Cafe",
    });
    expect(result.current.data?.period.compare_days).toBe(28);
    expect(result.current.data?.forecast).toEqual({
      expense: 2500,
      income: 3000,
      net: 500,
      days_left: 3,
    });
    expect(result.current.data?.merchants[0]?.previous_expense).toBe(40);
  });

  it("sends null merchant filters and null account ids when unset", async () => {
    const invoke = vi.fn(async () => ({ data: null, error: null }));
    const rpc = vi.fn(async () => ({
      data: { currency: "RUB", totals: { expense: 1 }, forecast: null },
      error: null,
    }));
    createClientMock.mockReturnValue({ functions: { invoke }, rpc });

    const { result } = renderHookWithQueryClient(() =>
      useMoneySpendingReport({
        personId: "person-1",
        period: { start: "2025-03-01", end: "2025-03-31" },
        currency: "RUB",
        accountIds: [],
        categoryId: null,
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith(
      "money_get_spending_report",
      expect.objectContaining({
        p_account_ids: null,
        p_category_id: null,
        p_brand_id: null,
        p_merchant_name: null,
      }),
    );
    expect(result.current.data?.forecast).toBeNull();
  });

  it("surfaces sync failures and skips FX for a future period", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));

    const invokeFail = vi.fn(async () => ({ data: null, error: { message: "sync failed" } }));
    createClientMock.mockReturnValue({ functions: { invoke: invokeFail }, rpc: vi.fn() });
    const failed = renderHookWithQueryClient(() =>
      useMoneySpendingReport({
        personId: "person-1",
        period: { start: "2026-10-01", end: "2026-10-31" },
        currency: "RUB",
        accountIds: [],
        categoryId: null,
      }),
    );
    await waitFor(() => expect(failed.result.current.isError).toBe(true));
    expect(failed.result.current.error?.message).toBe("sync failed");

    const invoke = vi.fn();
    const rpc = vi.fn(async () => ({ data: {}, error: null }));
    createClientMock.mockReturnValue({ functions: { invoke }, rpc });
    const future = renderHookWithQueryClient(() =>
      useMoneySpendingReport({
        personId: "person-1",
        period: { start: "2026-11-01", end: "2026-11-30" },
        currency: "RUB",
        accountIds: [],
        categoryId: null,
      }),
    );
    await waitFor(() => expect(future.result.current.isSuccess).toBe(true));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("waits for a person before querying", async () => {
    const rpc = vi.fn();
    createClientMock.mockReturnValue({ functions: { invoke: vi.fn() }, rpc });
    const { result } = renderHookWithQueryClient(() =>
      useMoneySpendingReport({
        personId: null,
        period: { start: "2026-10-01", end: "2026-10-31" },
        currency: "RUB",
        accountIds: [],
        categoryId: null,
      }),
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("surfaces rpc failures", async () => {
    const invoke = vi.fn(async () => ({ data: null, error: null }));
    const rpc = vi.fn(async () => ({ data: null, error: { message: "rpc failed" } }));
    createClientMock.mockReturnValue({ functions: { invoke }, rpc });
    const { result } = renderHookWithQueryClient(() =>
      useMoneySpendingReport({
        personId: "person-1",
        period: { start: "2025-03-01", end: "2025-03-31" },
        currency: "RUB",
        accountIds: [],
        categoryId: null,
      }),
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("rpc failed");
  });

  it("syncs through the period end when the period ended before today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    const invoke = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const rpc = vi.fn(async () => ({ data: { currency: "RUB", totals: {} }, error: null }));
    createClientMock.mockReturnValue({ functions: { invoke }, rpc });
    const { result } = renderHookWithQueryClient(() =>
      useMoneySpendingReport({
        personId: "person-1",
        period: { start: "2026-09-01", end: "2026-09-30" },
        currency: "RUB",
        accountIds: [],
        categoryId: null,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invoke).toHaveBeenCalledWith("money-fx-sync", {
      body: {
        start_date: "2026-09-01",
        end_date: "2026-09-30",
        base_currency: "USD",
        quote_currencies: ["RUB"],
      },
    });
  });

  it("still syncs when the period starts on the sync end day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
    const invoke = vi.fn(async () => ({ data: { ok: true }, error: null }));
    const rpc = vi.fn(async () => ({ data: { currency: "RUB", totals: {} }, error: null }));
    createClientMock.mockReturnValue({ functions: { invoke }, rpc });
    const { result } = renderHookWithQueryClient(() =>
      useMoneySpendingReport({
        personId: "person-1",
        // start === today === syncEnd; must still invoke (kills < vs <= on start).
        period: { start: "2026-10-28", end: "2026-10-28" },
        currency: "RUB",
        accountIds: [],
        categoryId: null,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      "money-fx-sync",
      expect.objectContaining({
        body: expect.objectContaining({
          start_date: "2026-10-28",
          end_date: "2026-10-28",
          quote_currencies: ["RUB"],
        }),
      }),
    );
  });

  it("builds a sorted query key that includes merchant filters", async () => {
    const base = {
      personId: "person-1",
      period: { start: "2026-10-01", end: "2026-10-31" },
      currency: "RUB",
      categoryId: "food" as string | null,
      brandId: "brand-1",
      merchantName: "Cafe",
    };
    expect(moneySpendingReportQueryKey({ ...base, accountIds: ["acc-2", "acc-1"] })).toEqual(
      moneySpendingReportQueryKey({ ...base, accountIds: ["acc-1", "acc-2"] }),
    );
    expect(moneySpendingReportQueryKey({ ...base, accountIds: ["acc-2", "acc-1"] })).toEqual([
      "money-spending-report",
      "person-1",
      "2026-10-01",
      "2026-10-31",
      "RUB",
      "acc-1,acc-2",
      "food",
      "brand-1",
      "Cafe",
    ]);
    expect(
      moneySpendingReportQueryKey({
        ...base,
        accountIds: [],
        brandId: undefined,
        merchantName: undefined,
      }),
    ).toEqual([
      "money-spending-report",
      "person-1",
      "2026-10-01",
      "2026-10-31",
      "RUB",
      "",
      "food",
      null,
      null,
    ]);
  });

  it("keeps previous report data as placeholder while the category filter changes", async () => {
    const invoke = vi.fn(async () => ({ data: { ok: true }, error: null }));
    type RpcResult = { data: unknown; error: null };
    const second = Promise.withResolvers<RpcResult>();
    const rpc = vi
      .fn()
      .mockImplementation(async (_fn: string, args: { p_category_id: string | null }) => {
        if (args.p_category_id === "food") {
          return {
            data: { currency: "RUB", totals: { expense: 1 }, forecast: null },
            error: null,
          } satisfies RpcResult;
        }
        return await second.promise;
      });
    createClientMock.mockReturnValue({ functions: { invoke }, rpc });
    let categoryId: string | null = "food";
    const { result, rerender } = renderHookWithQueryClient(() =>
      useMoneySpendingReport({
        personId: "person-1",
        period: { start: "2025-03-01", end: "2025-03-31" },
        currency: "RUB",
        accountIds: [],
        categoryId,
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.totals.expense).toBe(1);

    categoryId = "travel";
    rerender();
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    expect(result.current.data?.totals.expense).toBe(1);

    second.resolve({
      data: { currency: "RUB", totals: { expense: 99 }, forecast: null },
      error: null,
    });
    await waitFor(() => expect(result.current.data?.totals.expense).toBe(99));
    expect(result.current.isPlaceholderData).toBe(false);
  });
});
