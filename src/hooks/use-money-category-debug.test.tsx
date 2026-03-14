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

describe("use-money-category-debug", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("loads debug runs from the rpc", async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: "run-1",
          person_id: "person-1",
          trigger_source: "manual_replay",
          line_item_id: "line-1",
          transaction_id: "tx-1",
          steps: [
            {
              rule_id: "rule-1",
              rule_kind: "direct",
              matched: true,
              changed_category: true,
              decision_reason: "matched",
            },
          ],
        },
      ],
      error: null,
    });
    createClientMock.mockReturnValue({ rpc: rpcMock });

    const { useMoneyCategoryDebug } = await import("./use-money-category-debug");
    const { result } = renderHookWithQueryClient(() => useMoneyCategoryDebug("line-1", 5));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      expect.objectContaining({
        id: "run-1",
        line_item_id: "line-1",
        steps: [
          expect.objectContaining({
            rule_id: "rule-1",
            changed_category: true,
          }),
        ],
      }),
    ]);
    expect(rpcMock).toHaveBeenCalledWith("money_get_category_rule_debug", {
      p_line_item_id: "line-1",
      p_limit: 5,
    });
  });

  it("does not run without a line item id", async () => {
    const { useMoneyCategoryDebug } = await import("./use-money-category-debug");
    const { result } = renderHookWithQueryClient(() => useMoneyCategoryDebug(null));

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(result.current.data).toBeUndefined();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns rpc errors", async () => {
    createClientMock.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: "debug failed" },
      }),
    });

    const { useMoneyCategoryDebug } = await import("./use-money-category-debug");
    const { result } = renderHookWithQueryClient(() => useMoneyCategoryDebug("line-1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("debug failed");
  });
});
