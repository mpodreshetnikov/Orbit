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

describe("use-record-findings", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("loads record findings through rpc", async () => {
    const data = [{ id: "f1", record_id: "r1", finding_type_text: "Nodule" }];
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    createClientMock.mockReturnValue({ rpc });

    const { useRecordFindings } = await import("./use-record-findings");
    const { result } = renderHookWithQueryClient(() => useRecordFindings("r1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(rpc).toHaveBeenCalledWith("get_record_findings", {
      p_record_id: "r1",
    });
  });

  it("returns query error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "rpc failed" },
    });
    createClientMock.mockReturnValue({ rpc });

    const { useRecordFindings } = await import("./use-record-findings");
    const { result } = renderHookWithQueryClient(() => useRecordFindings("r1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("rpc failed");
  });

  it("creates finding and invalidates list + history", async () => {
    const created = {
      id: "f1",
      record_id: "r1",
      person_id: "p1",
    };
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useCreateRecordFinding } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateRecordFinding());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        record_id: "r1",
        person_id: "p1",
        finding_type_text: "Nodule",
        source_anchor: "line",
      } as import("@/types").CreateRecordFindingInput);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-findings", "r1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["person-finding-history"],
    });
  });

  it("handles empty batch create without touching supabase", async () => {
    const { useCreateRecordFindings } = await import("./use-record-findings");
    const { result } = renderHookWithQueryClient(() => useCreateRecordFindings());

    await act(async () => {
      await result.current.mutateAsync([]);
    });

    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("creates batch findings and invalidates first record list", async () => {
    const created = [
      { id: "f1", record_id: "r1" },
      { id: "f2", record_id: "r1" },
    ];
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useCreateRecordFindings } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateRecordFindings());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync([
        { record_id: "r1", finding_type_text: "Nodule", source_anchor: "line" },
      ] as import("@/types").CreateRecordFindingInput[]);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-findings", "r1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["person-finding-history"],
    });
  });

  it("updates finding and invalidates related caches", async () => {
    const updated = { id: "f1", record_id: "r1" };
    const builder = createQueryBuilder({ data: updated, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useUpdateRecordFinding } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateRecordFinding());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "f1",
        updates: { finding_type_text: "Updated" },
      } as { id: string; updates: import("@/types").UpdateRecordFindingInput });
    });

    expect(builder.update).toHaveBeenCalledWith({ finding_type_text: "Updated" });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-findings", "r1"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["person-finding-history"],
    });
  });

  it("deletes finding and invalidates related caches", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteRecordFinding } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteRecordFinding());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ id: "f1", recordId: "r1" });
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-findings", "r1"],
    });
  });

  it("deletes all findings and invalidates list", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteAllRecordFindings } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteAllRecordFindings());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync("r1");
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-findings", "r1"],
    });
  });

  it("verifies finding and invalidates record list", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useVerifyRecordFinding } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useVerifyRecordFinding());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ id: "f1", recordId: "r1" });
    });

    expect(builder.update).toHaveBeenCalledWith({ is_user_verified: true });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-findings", "r1"],
    });
  });
});
