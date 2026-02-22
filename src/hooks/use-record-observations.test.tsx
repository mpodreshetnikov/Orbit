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

describe("use-record-observations", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("loads record observations through rpc", async () => {
    const data = [{ id: "o1", record_id: "r1", obs_name: "Glucose" }];
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    createClientMock.mockReturnValue({ rpc });

    const { useRecordObservations } = await import("./use-record-observations");
    const { result } = renderHookWithQueryClient(() => useRecordObservations("r1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(data);
    expect(rpc).toHaveBeenCalledWith("get_record_observations", {
      p_record_id: "r1",
    });
  });

  it("returns query error", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "rpc failed" },
    });
    createClientMock.mockReturnValue({ rpc });

    const { useRecordObservations } = await import("./use-record-observations");
    const { result } = renderHookWithQueryClient(() => useRecordObservations("r1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("rpc failed");
  });

  it("creates observation and invalidates record query", async () => {
    const created = {
      id: "o1",
      record_id: "r1",
      person_id: "p1",
    };
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useCreateRecordObservation } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateRecordObservation());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        record_id: "r1",
        person_id: "p1",
        obs_name: "Glucose",
        source_anchor: "line",
      } as import("@/types").CreateRecordObservationInput);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-observations", "r1"],
    });
  });

  it("handles empty batch create without supabase calls", async () => {
    const { useCreateRecordObservations } = await import("./use-record-observations");
    const { result } = renderHookWithQueryClient(() => useCreateRecordObservations());

    await act(async () => {
      await result.current.mutateAsync([]);
    });

    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("creates observation batch and invalidates record query", async () => {
    const created = [{ id: "o1", record_id: "r1" }];
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useCreateRecordObservations } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateRecordObservations());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync([
        { record_id: "r1", obs_name: "Glucose", source_anchor: "line" },
      ] as unknown as import("@/types").CreateRecordObservationInput[]);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-observations", "r1"],
    });
  });

  it("updates observation and invalidates record query", async () => {
    const updated = { id: "o1", record_id: "r1" };
    const builder = createQueryBuilder({ data: updated, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useUpdateRecordObservation } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateRecordObservation());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        id: "o1",
        updates: { obs_name: "Updated" },
      } as { id: string; updates: import("@/types").UpdateRecordObservationInput });
    });

    expect(builder.update).toHaveBeenCalledWith({ obs_name: "Updated" });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-observations", "r1"],
    });
  });

  it("deletes observation and invalidates record query", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteRecordObservation } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteRecordObservation());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ id: "o1", recordId: "r1" });
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-observations", "r1"],
    });
  });

  it("deletes all observations and invalidates record query", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteAllRecordObservations } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useDeleteAllRecordObservations(),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync("r1");
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-observations", "r1"],
    });
  });

  it("verifies observation and invalidates record query", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useVerifyRecordObservation } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() => useVerifyRecordObservation());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ id: "o1", recordId: "r1" });
    });

    expect(builder.update).toHaveBeenCalledWith({ is_user_verified: true });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["record-observations", "r1"],
    });
  });
});
