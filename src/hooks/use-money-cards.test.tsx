import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("use-money-cards", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("loads cards by account id", async () => {
    const data = [
      {
        id: "card-1",
        account_id: "acc-1",
        last4: "1234",
        card_label: "Personal",
      },
    ];
    const builder = createQueryBuilder({ data, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyCardsByAccountId } = await import("./use-money-cards");
    const { result } = renderHookWithQueryClient(() => useMoneyCardsByAccountId("acc-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(builder.eq).toHaveBeenCalledWith("account_id", "acc-1");
  });

  it("returns [] when account cards response is empty", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyCardsByAccountId } = await import("./use-money-cards");
    const { result } = renderHookWithQueryClient(() => useMoneyCardsByAccountId("acc-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it("disables query when account id is null", async () => {
    const { useMoneyCardsByAccountId } = await import("./use-money-cards");
    const { result } = renderHookWithQueryClient(() => useMoneyCardsByAccountId(null));

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("loads cards by sorted account ids", async () => {
    const builder = createQueryBuilder({ data: [], error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyCardsByAccountIds } = await import("./use-money-cards");
    const { result } = renderHookWithQueryClient(() =>
      useMoneyCardsByAccountIds(["acc-b", "acc-a"]),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(builder.in).toHaveBeenCalledWith("account_id", ["acc-a", "acc-b"]);
  });

  it("disables by-account-ids query when ids list is empty", async () => {
    const { useMoneyCardsByAccountIds } = await import("./use-money-cards");
    const { result } = renderHookWithQueryClient(() => useMoneyCardsByAccountIds([]));

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns by-account-ids query errors", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "cards by ids failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyCardsByAccountIds } = await import("./use-money-cards");
    const { result } = renderHookWithQueryClient(() => useMoneyCardsByAccountIds(["acc-1"]));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("cards by ids failed");
  });

  it("returns query errors", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "cards failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMoneyCardsByAccountId } = await import("./use-money-cards");
    const { result } = renderHookWithQueryClient(() => useMoneyCardsByAccountId("acc-1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("cards failed");
  });

  it("creates card with normalized last4", async () => {
    const created = {
      id: "card-1",
      account_id: "acc-1",
      last4: "1234",
      card_label: "Travel",
    };
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useCreateMoneyCard } = await import("./use-money-cards");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateMoneyCard());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        account_id: "acc-1",
        last4: "12-34 99",
        card_label: "Travel",
      });
    });

    expect(builder.insert).toHaveBeenCalledWith({
      account_id: "acc-1",
      last4: "3499",
      card_label: "Travel",
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-cards", "acc-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-cards-by-accounts"],
    });
  });

  it("creates card with fallback values and propagates create errors", async () => {
    const createErrorBuilder = createQueryBuilder({
      data: null,
      error: { message: "create card failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => createErrorBuilder) });

    const { useCreateMoneyCard } = await import("./use-money-cards");
    const { result } = renderHookWithQueryClient(() => useCreateMoneyCard());

    await expect(
      result.current.mutateAsync({
        account_id: "acc-1",
        last4: "----",
        card_label: "   ",
      }),
    ).rejects.toThrow("create card failed");
    expect(createErrorBuilder.insert).toHaveBeenCalledWith({
      account_id: "acc-1",
      last4: "----",
      card_label: null,
    });
  });

  it("updates card with normalized last4", async () => {
    const updated = {
      id: "card-1",
      account_id: "acc-1",
      last4: "9876",
      card_label: "Main",
    };
    const builder = createQueryBuilder({ data: updated, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useUpdateMoneyCard } = await import("./use-money-cards");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateMoneyCard());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "card-1",
        accountId: "acc-1",
        updates: { last4: "AB98-76", card_label: "Main" },
      });
    });

    expect(builder.update).toHaveBeenCalledWith({ last4: "9876", card_label: "Main" });
    expect(builder.eq).toHaveBeenCalledWith("id", "card-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-cards", "acc-1"],
    });
  });

  it("updates without last4 and propagates update errors", async () => {
    const updateErrorBuilder = createQueryBuilder({
      data: null,
      error: { message: "update card failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => updateErrorBuilder) });

    const { useUpdateMoneyCard } = await import("./use-money-cards");
    const { result } = renderHookWithQueryClient(() => useUpdateMoneyCard());

    await expect(
      result.current.mutateAsync({
        id: "card-1",
        accountId: "acc-1",
        updates: { card_label: "Renamed" },
      }),
    ).rejects.toThrow("update card failed");
    expect(updateErrorBuilder.update).toHaveBeenCalledWith({ card_label: "Renamed" });
  });

  it("falls back to raw last4 when normalization strips all characters", async () => {
    const updated = {
      id: "card-1",
      account_id: "acc-1",
      last4: "ABCD",
      card_label: "Main",
    };
    const builder = createQueryBuilder({ data: updated, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useUpdateMoneyCard } = await import("./use-money-cards");
    const { result } = renderHookWithQueryClient(() => useUpdateMoneyCard());

    await act(async () => {
      await result.current.mutateAsync({
        id: "card-1",
        accountId: "acc-1",
        updates: { last4: "ABCD" },
      });
    });

    expect(builder.update).toHaveBeenCalledWith({ last4: "ABCD" });
  });

  it("deletes card and invalidates queries", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteMoneyCard } = await import("./use-money-cards");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteMoneyCard());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "card-1",
        accountId: "acc-1",
      });
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "card-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-cards", "acc-1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-cards-by-accounts"],
    });
  });

  it("propagates delete errors", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "delete card failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useDeleteMoneyCard } = await import("./use-money-cards");
    const { result } = renderHookWithQueryClient(() => useDeleteMoneyCard());

    await expect(
      result.current.mutateAsync({
        id: "card-1",
        accountId: "acc-1",
      }),
    ).rejects.toThrow("delete card failed");
  });
});
