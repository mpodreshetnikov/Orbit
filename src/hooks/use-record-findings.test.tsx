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

const recordKey = ["record-findings", "r1"];
const otherRecordKey = ["record-findings", "r2"];
const historyKey = ["person-finding-history", "p1", "nod"];

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

  it("creates a finding and invalidates its record", async () => {
    const input = {
      record_id: "r1",
      finding_type_text: "Nodule",
      person_id: "p1",
      source_anchor: "line",
    };
    const created = { ...input, id: "f1" };
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useCreateRecordFinding } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateRecordFinding());
    queryClient.setQueryData(recordKey, []);
    queryClient.setQueryData(otherRecordKey, []);
    queryClient.setQueryData(historyKey, []);

    await act(async () => {
      expect(await result.current.mutateAsync(input)).toEqual(created);
    });

    expect(builder.insert).toHaveBeenCalledWith(input);
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRecordKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(historyKey)?.isInvalidated).toBe(true);
  });

  it("returns an empty batch without writing or invalidating cached queries", async () => {
    const { useCreateRecordFindings } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateRecordFindings());
    queryClient.setQueryData(recordKey, [{ id: "f1", record_id: "r1" }]);
    queryClient.setQueryData(historyKey, []);

    await act(async () => {
      expect(await result.current.mutateAsync([])).toEqual([]);
    });

    expect(createClientMock).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(historyKey)?.isInvalidated).toBe(false);
  });

  it("returns all created findings and invalidates their record", async () => {
    const first = {
      record_id: "r1",
      finding_type_text: "Nodule",
      person_id: "p1",
      source_anchor: "line",
    };
    const second = { ...first, finding_type_text: "Cyst" };
    const inputs = [first, second];
    const created = [
      { ...first, id: "f1" },
      { ...second, id: "f2" },
    ];
    const builder = createQueryBuilder({ data: created, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useCreateRecordFindings } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useCreateRecordFindings());
    queryClient.setQueryData(recordKey, []);
    queryClient.setQueryData(otherRecordKey, []);
    queryClient.setQueryData(historyKey, []);

    await act(async () => {
      expect(await result.current.mutateAsync(inputs)).toEqual(created);
    });

    expect(builder.insert).toHaveBeenCalledWith(inputs);
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRecordKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(historyKey)?.isInvalidated).toBe(true);
  });

  it("returns the updated finding and invalidates its record", async () => {
    const updated = { id: "f1", record_id: "r1", finding_type_text: "Cyst" };
    const writeBuilder = createQueryBuilder({ data: null, error: null });
    const readBuilder = createQueryBuilder({ data: updated, error: null });
    const from = vi.fn().mockReturnValueOnce(writeBuilder).mockReturnValueOnce(readBuilder);
    createClientMock.mockReturnValue({ from });

    const { useUpdateRecordFinding } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateRecordFinding());
    queryClient.setQueryData(recordKey, [{ ...updated, finding_type_text: "Nodule" }]);
    queryClient.setQueryData(otherRecordKey, []);
    queryClient.setQueryData(historyKey, []);

    await act(async () => {
      expect(
        await result.current.mutateAsync({
          id: "f1",
          updates: { finding_type_text: "Cyst" },
        }),
      ).toEqual(updated);
    });

    expect(writeBuilder.update).toHaveBeenCalledWith({ finding_type_text: "Cyst" });
    expect(writeBuilder.eq).toHaveBeenCalledWith("id", "f1");
    expect(readBuilder.eq).toHaveBeenCalledWith("id", "f1");
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRecordKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(historyKey)?.isInvalidated).toBe(true);
  });

  it("deletes one finding and invalidates its record", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteRecordFinding } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteRecordFinding());
    queryClient.setQueryData(recordKey, [{ id: "f1" }, { id: "f2" }]);
    queryClient.setQueryData(otherRecordKey, []);
    queryClient.setQueryData(historyKey, []);

    await act(async () => {
      await result.current.mutateAsync({ id: "f1", recordId: "r1" });
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("id", "f1");
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRecordKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(historyKey)?.isInvalidated).toBe(true);
  });

  it("deletes all findings for one record and invalidates its list", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useDeleteAllRecordFindings } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useDeleteAllRecordFindings());
    queryClient.setQueryData(recordKey, [{ id: "f1" }, { id: "f2" }]);
    queryClient.setQueryData(otherRecordKey, []);
    queryClient.setQueryData(historyKey, []);

    await act(async () => {
      await result.current.mutateAsync("r1");
    });

    expect(builder.delete).toHaveBeenCalled();
    expect(builder.eq).toHaveBeenCalledWith("record_id", "r1");
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRecordKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(historyKey)?.isInvalidated).toBe(true);
  });

  it("verifies a finding and invalidates its record", async () => {
    const builder = createQueryBuilder({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useVerifyRecordFinding } = await import("./use-record-findings");
    const { result, queryClient } = renderHookWithQueryClient(() => useVerifyRecordFinding());
    queryClient.setQueryData(recordKey, [{ id: "f1", is_user_verified: false }]);
    queryClient.setQueryData(otherRecordKey, []);

    await act(async () => {
      expect(await result.current.mutateAsync({ id: "f1", recordId: "r1" })).toEqual({
        id: "f1",
        recordId: "r1",
      });
    });

    expect(builder.update).toHaveBeenCalledWith({ is_user_verified: true });
    expect(builder.eq).toHaveBeenCalledWith("id", "f1");
    expect(queryClient.getQueryState(recordKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherRecordKey)?.isInvalidated).toBe(false);
  });
});
