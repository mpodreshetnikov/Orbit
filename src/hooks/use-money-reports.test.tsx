import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";

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

function createTableBuilder(result: { data: unknown; error: { message: string } | null }) {
  const builder = {
    eq: vi.fn(() => builder),
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    order: vi.fn(async () => result),
    single: vi.fn(async () => result),
    match: vi.fn(async () => ({ error: result.error })),
  };
  return builder;
}

describe("use-money-reports", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    vi.useRealTimers();
  });

  it("syncs FX rates before loading and normalizing the budget report", async () => {
    const invoke = vi.fn(async () => ({
      data: { ok: true },
      error: null,
    }));
    const rpc = vi.fn(async () => ({
      data: [
        {
          month_start: "2026-03-01",
          report_currency: "RUB",
          actual_income: 1000,
          actual_expenses: -500,
          actual_net: 500,
          target_income: 1200,
          target_expenses: -600,
          target_net: 600,
          variance_net: -100,
          categories: [
            {
              id: "food",
              name_en: "Food",
              name_ru: "Food RU",
              depth: 1,
              actual_income: 0,
              actual_expenses: -500,
              actual_net: -500,
              target_amount: -600,
              variance_amount: 100,
              target: {
                id: "target-food",
                person_id: "person-1",
                category_id: "food",
                month_start: "2026-03-01",
                target_amount: -600,
                currency: "RUB",
                created_at: "2026-03-01T00:00:00.000Z",
                updated_at: "2026-03-01T00:00:00.000Z",
              },
              children: [],
            },
          ],
          trend: [{ date: "2026-03-01", income: 1000, expenses: -500, net: 500 }],
          fx_status: {
            mode: "ok",
            approximated_dates: [],
            missing_pairs: [],
            message: null,
            is_blocking: false,
          },
        },
      ],
      error: null,
    }));
    createClientMock.mockReturnValue({
      functions: { invoke },
      rpc,
    });

    const { useMoneyBudgetReport } = await import("./use-money-reports");
    const { result } = renderHookWithQueryClient(() =>
      useMoneyBudgetReport("person-1", "2026-02-01", "RUB"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invoke).toHaveBeenCalledWith("money-fx-sync", {
      body: {
        start_date: "2026-02-01",
        end_date: "2026-02-28",
        base_currency: "USD",
        quote_currencies: ["RUB"],
      },
    });
    expect(rpc).toHaveBeenCalledWith("money_get_budget_report", {
      p_person_id: "person-1",
      p_month_start: "2026-02-01",
      p_report_currency: "RUB",
    });
    expect(result.current.data?.categories[0]?.target?.target_amount).toBe(-600);
  });

  it("builds nested categories from flat rpc rows and normalizes fx metadata", async () => {
    const invoke = vi.fn(async () => ({
      data: { ok: true },
      error: null,
    }));
    const rpc = vi.fn(async () => ({
      data: [
        {
          report_month_start: "2026-11-01",
          report_currency: "USD",
          actual_income: 20,
          actual_expense: -9,
          actual_net: 11,
          target_income: 0,
          target_expense: -12,
          target_net: -12,
          net_variance: 23,
          category_rows: [
            {
              id: "food",
              parent_id: null,
              canonical_category_id: "food",
              depth: 1,
              name_en: "Food",
              name_ru: "Food RU",
              slug: "food",
              system_key: "food",
              actual_income: 0,
              actual_expense: -9,
              actual_net: -9,
              direct_target_amount: 0,
              target_amount: -12,
              variance_amount: 3,
            },
            {
              id: "child",
              parent_id: "food",
              canonical_category_id: "food",
              depth: 2,
              name_en: "Coffee",
              name_ru: "Coffee RU",
              slug: "coffee",
              system_key: null,
              actual_income: 0,
              actual_expense: -9,
              actual_net: -9,
              direct_target_amount: -12,
              target_amount: -12,
              variance_amount: 3,
            },
          ],
          trend_points: [
            { date: "2026-11-05", actual_income: 20, actual_expense: -9, actual_net: 11 },
          ],
          fx_status: {
            status: "approximated",
            approximated_conversions: [
              {
                conversion_date: "2026-11-05",
                source_currency: "RUB",
                effective_rate_date: "2026-11-01",
              },
            ],
            missing_conversions: [],
          },
        },
      ],
      error: null,
    }));
    createClientMock.mockReturnValue({
      functions: { invoke },
      rpc,
    });

    const { useMoneyBudgetReport } = await import("./use-money-reports");
    const { result } = renderHookWithQueryClient(() =>
      useMoneyBudgetReport("person-1", "2026-11-01", "USD"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.categories).toHaveLength(1);
    expect(result.current.data?.categories[0]?.children[0]?.id).toBe("child");
    expect(result.current.data?.categories[0]?.children[0]?.target?.target_amount).toBe(-12);
    expect(result.current.data?.trend[0]).toEqual({
      date: "2026-11-05",
      income: 20,
      expenses: -9,
      net: 11,
    });
    expect(result.current.data?.fx_status).toEqual({
      mode: "approximate",
      approximated_dates: ["2026-11-05"],
      missing_pairs: [],
      message: null,
      is_blocking: false,
    });
  });

  it("upserts budget targets and invalidates report queries", async () => {
    const builder = createTableBuilder({
      data: {
        id: "target-food",
        person_id: "person-1",
        category_id: "food",
        month_start: "2026-03-01",
        target_amount: -500,
        currency: "RUB",
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
      },
      error: null,
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useUpsertMoneyBudgetTarget } = await import("./use-money-reports");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpsertMoneyBudgetTarget());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        personId: "person-1",
        categoryId: "food",
        monthStart: "2026-03-01",
        targetAmount: -500,
        currency: "RUB",
      });
    });

    expect(builder.upsert).toHaveBeenCalledWith(
      {
        person_id: "person-1",
        category_id: "food",
        month_start: "2026-03-01",
        target_amount: -500,
        currency: "RUB",
      },
      { onConflict: "person_id,category_id,month_start" },
    );
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("creates and loads self-transfer aliases", async () => {
    const selectBuilder = createTableBuilder({
      data: [
        {
          id: "alias-1",
          person_id: "person-1",
          alias: "Подрешетников М",
          normalized_alias: "подрешетниковм",
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const insertBuilder = createTableBuilder({
      data: {
        id: "alias-2",
        person_id: "person-1",
        alias: "Max Pod",
        normalized_alias: "maxpod",
        created_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:00.000Z",
      },
      error: null,
    });
    const from = vi.fn((relation: string) => {
      if (relation === "money_transfer_self_aliases") {
        return {
          ...selectBuilder,
          insert: vi.fn(() => insertBuilder),
        };
      }
      return selectBuilder;
    });
    createClientMock.mockReturnValue({ from });

    const { useMoneyTransferSelfAliases, useCreateMoneyTransferSelfAlias } =
      await import("./use-money-reports");

    const aliases = renderHookWithQueryClient(() => useMoneyTransferSelfAliases("person-1"));
    await waitFor(() => expect(aliases.result.current.isSuccess).toBe(true));
    expect(aliases.result.current.data?.[0]?.normalized_alias).toBe("подрешетниковм");

    const createAlias = renderHookWithQueryClient(() => useCreateMoneyTransferSelfAlias());
    await act(async () => {
      await createAlias.result.current.mutateAsync({ personId: "person-1", alias: "Max Pod" });
    });

    expect(insertBuilder.select).toHaveBeenCalledWith("*");
  });

  it("normalizes sparse report payloads and skips FX sync when monthStart is invalid", async () => {
    const invoke = vi.fn(async () => ({
      data: { ok: true },
      error: null,
    }));
    const rpc = vi.fn(async () => ({
      data: {
        currency: null,
        actual_income: "oops",
        actual_expenses: -12,
        actual_net: -12,
        target_income: null,
        target_expense: -20,
        target_net: -20,
        variance_net: 8,
        category_rows: [
          null,
          {
            id: "root",
            parent_id: null,
            canonical_category_id: "root",
            depth: 1,
            name_en: "Root",
            name_ru: "Root RU",
            system_key: "uncategorized",
            actual_income: 0,
            actual_expenses: -12,
            actual_net: -12,
            direct_target_amount: 0,
            target_amount: -20,
            variance_amount: 8,
          },
        ],
        trend_points: [{ actual_income: 5, actual_expense: -2, actual_net: 3 }],
        fx_status: {
          status: "error",
          approximated_dates: ["2026-11-02"],
          missing_pairs: [
            { source_currency: "USD", conversion_date: "2026-11-03" },
            "EUR:2026-11-04",
          ],
        },
      },
      error: null,
    }));
    createClientMock.mockReturnValue({
      functions: { invoke },
      rpc,
    });

    const { useMoneyBudgetReport } = await import("./use-money-reports");
    const { result } = renderHookWithQueryClient(() =>
      useMoneyBudgetReport("person-1", "bad-month", "USD"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invoke).not.toHaveBeenCalled();
    expect(result.current.data).toMatchObject({
      month_start: "",
      currency: "RUB",
      summary: {
        actual_income: 0,
        actual_expenses: -12,
        actual_net: -12,
        target_income: 0,
        target_expenses: -20,
        target_net: -20,
        variance_net: 8,
      },
      categories: [
        {
          id: "root",
          is_uncategorized: true,
          target: null,
        },
      ],
      trend: [{ date: "", income: 5, expenses: -2, net: 3 }],
      fx_status: {
        mode: "missing",
        approximated_dates: ["2026-11-02"],
        missing_pairs: ["USD:2026-11-03", "EUR:2026-11-04"],
        is_blocking: true,
      },
    });
  });

  it("surfaces fx sync and rpc errors when loading budget reports", async () => {
    const syncInvoke = vi.fn(async () => ({
      data: null,
      error: { message: "fx sync failed" },
    }));
    const syncRpc = vi.fn(async () => ({
      data: null,
      error: null,
    }));
    createClientMock.mockReturnValueOnce({
      functions: { invoke: syncInvoke },
      rpc: syncRpc,
    });

    const { useMoneyBudgetReport } = await import("./use-money-reports");
    const fxFailure = renderHookWithQueryClient(() =>
      useMoneyBudgetReport("person-1", "2026-02-01", "RUB"),
    );

    await waitFor(() => expect(fxFailure.result.current.isError).toBe(true));
    expect(fxFailure.result.current.error?.message).toBe("fx sync failed");

    const rpcInvoke = vi.fn(async () => ({
      data: { ok: true },
      error: null,
    }));
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "report rpc failed" },
    }));
    createClientMock.mockReturnValueOnce({
      functions: { invoke: rpcInvoke },
      rpc,
    });

    const rpcFailure = renderHookWithQueryClient(() =>
      useMoneyBudgetReport("person-1", "2026-02-01", "RUB"),
    );

    await waitFor(() => expect(rpcFailure.result.current.isError).toBe(true));
    expect(rpcFailure.result.current.error?.message).toBe("report rpc failed");
  });

  it("deletes budget targets and invalidates scoped report queries", async () => {
    const builder = createTableBuilder({
      data: null,
      error: null,
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteMoneyBudgetTarget } = await import("./use-money-reports");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteMoneyBudgetTarget());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        personId: "person-1",
        categoryId: "food",
        monthStart: "2026-03-01",
      });
    });

    expect(builder.match).toHaveBeenCalledWith({
      person_id: "person-1",
      category_id: "food",
      month_start: "2026-03-01",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-budget-report", "person-1", "2026-03-01"],
    });
  });

  it("filters malformed aliases and deletes aliases while invalidating report queries", async () => {
    const aliasBuilder = createTableBuilder({
      data: [
        {
          id: "alias-1",
          person_id: "person-1",
          alias: "Own transfer",
          normalized_alias: "owntransfer",
          created_at: "2026-03-01T00:00:00.000Z",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
        {
          id: "alias-2",
          person_id: null,
          alias: "Broken",
          normalized_alias: "broken",
        },
      ],
      error: null,
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => aliasBuilder) });

    const { useMoneyTransferSelfAliases, useDeleteMoneyTransferSelfAlias } =
      await import("./use-money-reports");

    const aliases = renderHookWithQueryClient(() => useMoneyTransferSelfAliases("person-1"));
    await waitFor(() => expect(aliases.result.current.isSuccess).toBe(true));
    expect(aliases.result.current.data).toEqual([
      expect.objectContaining({
        id: "alias-1",
        normalized_alias: "owntransfer",
      }),
    ]);

    const deletion = renderHookWithQueryClient(() => useDeleteMoneyTransferSelfAlias());
    const invalidateSpy = vi.spyOn(deletion.queryClient, "invalidateQueries");
    await act(async () => {
      await deletion.result.current.mutateAsync("alias-1");
    });

    expect(aliasBuilder.eq).toHaveBeenCalledWith("id", "alias-1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-transfer-self-aliases"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-budget-report"] });
  });

  it("supports array alias responses and throws on invalid alias payloads", async () => {
    const arrayInsertBuilder = createTableBuilder({
      data: [
        {
          id: "alias-2",
          person_id: "person-1",
          alias: "Max Pod",
          normalized_alias: "maxpod",
          created_at: "2026-03-02T00:00:00.000Z",
          updated_at: "2026-03-02T00:00:00.000Z",
        },
      ],
      error: null,
    });
    createClientMock.mockReturnValueOnce({
      from: vi.fn(() => ({
        ...arrayInsertBuilder,
        insert: vi.fn(() => arrayInsertBuilder),
      })),
    });

    const { useCreateMoneyTransferSelfAlias } = await import("./use-money-reports");
    const arrayResult = renderHookWithQueryClient(() => useCreateMoneyTransferSelfAlias());
    await act(async () => {
      const created = await arrayResult.result.current.mutateAsync({
        personId: "person-1",
        alias: "Max Pod",
      });
      expect(created.normalized_alias).toBe("maxpod");
    });

    const invalidInsertBuilder = createTableBuilder({
      data: { id: "broken" },
      error: null,
    });
    createClientMock.mockReturnValueOnce({
      from: vi.fn(() => ({
        ...invalidInsertBuilder,
        insert: vi.fn(() => invalidInsertBuilder),
      })),
    });

    const invalidResult = renderHookWithQueryClient(() => useCreateMoneyTransferSelfAlias());
    await expect(
      invalidResult.result.current.mutateAsync({
        personId: "person-1",
        alias: "Broken",
      }),
    ).rejects.toThrow("Self-transfer alias response is invalid");
  });
});
