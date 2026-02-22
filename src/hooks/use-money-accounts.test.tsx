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

describe("use-money-accounts", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("returns accounts for owner", async () => {
    const data = [
      {
        id: "acc-1",
        owner_person_id: "person-1",
        source: "manual",
        account_kind: "cash",
        account_label: "Cash",
        currency: "USD",
        external_account_id: null,
        is_active: true,
      },
    ];
    const builder = createQueryBuilder({ data, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useMoneyAccounts } = await import("./use-money-accounts");
    const { result } = renderHookWithQueryClient(() => useMoneyAccounts("person-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(builder.eq).toHaveBeenCalledWith("owner_person_id", "person-1");
  });

  it("stays disabled when owner id is missing", async () => {
    const { useMoneyAccounts } = await import("./use-money-accounts");
    const { result } = renderHookWithQueryClient(() => useMoneyAccounts(null));

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns query error", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { message: "accounts failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useMoneyAccounts } = await import("./use-money-accounts");
    const { result } = renderHookWithQueryClient(() => useMoneyAccounts("person-1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("accounts failed");
  });

  it("creates account and invalidates owner list", async () => {
    const created = {
      id: "acc-1",
      owner_person_id: "person-1",
      source: "manual",
      account_kind: "cash",
      account_label: "Cash",
      currency: "USD",
      external_account_id: null,
      is_active: true,
    };
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useCreateMoneyAccount } = await import("./use-money-accounts");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateMoneyAccount());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        owner_person_id: "person-1",
        account_kind: "cash",
        account_label: "Cash",
        currency: "USD",
      });
    });

    expect(builder.insert).toHaveBeenCalledWith({
      owner_person_id: "person-1",
      source: "manual",
      account_kind: "cash",
      account_label: "Cash",
      currency: "USD",
      external_account_id: null,
      is_active: true,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-accounts", "person-1"],
    });
  });

  it("updates account and invalidates owner list", async () => {
    const updated = {
      id: "acc-1",
      owner_person_id: "person-1",
      source: "manual",
      account_kind: "cash",
      account_label: "Wallet",
      currency: "USD",
      external_account_id: null,
      is_active: true,
    };
    const builder = createQueryBuilder({ data: updated, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useUpdateMoneyAccount } = await import("./use-money-accounts");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateMoneyAccount());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "acc-1",
        updates: { account_label: "Wallet" },
      });
    });

    expect(builder.update).toHaveBeenCalledWith({ account_label: "Wallet" });
    expect(builder.eq).toHaveBeenCalledWith("id", "acc-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-accounts", "person-1"],
    });
  });

  it("deletes account and invalidates owner list", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useDeleteMoneyAccount } = await import("./use-money-accounts");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteMoneyAccount());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "acc-1",
        ownerPersonId: "person-1",
      });
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "acc-1");
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-accounts", "person-1"],
    });
  });
});
