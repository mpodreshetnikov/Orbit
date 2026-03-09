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

  it("creates transaction with fallback line item when empty", async () => {
    const tx = {
      id: "tx-1",
      payer_person_id: "p1",
      amount: 123,
      merchant_name: "Store",
    };
    const txBuilder = createQueryBuilder({ data: tx, error: null });
    const lineBuilder = createQueryBuilder({
      data: [{ id: "line-1", transaction_id: "tx-1", title: "Store", amount: 123 }],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "money_transactions") return txBuilder;
      if (table === "money_line_items") return lineBuilder;
      return createQueryBuilder({ data: null, error: null });
    });
    createClientMock.mockReturnValue({ from });

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

    expect(lineBuilder.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          transaction_id: "tx-1",
          title: "Store",
          amount: 123,
        }),
      ]),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-transactions", "p1"],
    });
  });

  it("creates transaction with default item values and returns line insert errors", async () => {
    const txBuilder = createQueryBuilder({
      data: {
        id: "tx-2",
        payer_person_id: "p1",
        amount: 10,
        merchant_name: null,
      },
      error: null,
    });
    const lineBuilder = createQueryBuilder({
      data: null,
      error: { message: "line insert failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "money_transactions") return txBuilder;
        if (table === "money_line_items") return lineBuilder;
        return createQueryBuilder({ data: null, error: null });
      }),
    });

    const { useCreateMoneyTransaction } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useCreateMoneyTransaction());

    await expect(
      result.current.mutateAsync({
        transaction: {
          payer_person_id: "p1",
          account_id: "acc-1",
          posted_at: "2026-01-01T00:00:00.000Z",
          amount: 10,
          currency: "USD",
          transaction_type: "expense",
        } as CreateMoneyTransactionInput,
        lineItems: [
          {
            title: "Item 1",
            amount: 10,
          },
        ],
      }),
    ).rejects.toThrow("line insert failed");
    expect(lineBuilder.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          line_status: "final",
          assignment_method: "manual",
        }),
      ]),
    );
  });

  it("returns create transaction insert errors", async () => {
    const txBuilder = createQueryBuilder({
      data: null,
      error: { message: "tx insert failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => txBuilder),
    });

    const { useCreateMoneyTransaction } = await import("./use-money-transactions");
    const { result } = renderHookWithQueryClient(() => useCreateMoneyTransaction());

    await expect(
      result.current.mutateAsync({
        transaction: {
          payer_person_id: "p1",
          account_id: "acc-1",
          posted_at: "2026-01-01T00:00:00.000Z",
          amount: 10,
          currency: "USD",
          transaction_type: "expense",
        } as CreateMoneyTransactionInput,
        lineItems: [],
      }),
    ).rejects.toThrow("tx insert failed");
  });

  it("updates transaction and replaces line items", async () => {
    const tx = {
      id: "tx-1",
      payer_person_id: "p1",
    };
    const txBuilder = createQueryBuilder({ data: tx, error: null });
    const lineBuilder = createQueryBuilder({
      data: [{ id: "line-2", transaction_id: "tx-1", title: "Manual item", amount: 10 }],
      error: null,
    });
    const from = vi.fn((table: string) => {
      if (table === "money_transactions") return txBuilder;
      if (table === "money_line_items") return lineBuilder;
      return createQueryBuilder({ data: null, error: null });
    });
    createClientMock.mockReturnValue({ from });

    const { useUpdateMoneyTransaction } = await import("./use-money-transactions");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateMoneyTransaction());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "tx-1",
        updates: { amount: 10, merchant_name: "" } as UpdateMoneyTransactionInput,
        lineItems: [],
      });
    });

    expect(lineBuilder.delete).toHaveBeenCalled();
    expect(lineBuilder.insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          transaction_id: "tx-1",
          title: "Manual item",
          amount: 10,
        }),
      ]),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-transaction", "tx-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-transactions", "p1"],
    });
  });

  it("returns update errors for update/delete/line insert stages", async () => {
    const updateErrorBuilder = createQueryBuilder({
      data: null,
      error: { message: "update failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => updateErrorBuilder),
    });
    const { useUpdateMoneyTransaction } = await import("./use-money-transactions");
    let hook = renderHookWithQueryClient(() => useUpdateMoneyTransaction());
    await expect(
      hook.result.current.mutateAsync({
        id: "tx-1",
        updates: { amount: 5 } as UpdateMoneyTransactionInput,
        lineItems: [],
      }),
    ).rejects.toThrow("update failed");

    const updatedTx = createQueryBuilder({
      data: { id: "tx-1", payer_person_id: "p1" },
      error: null,
    });
    const deleteErrorBuilder = createQueryBuilder({
      data: null,
      error: { message: "delete lines failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "money_transactions") return updatedTx;
        if (table === "money_line_items") return deleteErrorBuilder;
        return createQueryBuilder({ data: null, error: null });
      }),
    });
    hook = renderHookWithQueryClient(() => useUpdateMoneyTransaction());
    await expect(
      hook.result.current.mutateAsync({
        id: "tx-1",
        updates: { amount: 5 } as UpdateMoneyTransactionInput,
        lineItems: [],
      }),
    ).rejects.toThrow("delete lines failed");

    const lineInsertErrorBuilder = createQueryBuilder({
      data: null,
      error: { message: "insert lines failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "money_transactions") return updatedTx;
        if (table === "money_line_items") return lineInsertErrorBuilder;
        return createQueryBuilder({ data: null, error: null });
      }),
    });
    hook = renderHookWithQueryClient(() => useUpdateMoneyTransaction());
    await expect(
      hook.result.current.mutateAsync({
        id: "tx-1",
        updates: { merchant_name: " ", amount: 0 } as UpdateMoneyTransactionInput,
        lineItems: [
          {
            title: "A",
            amount: 1,
          },
        ],
      }),
    ).rejects.toThrow("insert lines failed");
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
