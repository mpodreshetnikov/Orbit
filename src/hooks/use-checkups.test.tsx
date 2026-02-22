import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckupItemsFilters, UpdateCheckupCompletionInput } from "@/types";
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

function checkupItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "checkup-1",
    person_id: "person-1",
    title: "Blood test",
    category: "lab",
    schedule: { cadence: "yearly" },
    next_due_at: "2026-06-01",
    status: "active",
    reminder_days_before: [7, "bad", 1],
    planned_on: null,
    why_text: null,
    why_links: [{ type: "condition", id: "cond-1", label: "Condition 1" }],
    notes: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("use-checkups", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("filters checkup items by overdue window and condition id", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const builder = createQueryBuilder({
      data: [
        checkupItemRow({
          id: "overdue",
          next_due_at: yesterday,
          why_links: [{ type: "condition", id: "cond-1", label: "Condition 1" }],
        }),
        checkupItemRow({
          id: "upcoming",
          next_due_at: tomorrow,
          why_links: [{ type: "condition", id: "cond-2", label: "Condition 2" }],
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useCheckupItems } = await import("./use-checkups");
    const { result } = renderHookWithQueryClient(() =>
      useCheckupItems("person-1", {
        dueWindow: "overdue",
        conditionId: "cond-1",
      } as CheckupItemsFilters),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((i) => i.id)).toEqual(["overdue"]);
    expect(result.current.data?.[0].reminder_days_before).toEqual([7, 1]);
  });

  it("returns null when single checkup item is missing", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useCheckupItem } = await import("./use-checkups");
    const { result } = renderHookWithQueryClient(() => useCheckupItem("missing"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("loads completions and checkups for a condition", async () => {
    const fromBuilder = createQueryBuilder({
      data: [
        {
          id: "completion-1",
          checkup_item_id: "checkup-1",
          done_at: "2026-01-01",
          note: "ok",
          evidence_record_id: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const rpc = vi.fn().mockResolvedValue({
      data: [checkupItemRow()],
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => fromBuilder),
      rpc,
    });

    const { useCheckupCompletions, useCheckupsForCondition } = await import("./use-checkups");

    const completions = renderHookWithQueryClient(() => useCheckupCompletions("checkup-1"));
    const forCondition = renderHookWithQueryClient(() => useCheckupsForCondition("cond-1"));

    await waitFor(() => expect(completions.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(forCondition.result.current.isSuccess).toBe(true));

    expect(completions.result.current.data?.[0]).toEqual(
      expect.objectContaining({
        id: "completion-1",
        checkup_item_id: "checkup-1",
      }),
    );
    expect(rpc).toHaveBeenCalledWith("get_checkups_for_condition", {
      p_condition_id: "cond-1",
    });
  });

  it("creates and updates checkup item", async () => {
    const builder = createQueryBuilder({
      data: checkupItemRow(),
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useCreateCheckupItem, useUpdateCheckupItem } = await import("./use-checkups");
    const createHook = renderHookWithQueryClient(() => useCreateCheckupItem());
    const updateHook = renderHookWithQueryClient(() => useUpdateCheckupItem());

    await act(async () => {
      await createHook.result.current.mutateAsync({
        person_id: "person-1",
        title: "Blood test",
        category: "lab",
        schedule: { cadence: "yearly" },
      } as unknown as import("@/types").CreateCheckupItemInput);
      await updateHook.result.current.mutateAsync({
        id: "checkup-1",
        updates: { title: "Updated", notes: "n" },
      });
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        person_id: "person-1",
        reminder_days_before: [7],
      }),
    );
    expect(builder.update).toHaveBeenCalledWith({ title: "Updated", notes: "n" });
  });

  it("completes and updates checkup completion with normalized dates", async () => {
    const builder = createQueryBuilder({
      data: {
        id: "completion-1",
        checkup_item_id: "checkup-1",
        done_at: "2026-01-01",
        note: null,
        evidence_record_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useCompleteCheckupItem, useUpdateCheckupCompletion } = await import("./use-checkups");
    const completeHook = renderHookWithQueryClient(() => useCompleteCheckupItem());
    const updateHook = renderHookWithQueryClient(() => useUpdateCheckupCompletion());

    await act(async () => {
      await completeHook.result.current.mutateAsync({
        checkup_item_id: "checkup-1",
        done_at: "2026-01-01T10:11:12.000Z",
      } as unknown as import("@/types").CreateCheckupCompletionInput);
      await updateHook.result.current.mutateAsync({
        id: "completion-1",
        updates: { done_at: "2026-02-01T12:00:00.000Z", note: "updated" },
      } as { id: string; updates: UpdateCheckupCompletionInput });
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        done_at: "2026-01-01",
      }),
    );
    expect(builder.update).toHaveBeenCalledWith({
      done_at: "2026-02-01",
      note: "updated",
    });
  });

  it("deletes completion and checkup item", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useDeleteCheckupCompletion, useDeleteCheckupItem } = await import("./use-checkups");
    const deleteCompletion = renderHookWithQueryClient(() => useDeleteCheckupCompletion());
    const deleteItem = renderHookWithQueryClient(() => useDeleteCheckupItem());

    await act(async () => {
      await deleteCompletion.result.current.mutateAsync({
        id: "completion-1",
        checkupItemId: "checkup-1",
      });
      await deleteItem.result.current.mutateAsync({
        id: "checkup-1",
        personId: "person-1",
      });
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "completion-1");
    expect(builder.eq).toHaveBeenCalledWith("id", "checkup-1");
  });

  it("supports upcoming window with category/status filters and malformed why_links", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const builder = createQueryBuilder({
      data: [
        checkupItemRow({
          id: "upcoming-good",
          category: "lab",
          status: "active",
          next_due_at: tomorrow,
          why_links: [{ type: "condition", id: "cond-1" }], // no label -> fallback to id
          reminder_days_before: "bad",
        }),
        checkupItemRow({
          id: "wrong-status",
          category: "lab",
          status: "paused",
          next_due_at: tomorrow,
        }),
      ],
      error: null,
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useCheckupItems } = await import("./use-checkups");
    const { result } = renderHookWithQueryClient(() =>
      useCheckupItems("person-1", {
        dueWindow: "upcoming",
        category: "lab",
        status: "active",
      } as CheckupItemsFilters),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((i) => i.id)).toEqual(["upcoming-good"]);
    expect(result.current.data?.[0].why_links).toEqual([
      { type: "condition", id: "cond-1", label: "cond-1" },
    ]);
    expect(result.current.data?.[0].reminder_days_before).toEqual([7]);
    expect(builder.eq).toHaveBeenCalledWith("category", "lab");
    expect(builder.eq).toHaveBeenCalledWith("status", "active");
  });

  it("returns fetch errors for single item and RPC condition lookup", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { code: "boom", message: "checkup fetch failed" },
    });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "rpc failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
      rpc,
    });

    const { useCheckupItem, useCheckupsForCondition } = await import("./use-checkups");
    const itemHook = renderHookWithQueryClient(() => useCheckupItem("checkup-1"));
    const rpcHook = renderHookWithQueryClient(() => useCheckupsForCondition("cond-1"));

    await waitFor(() => expect(itemHook.result.current.isError).toBe(true));
    await waitFor(() => expect(rpcHook.result.current.isError).toBe(true));
    expect((itemHook.result.current.error as Error).message).toBe("checkup fetch failed");
    expect((rpcHook.result.current.error as Error).message).toBe("rpc failed");
  });

  it("normalizes completion dates for empty updates and missing done_at", async () => {
    const builder = createQueryBuilder({
      data: {
        id: "completion-2",
        checkup_item_id: "checkup-1",
        done_at: "2026-01-05",
        note: null,
        evidence_record_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useCompleteCheckupItem, useUpdateCheckupCompletion } = await import("./use-checkups");
    const completeHook = renderHookWithQueryClient(() => useCompleteCheckupItem());
    const updateHook = renderHookWithQueryClient(() => useUpdateCheckupCompletion());

    await act(async () => {
      await completeHook.result.current.mutateAsync({
        checkup_item_id: "checkup-1",
        done_at: undefined,
      } as unknown as import("@/types").CreateCheckupCompletionInput);
      await updateHook.result.current.mutateAsync({
        id: "completion-2",
        updates: { done_at: "   ", note: "kept" },
      } as { id: string; updates: UpdateCheckupCompletionInput });
    });

    const insertPayload = builder.insert.mock.calls[0]?.[0] as { done_at: string };
    expect(insertPayload.done_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(builder.update).toHaveBeenCalledWith({ note: "kept" });
  });
});
