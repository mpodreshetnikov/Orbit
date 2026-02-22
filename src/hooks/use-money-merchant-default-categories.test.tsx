import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
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

describe("use-money-merchant-default-categories", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("returns merchant-category mapping", async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: [
        { merchant_name: "Coffee Shop", category_id: "cat-1" },
        { merchant_name: "Pharmacy", category_id: "cat-2" },
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      rpc: rpcMock,
    });

    const { useMoneyMerchantDefaultCategories } =
      await import("./use-money-merchant-default-categories");
    const { result } = renderHookWithQueryClient(() =>
      useMoneyMerchantDefaultCategories("person-1"),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      "Coffee Shop": "cat-1",
      Pharmacy: "cat-2",
    });
    expect(rpcMock).toHaveBeenCalledWith("get_money_merchant_default_categories", {
      p_payer_person_id: "person-1",
    });
  });

  it("is disabled without payer person id", async () => {
    const { useMoneyMerchantDefaultCategories } =
      await import("./use-money-merchant-default-categories");
    const { result } = renderHookWithQueryClient(() => useMoneyMerchantDefaultCategories(null));

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns query error", async () => {
    createClientMock.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "rpc failed" },
      }),
    });

    const { useMoneyMerchantDefaultCategories } =
      await import("./use-money-merchant-default-categories");
    const { result } = renderHookWithQueryClient(() =>
      useMoneyMerchantDefaultCategories("person-1"),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("rpc failed");
  });
});
