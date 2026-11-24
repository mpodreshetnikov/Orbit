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

const recordKey = ["record-observations", "r1"];
const otherRecordKey = ["record-observations", "r2"];

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

  it("creates an observation and invalidates its record", async () => {
    const input = { record_id: "r1", obs_name: "Glucose", value_numeric: 5.2 };
    const created = { ...input, id: "o1" };
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useCreateRecordObservation } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateRecordObservation());
    queryClient.setQueryData(recordKey, []);
    queryClient.setQueryData(otherRecordKey, []);

    await act(async () => {
      expect(await result.current.mutateAsync(input)).toEqual(created);
    });

    expect(builder.insert).toHaveBeenCalledWith(input);
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRecordKey)?.isInvalidated).toBe(false);
  });

  it("returns an empty batch without writing or invalidating cached queries", async () => {
    const { useCreateRecordObservations } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateRecordObservations());
    queryClient.setQueryData(recordKey, [{ id: "o1", record_id: "r1" }]);

    await act(async () => {
      expect(await result.current.mutateAsync([])).toEqual([]);
    });

    expect(createClientMock).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(false);
  });

  it("returns all created observations and invalidates their record", async () => {
    const first = { record_id: "r1", obs_name: "Glucose", value_numeric: 5.2 };
    const second = { ...first, obs_name: "Hemoglobin" };
    const inputs = [first, second];
    const created = [
      { ...first, id: "o1" },
      { ...second, id: "o2" },
    ];
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useCreateRecordObservations } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateRecordObservations());
    queryClient.setQueryData(recordKey, []);
    queryClient.setQueryData(otherRecordKey, []);

    await act(async () => {
      expect(await result.current.mutateAsync(inputs)).toEqual(created);
    });

    expect(builder.insert).toHaveBeenCalledWith(inputs);
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRecordKey)?.isInvalidated).toBe(false);
  });

  it("returns the updated observation and invalidates its record", async () => {
    const updated = { id: "o1", record_id: "r1", obs_name: "Hemoglobin" };
    const builder = createQueryBuilder({ data: updated, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useUpdateRecordObservation } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateRecordObservation());
    queryClient.setQueryData(recordKey, [{ ...updated, obs_name: "Glucose" }]);
    queryClient.setQueryData(otherRecordKey, []);

    await act(async () => {
      expect(
        await result.current.mutateAsync({
          id: "o1",
          updates: { obs_name: "Hemoglobin" },
        }),
      ).toEqual(updated);
    });

    expect(builder.update).toHaveBeenCalledWith({ obs_name: "Hemoglobin" });
    expect(builder.eq).toHaveBeenCalledWith("id", "o1");
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRecordKey)?.isInvalidated).toBe(false);
  });

  it("deletes one observation and invalidates its record", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteRecordObservation } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteRecordObservation());
    queryClient.setQueryData(recordKey, [{ id: "o1" }, { id: "o2" }]);
    queryClient.setQueryData(otherRecordKey, []);

    await act(async () => {
      await result.current.mutateAsync({ id: "o1", recordId: "r1" });
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "o1");
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRecordKey)?.isInvalidated).toBe(false);
  });

  it("deletes all observations for one record and invalidates its list", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteAllRecordObservations } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() =>
      useDeleteAllRecordObservations(),
    );
    queryClient.setQueryData(recordKey, [{ id: "o1" }, { id: "o2" }]);
    queryClient.setQueryData(otherRecordKey, []);

    await act(async () => {
      await result.current.mutateAsync("r1");
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("record_id", "r1");
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRecordKey)?.isInvalidated).toBe(false);
  });

  it("verifies an observation and invalidates its record", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useVerifyRecordObservation } = await import("./use-record-observations");
    const { result, queryClient } = renderHookWithQueryClient(() => useVerifyRecordObservation());
    queryClient.setQueryData(recordKey, [{ id: "o1", is_user_verified: false }]);
    queryClient.setQueryData(otherRecordKey, []);

    await act(async () => {
      expect(await result.current.mutateAsync({ id: "o1", recordId: "r1" })).toEqual({
        id: "o1",
        recordId: "r1",
      });
    });

    expect(builder.update).toHaveBeenCalledWith({ is_user_verified: true });
    expect(builder.eq).toHaveBeenCalledWith("id", "o1");
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRecordKey)?.isInvalidated).toBe(false);
  });
});
