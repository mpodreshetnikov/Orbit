import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";
import { createQueryBuilder } from "../../test/utils/web/supabase-query";

const { createClientMock, callMoneyCategorizeActionMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  callMoneyCategorizeActionMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

vi.mock("@/lib/money-categorize-client", () => ({
  callMoneyCategorizeAction: callMoneyCategorizeActionMock,
}));

function renderHookWithQueryClient<T>(hook: () => T) {
  const queryClient = createTestQueryClient();
  const wrapper = createTestQueryWrapper(queryClient);
  return {
    queryClient,
    ...renderHook(hook, { wrapper }),
  };
}

function makeRuleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    person_id: "person-1",
    name: "Groceries",
    description: null,
    enabled: true,
    sort_order: 1,
    rule_kind: "direct",
    target_category_id: "cat-food",
    match_mode: "all",
    scope_filter: "all_line_items",
    filters: [{ field: "merchant_name", operator: "contains", value: "market" }],
    config: {},
    stop_processing: false,
    created_by: null,
    created_at: "2026-03-10T00:00:00.000Z",
    updated_at: "2026-03-10T00:00:00.000Z",
    ...overrides,
  };
}

function makeRuleRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    person_id: "person-1",
    trigger_source: "manual_replay",
    line_item_id: "line-1",
    line_item_title: "Latte",
    transaction_id: "tx-1",
    merchant_name: "Coffee Shop",
    starting_category_id: null,
    final_category_id: "cat-food",
    saved: true,
    llm_tokens_prompt: 10,
    llm_tokens_completion: 5,
    created_at: "2026-03-10T00:00:00.000Z",
    steps: [
      {
        id: "step-1",
        rule_id: "rule-1",
        rule_name: "Groceries",
        rule_kind: "direct",
        sort_order: 1,
        matched: true,
        changed_category: true,
        previous_category_id: null,
        next_category_id: "cat-food",
        decision_reason: "matched",
        debug_payload: {},
        created_at: "2026-03-10T00:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function createSupabaseClient(options: {
  builders?: Record<string, ReturnType<typeof createQueryBuilder>>;
  rpc?: ReturnType<typeof vi.fn>;
}) {
  return {
    from: vi.fn((table: string) => {
      const builder = options.builders?.[table];
      if (!builder) {
        throw new Error(`Unexpected table ${table}`);
      }
      return builder;
    }),
    rpc: options.rpc ?? vi.fn(),
  };
}

describe("use-money-category-rules", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    callMoneyCategorizeActionMock.mockReset();
  });

  it("loads rules, maps defaults, and supports disabled queries", async () => {
    const builder = createQueryBuilder({
      data: [makeRuleRow({ filters: "not-an-array", config: null })],
      error: null,
    });
    createClientMock.mockReturnValue(
      createSupabaseClient({
        builders: {
          money_category_rules: builder,
        },
      }),
    );

    const { useMoneyCategoryRules } = await import("./use-money-category-rules");
    const loaded = renderHookWithQueryClient(() => useMoneyCategoryRules("person-1"));

    await waitFor(() => expect(loaded.result.current.isSuccess).toBe(true));
    expect(loaded.result.current.data).toEqual([
      expect.objectContaining({
        id: "rule-1",
        filters: [],
        config: {},
      }),
    ]);
    expect(builder.order).toHaveBeenCalledWith("sort_order", { ascending: true });
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: true });

    const disabled = renderHookWithQueryClient(() => useMoneyCategoryRules(null));
    await waitFor(() => expect(disabled.result.current.fetchStatus).toBe("idle"));
  });

  it("creates, updates, deletes, and reorders rules", async () => {
    const createBuilder = createQueryBuilder({
      data: makeRuleRow(),
      error: null,
    });
    const updateBuilder = createQueryBuilder({
      data: makeRuleRow({ name: "Updated", filters: [], config: null }),
      error: null,
    });
    const deleteBuilder = createQueryBuilder({
      data: null,
      error: null,
    });
    const reorderBuilder = createQueryBuilder({
      data: null,
      error: null,
    });

    createClientMock
      .mockReturnValueOnce(
        createSupabaseClient({
          builders: {
            money_category_rules: createBuilder,
          },
        }),
      )
      .mockReturnValueOnce(
        createSupabaseClient({
          builders: {
            money_category_rules: updateBuilder,
          },
        }),
      )
      .mockReturnValueOnce(
        createSupabaseClient({
          builders: {
            money_category_rules: deleteBuilder,
          },
        }),
      )
      .mockReturnValueOnce(
        createSupabaseClient({
          builders: {
            money_category_rules: reorderBuilder,
          },
        }),
      );

    const {
      useCreateMoneyCategoryRule,
      useUpdateMoneyCategoryRule,
      useDeleteMoneyCategoryRule,
      useReorderMoneyCategoryRules,
    } = await import("./use-money-category-rules");

    const createHook = renderHookWithQueryClient(() => useCreateMoneyCategoryRule());
    const updateHook = renderHookWithQueryClient(() => useUpdateMoneyCategoryRule());
    const deleteHook = renderHookWithQueryClient(() => useDeleteMoneyCategoryRule());
    const reorderHook = renderHookWithQueryClient(() => useReorderMoneyCategoryRules());

    const createInvalidateSpy = vi.spyOn(createHook.queryClient, "invalidateQueries");
    const updateInvalidateSpy = vi.spyOn(updateHook.queryClient, "invalidateQueries");
    const deleteInvalidateSpy = vi.spyOn(deleteHook.queryClient, "invalidateQueries");
    const reorderInvalidateSpy = vi.spyOn(reorderHook.queryClient, "invalidateQueries");

    await act(async () => {
      await createHook.result.current.mutateAsync({
        person_id: "person-1",
        name: "Groceries",
        sort_order: 2,
        rule_kind: "direct",
        target_category_id: "cat-food",
        filters: [{ field: "merchant_name", operator: "contains", value: "market" }],
        config: { note: "x" },
      });
    });
    expect(createBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        person_id: "person-1",
        enabled: true,
        match_mode: "all",
        scope_filter: "all_line_items",
        stop_processing: false,
      }),
    );
    expect(createInvalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-category-rules", "person-1"],
    });

    await act(async () => {
      await updateHook.result.current.mutateAsync({
        id: "rule-1",
        updates: {
          name: "Updated",
          filters: [{ field: "mcc", operator: "equals", value: "5812" }],
        },
      });
    });
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Updated",
        filters: [{ field: "mcc", operator: "equals", value: "5812" }],
      }),
    );
    expect(updateBuilder.eq).toHaveBeenCalledWith("id", "rule-1");
    expect(updateInvalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-category-rules", "person-1"],
    });

    await act(async () => {
      await deleteHook.result.current.mutateAsync({
        id: "rule-1",
        personId: "person-1",
      });
    });
    expect(deleteBuilder.delete).toHaveBeenCalled();
    expect(deleteBuilder.eq).toHaveBeenCalledWith("id", "rule-1");
    expect(deleteInvalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-category-rules", "person-1"],
    });

    await act(async () => {
      await reorderHook.result.current.mutateAsync({
        personId: "person-1",
        orderedRuleIds: ["rule-2", "rule-1"],
      });
    });
    expect(reorderBuilder.update.mock.calls).toEqual([
      [{ sort_order: -1000 }],
      [{ sort_order: -1001 }],
      [{ sort_order: 1 }],
      [{ sort_order: 2 }],
    ]);
    expect(reorderBuilder.eq.mock.calls).toEqual([
      ["id", "rule-2"],
      ["id", "rule-1"],
      ["id", "rule-2"],
      ["id", "rule-1"],
    ]);
    expect(reorderInvalidateSpy).toHaveBeenCalledWith({
      queryKey: ["money-category-rules", "person-1"],
    });
  });

  it("returns list errors", async () => {
    createClientMock.mockReturnValue(
      createSupabaseClient({
        builders: {
          money_category_rules: createQueryBuilder({
            data: null,
            error: { message: "rules failed" },
          }),
        },
      }),
    );

    const { useMoneyCategoryRules } = await import("./use-money-category-rules");
    const { result } = renderHookWithQueryClient(() => useMoneyCategoryRules("person-1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("rules failed");
  });

  it("maps rule run fallbacks", async () => {
    const { asMoneyCategoryRuleRun } = await import("./use-money-category-rules");

    expect(
      asMoneyCategoryRuleRun({
        run_id: "run-fallback",
        person_id: "person-1",
        trigger_source: "manual_replay",
        line_item_id: "line-1",
        transaction_id: "tx-1",
        steps: [
          { rule_id: "rule-1", rule_kind: "direct", matched: false, changed_category: false },
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        id: "run-fallback",
        line_item_title: null,
        merchant_name: null,
        final_category_id: null,
        llm_tokens_prompt: null,
        steps: [
          expect.objectContaining({
            id: null,
            sort_order: 0,
            decision_reason: "",
          }),
        ],
      }),
    );
  });

  it("preserves line item and merchant metadata in rule runs", async () => {
    const { asMoneyCategoryRuleRun } = await import("./use-money-category-rules");

    expect(
      asMoneyCategoryRuleRun({
        run_id: "run-rich",
        person_id: "person-1",
        trigger_source: "manual_replay",
        line_item_id: "line-1",
        line_item_title: "Flat white",
        transaction_id: "tx-1",
        merchant_name: "Coffee House",
        final_category_id: "cat-food",
        saved: true,
        steps: [],
      }),
    ).toEqual(
      expect.objectContaining({
        id: "run-rich",
        line_item_title: "Flat white",
        merchant_name: "Coffee House",
      }),
    );
  });

  it("previews through rpc when llm rules are disabled", async () => {
    const ruleExistsBuilder = createQueryBuilder({
      data: null,
      error: null,
      count: 0,
    } as never);
    const rpcMock = vi.fn().mockResolvedValue({
      data: makeRuleRun(),
      error: null,
    });
    createClientMock.mockReturnValue(
      createSupabaseClient({
        builders: {
          money_category_rules: ruleExistsBuilder,
        },
        rpc: rpcMock,
      }),
    );

    const { usePreviewMoneyCategoryRulePipeline } = await import("./use-money-category-rules");
    const { result } = renderHookWithQueryClient(() => usePreviewMoneyCategoryRulePipeline());

    await expect(
      result.current.mutateAsync({
        lineItemId: "line-1",
        personId: "person-1",
        ruleIds: ["rule-1"],
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "run-1" }));

    expect(rpcMock).toHaveBeenCalledWith("money_preview_category_rule_pipeline", {
      p_line_item_id: "line-1",
      p_person_id: "person-1",
      p_rule_ids: ["rule-1"],
    });
    expect(callMoneyCategorizeActionMock).not.toHaveBeenCalled();
  });

  it("routes preview and date-range replay through the edge function when llm rules exist", async () => {
    const ruleExistsBuilder = createQueryBuilder({
      data: null,
      error: null,
      count: 1,
    } as never);
    createClientMock.mockReturnValue(
      createSupabaseClient({
        builders: {
          money_category_rules: ruleExistsBuilder,
        },
      }),
    );
    callMoneyCategorizeActionMock
      .mockResolvedValueOnce(makeRuleRun({ id: "run-preview" }))
      .mockResolvedValueOnce({ runs: [makeRuleRun({ id: "run-range" })] });

    const { usePreviewMoneyCategoryRulePipeline, useReplayMoneyCategoryRulePipelineForDateRange } =
      await import("./use-money-category-rules");

    const previewHook = renderHookWithQueryClient(() => usePreviewMoneyCategoryRulePipeline());
    const replayHook = renderHookWithQueryClient(() =>
      useReplayMoneyCategoryRulePipelineForDateRange(),
    );
    const invalidateSpy = vi.spyOn(replayHook.queryClient, "invalidateQueries");

    await expect(
      previewHook.result.current.mutateAsync({
        lineItemId: "line-1",
        personId: "person-1",
        ruleIds: null,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "run-preview" }));

    await expect(
      replayHook.result.current.mutateAsync({
        personId: "person-1",
        from: "2026-03-01",
        to: "2026-03-10",
        forceOverwriteLocked: true,
      }),
    ).resolves.toEqual([expect.objectContaining({ id: "run-range" })]);

    expect(callMoneyCategorizeActionMock.mock.calls).toEqual([
      [
        {
          action: "preview_pipeline",
          line_item_id: "line-1",
          person_id: "person-1",
          rule_ids: null,
        },
      ],
      [
        {
          action: "replay_date_range",
          person_id: "person-1",
          from: "2026-03-01",
          to: "2026-03-10",
          force_overwrite_locked: true,
        },
      ],
    ]);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-transactions"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-transaction"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-category-debug"] });
  });

  it("applies and replays through rpc when llm rules are absent or person is omitted", async () => {
    const ruleExistsBuilder = createQueryBuilder({
      data: null,
      error: null,
      count: 0,
    } as never);
    const rpcMock = vi
      .fn()
      .mockResolvedValueOnce({ data: { runs: [makeRuleRun({ id: "run-apply" })] }, error: null })
      .mockResolvedValueOnce({
        data: { runs: [makeRuleRun({ id: "run-transaction" })] },
        error: null,
      });
    createClientMock.mockReturnValue(
      createSupabaseClient({
        builders: {
          money_category_rules: ruleExistsBuilder,
        },
        rpc: rpcMock,
      }),
    );

    const { useApplyMoneyCategoryRulePipeline, useReplayMoneyCategoryRulePipelineForTransaction } =
      await import("./use-money-category-rules");

    const applyHook = renderHookWithQueryClient(() => useApplyMoneyCategoryRulePipeline());
    const transactionHook = renderHookWithQueryClient(() =>
      useReplayMoneyCategoryRulePipelineForTransaction(),
    );
    const applyInvalidateSpy = vi.spyOn(applyHook.queryClient, "invalidateQueries");
    const replayInvalidateSpy = vi.spyOn(transactionHook.queryClient, "invalidateQueries");

    await expect(
      applyHook.result.current.mutateAsync({
        lineItemIds: ["line-1", "line-2"],
        personId: "person-1",
        forceOverwriteLocked: true,
        triggerSource: "manual_replay",
      }),
    ).resolves.toEqual([expect.objectContaining({ id: "run-apply" })]);

    await expect(
      transactionHook.result.current.mutateAsync({
        transactionId: "tx-1",
        personId: null,
        forceOverwriteLocked: false,
      }),
    ).resolves.toEqual([expect.objectContaining({ id: "run-transaction" })]);

    expect(rpcMock.mock.calls).toEqual([
      [
        "money_apply_category_rule_pipeline",
        {
          p_line_item_ids: ["line-1", "line-2"],
          p_person_id: "person-1",
          p_force_overwrite_locked: true,
          p_trigger_source: "manual_replay",
        },
      ],
      [
        "money_apply_category_rule_pipeline_for_transaction",
        {
          p_transaction_id: "tx-1",
          p_person_id: undefined,
          p_force_overwrite_locked: false,
        },
      ],
    ]);
    expect(applyInvalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-transactions"] });
    expect(applyInvalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-transaction"] });
    expect(applyInvalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-category-debug"] });
    expect(replayInvalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-transactions"] });
    expect(replayInvalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-transaction"] });
    expect(replayInvalidateSpy).toHaveBeenCalledWith({ queryKey: ["money-category-debug"] });
  });
});
