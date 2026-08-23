import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateMoneyTransactionInput, UpdateMoneyTransactionInput } from "@/types";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";
import { createQueryBuilder } from "../../test/utils/web/supabase-query";

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

describe("use-money-transactions", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("loads transactions with account filter", async () => {
    const data = [{ id: "tx-1", payer_person_id: "p1", account_id: "acc-1" }];
    const builder = createQueryBuilder({ data, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyTransactions } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() =>
      useMoneyTransactions("p1", { accountId: "acc-1" }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(builder.select).toHaveBeenCalledWith(
      "*, money_cards(id, last4, card_label), money_transaction_brands(*)",
    );
    expect(builder.eq).toHaveBeenCalledWith("payer_person_id", "p1");
    expect(builder.eq).toHaveBeenCalledWith("account_id", "acc-1");
  });

  it("loads transactions without account filter and handles empty data", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyTransactions } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useMoneyTransactions("p1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(builder.eq).toHaveBeenCalledWith("payer_person_id", "p1");
    expect(builder.eq).not.toHaveBeenCalledWith("account_id", expect.anything());
  });

  it("returns transaction list query errors", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "list failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyTransactions } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useMoneyTransactions("p1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("list failed");
  });

  it("disables list query without payer id", async () => {
    const { useMoneyTransactions } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useMoneyTransactions(null));

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns null for missing transaction detail", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyTransaction } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useMoneyTransaction("tx-missing"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("maps detail rows and supports disabled detail query", async () => {
    const detail = {
      id: "tx-1",
      payer_person_id: "p1",
      money_cards: null,
      money_line_items: null,
    };
    const builder = createQueryBuilder({
      data: detail,
      error: null,
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyTransaction } = await import("./use-money-transactions");
    const loaded = renderHookWithQueryClient(() => useMoneyTransaction("tx-1"));
    await waitFor(() => expect(loaded.result.current.isSuccess).toBe(true));
    expect(loaded.result.current.data).toEqual(
      expect.objectContaining({
        id: "tx-1",
        line_items: [],
      }),
    );
    expect(builder.select).toHaveBeenCalledWith(
      "*, money_cards(id, last4, card_label), money_transaction_brands(*), money_line_items(*)",
    );

    const disabled = renderHookWithQueryClient(() => useMoneyTransaction(null));
    await waitFor(() => expect(disabled.result.current.fetchStatus).toBe("idle"));
  });

  it("returns detail query error", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "detail failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyTransaction } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useMoneyTransaction("tx-1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("detail failed");
  });

  it("loads paged transaction feed through rpc with server-side filters", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: "tx-1", line_item_titles: ["Milk"], category_ids: ["cat-food"] }],
      error: null,
    });
    createClientMock.mockReturnValue({ rpc });

    const { useInfiniteMoneyTransactionFeed } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() =>
      useInfiniteMoneyTransactionFeed("p1", {
        query: "milk",
        accountIds: ["acc-1"],
        transactionTypes: ["expense"],
        statuses: ["posted"],
        categoryIds: ["cat-food"],
        transferFilter: "exclude",
        amountSign: "expense",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-31T23:59:59.000Z",
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith("money_list_transactions_feed", {
      p_payer_person_id: "p1",
      p_search: "milk",
      p_account_ids: ["acc-1"],
      p_transaction_types: ["expense"],
      p_statuses: ["posted"],
      p_category_ids: ["cat-food"],
      p_transfer_filter: "exclude",
      p_amount_sign: "expense",
      p_from: "2026-01-01T00:00:00.000Z",
      p_to: "2026-01-31T23:59:59.000Z",
      p_offset: 0,
      p_limit: 50,
    });
    expect(result.current.data?.pages[0]).toEqual(
      expect.objectContaining({
        items: [{ id: "tx-1", line_item_titles: ["Milk"], category_ids: ["cat-food"] }],
      }),
    );
  });

  it("normalizes feed items with fallback card metadata and next-page offsets", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: Array.from({ length: 50 }, (_, index) => ({
        id: `tx-${index + 1}`,
        line_items:
          index === 0
            ? [{ title: "Derived title" }, { title: 42 }, {}]
            : [{ title: `Item ${index + 1}` }],
        line_item_titles: index === 0 ? null : [`Explicit ${index + 1}`],
        category_ids: index === 0 ? null : [`cat-${index + 1}`],
        card_id: index === 0 ? "card-1" : null,
        card_last4: index === 0 ? "1234" : null,
        card_label: index === 0 ? "Backup" : null,
      })),
      error: null,
    });
    createClientMock.mockReturnValue({ rpc });

    const { useInfiniteMoneyTransactionFeed } = await import("./use-money-transactions");
    const loaded = renderHookWithQueryClient(() => useInfiniteMoneyTransactionFeed("p1"));

    await waitFor(() => expect(loaded.result.current.isSuccess).toBe(true));
    expect(loaded.result.current.data?.pages[0]).toEqual(
      expect.objectContaining({
        nextOffset: 50,
        items: expect.arrayContaining([
          expect.objectContaining({
            id: "tx-1",
            line_item_titles: ["Derived title"],
            category_ids: [],
            money_cards: {
              id: "card-1",
              last4: "1234",
              card_label: "Backup",
            },
          }),
        ]),
      }),
    );

    const disabled = renderHookWithQueryClient(() => useInfiniteMoneyTransactionFeed(null));
    await waitFor(() => expect(disabled.result.current.fetchStatus).toBe("idle"));
  });

  it("keeps explicit card payloads and normalizes incomplete fallback card metadata", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: "tx-1",
          line_item_titles: [],
          category_ids: [],
          money_cards: null,
        },
        {
          id: "tx-2",
          line_item_titles: [],
          category_ids: [],
          card_id: null,
          card_last4: 1234,
          card_label: 987,
        },
      ],
      error: null,
    });
    createClientMock.mockReturnValue({ rpc });

    const { useInfiniteMoneyTransactionFeed } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useInfiniteMoneyTransactionFeed("p1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0]?.items).toEqual([
      expect.objectContaining({
        id: "tx-1",
        money_cards: null,
      }),
      expect.objectContaining({
        id: "tx-2",
        money_cards: {
          id: "",
          last4: "",
          card_label: null,
        },
      }),
    ]);
  });

  it("returns feed rpc errors", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "feed failed" },
    });
    createClientMock.mockReturnValue({ rpc });

    const { useInfiniteMoneyTransactionFeed } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useInfiniteMoneyTransactionFeed("p1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("feed failed");
  });

  it("loads transaction feed summary through rpc with server-side filters", async () => {
    const rpc = vi.fn((fn: string) => {
      if (fn === "money_transaction_feed_summary") {
        return Promise.resolve({
          data: [
            {
              total_count: 2,
              total_positive_amount: 800,
              total_negative_amount: -1200,
            },
          ],
          error: null,
        });
      }

      return Promise.resolve({ data: null, error: null });
    });
    createClientMock.mockReturnValue({ rpc });

    const { useMoneyTransactionFeedSummary } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() =>
      useMoneyTransactionFeedSummary("p1", {
        query: "milk",
        accountIds: ["acc-1"],
        transactionTypes: ["expense"],
        statuses: ["posted"],
        categoryIds: ["cat-food"],
        transferFilter: "exclude",
        amountSign: "expense",
        from: "2026-01-01T00:00:00.000Z",
        to: "2026-01-31T23:59:59.000Z",
      }),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith("money_transaction_feed_summary", {
      p_payer_person_id: "p1",
      p_search: "milk",
      p_account_ids: ["acc-1"],
      p_transaction_types: ["expense"],
      p_statuses: ["posted"],
      p_category_ids: ["cat-food"],
      p_transfer_filter: "exclude",
      p_amount_sign: "expense",
      p_from: "2026-01-01T00:00:00.000Z",
      p_to: "2026-01-31T23:59:59.000Z",
    });
    expect(result.current.data).toEqual({
      totalCount: 2,
      totalPositiveAmount: 800,
      totalNegativeAmount: -1200,
    });
  });

  it("loads summary defaults, trims empty filters, and supports disabled summary queries", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    });
    createClientMock.mockReturnValue({ rpc });

    const { useMoneyTransactionFeedSummary } = await import("./use-money-transactions");
    const loaded = renderHookWithQueryClient(() =>
      useMoneyTransactionFeedSummary("p1", {
        query: "   ",
        accountIds: [],
        transactionTypes: [],
        statuses: [],
        categoryIds: [],
      }),
    );

    await waitFor(() => expect(loaded.result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith("money_transaction_feed_summary", {
      p_payer_person_id: "p1",
      p_search: null,
      p_account_ids: null,
      p_transaction_types: null,
      p_statuses: null,
      p_category_ids: null,
      p_transfer_filter: "all",
      p_amount_sign: "all",
      p_from: null,
      p_to: null,
    });
    expect(loaded.result.current.data).toEqual({
      totalCount: 0,
      totalPositiveAmount: 0,
      totalNegativeAmount: 0,
    });

    const disabled = renderHookWithQueryClient(() => useMoneyTransactionFeedSummary(null));
    await waitFor(() => expect(disabled.result.current.fetchStatus).toBe("idle"));
  });

  it("returns summary rpc errors", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "summary failed" },
    });
    createClientMock.mockReturnValue({ rpc });

    const { useMoneyTransactionFeedSummary } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useMoneyTransactionFeedSummary("p1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("summary failed");
  });

  it("loads transaction edit audit entries", async () => {
    const builder = createQueryBuilder({
      data: [
        {
          id: "audit-1",
          transaction_id: "tx-1",
          entity_kind: "transaction",
          entity_id: "tx-1",
          edited_by_auth_user_id: "user-1",
          before_snapshot: { merchant_name: "Old Store" },
          after_snapshot: { merchant_name: "New Store" },
        },
      ],
      error: null,
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyTransactionEditAudits } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useMoneyTransactionEditAudits("tx-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(builder.eq).toHaveBeenCalledWith("transaction_id", "tx-1");
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(result.current.data).toHaveLength(1);
  });

  it("returns edit audit query errors and supports disabled audit queries", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "audit failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyTransactionEditAudits } = await import("./use-money-transactions");
    const loaded = renderHookWithQueryClient(() => useMoneyTransactionEditAudits("tx-1"));

    await waitFor(() => expect(loaded.result.current.isError).toBe(true));
    expect((loaded.result.current.error as Error).message).toContain("audit failed");

    const disabled = renderHookWithQueryClient(() => useMoneyTransactionEditAudits(null));
    await waitFor(() => expect(disabled.result.current.fetchStatus).toBe("idle"));
  });

  it("returns empty edit audit arrays when no audit rows exist", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: null,
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyTransactionEditAudits } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useMoneyTransactionEditAudits("tx-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("creates a transaction and its whole composition in one call", async () => {
    // Saving used to be three to five separate statements with no transaction around them,
    // so a dropped connection left the registry half-changed. It is now one RPC.
    const saved = {
      id: "tx-1",
      payer_person_id: "p1",
      amount: 123,
      merchant_name: "Store",
      line_items: [{ id: "line-1", transaction_id: "tx-1", title: "Store", amount: 123 }],
    };
    const rpc = vi.fn().mockResolvedValue({ data: saved, error: null });
    createClientMock.mockReturnValue({ rpc, from: vi.fn() });

    const { useCreateMoneyTransaction } = await import("./use-money-transactions");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateMoneyTransaction());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        transaction: {
          payer_person_id: "p1",
          account_id: "acc-1",
          posted_at: "2026-01-01T00:00:00.000Z",
          amount: 123,
          currency: "USD",
          transaction_type: "expense",
          merchant_name: "Store",
        } as CreateMoneyTransactionInput,
        lineItems: [],
      });
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [functionName, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(functionName).toBe("money_save_transaction_with_line_items");
    expect(args.p_transaction_id).toBeNull();
    // An empty composition still gets one line item covering the whole operation.
    expect(args.p_line_items).toEqual([
      expect.objectContaining({ id: null, title: "Store", amount: 123, line_status: "final" }),
    ]);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-transactions", "p1"],
    });
  });

  it("sends line item defaults through to the save call", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id: "tx-2", payer_person_id: "p1", amount: 10, line_items: [] },
      error: null,
    });
    createClientMock.mockReturnValue({ rpc, from: vi.fn() });

    const { useCreateMoneyTransaction } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useCreateMoneyTransaction());

    await act(async () => {
      await result.current.mutateAsync({
        transaction: {
          payer_person_id: "p1",
          account_id: "acc-1",
          posted_at: "2026-01-01T00:00:00.000Z",
          amount: 10,
          currency: "USD",
          transaction_type: "expense",
        } as CreateMoneyTransactionInput,
        lineItems: [{ title: "Item 1", amount: 10 }],
      });
    });

    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_line_items).toEqual([
      expect.objectContaining({
        title: "Item 1",
        amount: 10,
        line_status: "final",
        assignment_method: "manual",
        category_locked_by_user: false,
      }),
    ]);
  });

  it("surfaces a save failure instead of leaving a half-written transaction", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "Line items sum (-100.00) does not match the transaction amount" },
    });
    createClientMock.mockReturnValue({ rpc, from: vi.fn() });

    const { useCreateMoneyTransaction } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useCreateMoneyTransaction());

    await expect(
      result.current.mutateAsync({
        transaction: {
          payer_person_id: "p1",
          account_id: "acc-1",
          posted_at: "2026-01-01T00:00:00.000Z",
          amount: -1000,
          currency: "RUB",
          transaction_type: "expense",
        } as CreateMoneyTransactionInput,
        lineItems: [{ title: "Кофе", amount: -100 }],
      }),
    ).rejects.toThrow("does not match the transaction amount");
  });

  it("updates a transaction and its composition in one call", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: "tx-9",
        payer_person_id: "p1",
        amount: 30,
        line_items: [
          { id: "line-keep", title: "Kept", amount: 10 },
          { id: "line-new", title: "Added", amount: 20 },
        ],
      },
      error: null,
    });
    createClientMock.mockReturnValue({ rpc, from: vi.fn() });

    const { useUpdateMoneyTransaction } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useUpdateMoneyTransaction());

    await act(async () => {
      await result.current.mutateAsync({
        id: "tx-9",
        updates: { amount: 30, merchant_name: "Store" },
        lineItems: [
          { id: "line-keep", title: "Kept", amount: 10 },
          { title: "Added", amount: 20 },
        ],
      });
    });

    const [functionName, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(functionName).toBe("money_save_transaction_with_line_items");
    expect(args.p_transaction_id).toBe("tx-9");
    // A line item left out of the payload is removed by the function, not by the caller.
    expect(args.p_line_items).toEqual([
      expect.objectContaining({ id: "line-keep", title: "Kept" }),
      expect.objectContaining({ id: null, title: "Added" }),
    ]);
  });

  it("returns update errors from the save call", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "update failed" },
    });
    createClientMock.mockReturnValue({ rpc, from: vi.fn() });

    const { useUpdateMoneyTransaction } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useUpdateMoneyTransaction());

    await expect(
      result.current.mutateAsync({
        id: "tx-9",
        updates: { amount: 30 },
        lineItems: [{ title: "Kept", amount: 30 }],
      }),
    ).rejects.toThrow("update failed");
  });

  it("deletes transaction and invalidates list", async () => {
    const txBuilder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => txBuilder),
    });

    const { useDeleteMoneyTransaction } = await import("./use-money-transactions");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteMoneyTransaction());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "tx-1",
        payerPersonId: "p1",
      });
    });

    expect(txBuilder.delete).toHaveBeenCalled();
    expect(txBuilder.eq).toHaveBeenCalledWith("id", "tx-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-transactions", "p1"],
    });
  });

  it("returns delete transaction errors", async () => {
    const txBuilder = createQueryBuilder({
      data: null,
      error: { message: "delete tx failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => txBuilder),
    });

    const { useDeleteMoneyTransaction } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useDeleteMoneyTransaction());

    await expect(
      result.current.mutateAsync({
        id: "tx-1",
        payerPersonId: "p1",
      }),
    ).rejects.toThrow("delete tx failed");
  });
});
