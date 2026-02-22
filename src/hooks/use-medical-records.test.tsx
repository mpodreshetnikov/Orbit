import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateMedicalRecordInput,
  MedicalRecordFilters,
  UpdateMedicalRecordInput,
} from "@/types";
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

function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "record-1",
    person_id: "person-1",
    title: "Blood Test",
    record_type: "lab",
    status: "draft",
    notes: null,
    attachments: [
      {
        id: "a2",
        sort_order: 2,
      },
      {
        id: "a1",
        sort_order: 1,
      },
    ],
    ...overrides,
  };
}

describe("use-medical-records", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    vi.unstubAllGlobals();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.test");
  });

  it("loads medical records via search rpc", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: "record-1", person_id: "person-1", title: "Blood Test" }],
      error: null,
    });
    createClientMock.mockReturnValue({ rpc });

    const { useMedicalRecords } = await import("./use-medical-records");
    const { result } = renderHookWithQueryClient(() =>
      useMedicalRecords({
        person_id: "person-1",
        search: "blood",
        status: "draft",
      } as MedicalRecordFilters),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(rpc).toHaveBeenCalledWith(
      "search_medical_records",
      expect.objectContaining({
        search_query: "blood",
        p_person_id: "person-1",
      }),
    );
  });

  it("maps unknown status and empty search to rpc params", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    createClientMock.mockReturnValue({ rpc });

    const { useMedicalRecords } = await import("./use-medical-records");
    const { result } = renderHookWithQueryClient(() =>
      useMedicalRecords({
        person_id: "person-1",
        search: "   ",
        status: "custom_status",
      } as unknown as MedicalRecordFilters),
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(rpc).toHaveBeenCalledWith(
      "search_medical_records",
      expect.objectContaining({
        search_query: undefined,
        p_person_id: "person-1",
        p_statuses: ["custom_status"],
      }),
    );
  });

  it("returns records list error from rpc", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "records rpc failed" },
    });
    createClientMock.mockReturnValue({ rpc });

    const { useMedicalRecords } = await import("./use-medical-records");
    const { result } = renderHookWithQueryClient(() =>
      useMedicalRecords({ person_id: "person-1" }),
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("records rpc failed");
  });

  it("does not fetch records without selected person", async () => {
    const { useMedicalRecords } = await import("./use-medical-records");
    const { result } = renderHookWithQueryClient(() =>
      useMedicalRecords({} as MedicalRecordFilters),
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("loads single record and sorts attachments", async () => {
    const builder = createQueryBuilder({
      data: recordRow(),
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useMedicalRecord } = await import("./use-medical-records");
    const { result } = renderHookWithQueryClient(() => useMedicalRecord("record-1"));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.attachments.map((a) => a.id)).toEqual(["a1", "a2"]);
  });

  it("returns null for missing record and [] for missing attachments", async () => {
    const notFoundBuilder = createQueryBuilder({
      data: null,
      error: { code: "PGRST116", message: "not found" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => notFoundBuilder),
    });

    const { useMedicalRecord } = await import("./use-medical-records");
    const missing = renderHookWithQueryClient(() => useMedicalRecord("record-missing"));
    await waitFor(() => expect(missing.result.current.isSuccess).toBe(true));
    expect(missing.result.current.data).toBeNull();

    const noAttachmentsBuilder = createQueryBuilder({
      data: recordRow({ attachments: null }),
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => noAttachmentsBuilder),
    });
    const noAttachments = renderHookWithQueryClient(() => useMedicalRecord("record-1"));
    await waitFor(() => expect(noAttachments.result.current.isSuccess).toBe(true));
    expect(noAttachments.result.current.data?.attachments).toEqual([]);
  });

  it("returns single-record query error", async () => {
    const builder = createQueryBuilder({
      data: null,
      error: { code: "boom", message: "record lookup failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => builder) });

    const { useMedicalRecord } = await import("./use-medical-records");
    const { result } = renderHookWithQueryClient(() => useMedicalRecord("record-1"));

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("record lookup failed");
  });

  it("creates and updates record", async () => {
    const builder = createQueryBuilder({
      data: { id: "record-1", person_id: "person-1" },
      error: null,
    });
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
      from: vi.fn(() => builder),
    });

    const { useCreateMedicalRecord, useUpdateMedicalRecord } =
      await import("./use-medical-records");
    const createHook = renderHookWithQueryClient(() => useCreateMedicalRecord());
    const updateHook = renderHookWithQueryClient(() => useUpdateMedicalRecord());

    await act(async () => {
      await createHook.result.current.mutateAsync({
        person_id: "person-1",
        title: "Blood Test",
      } as CreateMedicalRecordInput);
      await updateHook.result.current.mutateAsync({
        id: "record-1",
        updates: { title: "Updated" },
      } as { id: string; updates: UpdateMedicalRecordInput });
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        created_by_user_id: "user-1",
        status: "draft",
      }),
    );
    expect(builder.update).toHaveBeenCalled();
  });

  it("returns create/update errors and maps llm suggested completions", async () => {
    const createBuilder = createQueryBuilder({
      data: null,
      error: { message: "create failed" },
    });
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-1" } },
        }),
      },
      from: vi.fn(() => createBuilder),
    });

    const { useCreateMedicalRecord, useUpdateMedicalRecord } =
      await import("./use-medical-records");
    const createHook = renderHookWithQueryClient(() => useCreateMedicalRecord());

    await expect(
      createHook.result.current.mutateAsync({
        person_id: "person-1",
        title: "x",
      } as CreateMedicalRecordInput),
    ).rejects.toThrow("create failed");

    const updateBuilder = createQueryBuilder({
      data: null,
      error: { message: "update failed" },
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => updateBuilder),
    });
    const updateHook = renderHookWithQueryClient(() => useUpdateMedicalRecord());

    await expect(
      updateHook.result.current.mutateAsync({
        id: "record-1",
        updates: {
          title: "Updated",
          llm_suggested_checkup_completions: [
            {
              checkup_item_id: "chk-1",
              reason: "test",
              suggested_done_at: "2026-01-01",
              checkup_title: "Checkup",
            },
          ],
        },
      } as { id: string; updates: UpdateMedicalRecordInput }),
    ).rejects.toThrow("update failed");
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        llm_suggested_checkup_completions: [
          {
            checkup_item_id: "chk-1",
            reason: "test",
            suggested_done_at: "2026-01-01",
            checkup_title: "Checkup",
          },
        ],
      }),
    );
  });

  it("returns create error when auth user is missing", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
        }),
      },
      from: vi.fn(() => createQueryBuilder({ data: null, error: null })),
    });

    const { useCreateMedicalRecord } = await import("./use-medical-records");
    const { result } = renderHookWithQueryClient(() => useCreateMedicalRecord());

    await expect(
      result.current.mutateAsync({
        person_id: "person-1",
        title: "x",
      } as CreateMedicalRecordInput),
    ).rejects.toThrow("Not authenticated");
  });

  it("soft deletes and restores record", async () => {
    const builder = createQueryBuilder({
      data: { id: "record-1", person_id: "person-1" },
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn(() => builder),
    });

    const { useSoftDeleteRecord, useRestoreRecord } = await import("./use-medical-records");
    const softDelete = renderHookWithQueryClient(() => useSoftDeleteRecord());
    const restore = renderHookWithQueryClient(() => useRestoreRecord());

    await act(async () => {
      await softDelete.result.current.mutateAsync("record-1");
      await restore.result.current.mutateAsync("record-1");
    });

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "removed",
      }),
    );
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
        removed_at: null,
      }),
    );
  });

  it("returns soft-delete and restore errors", async () => {
    const softDeleteBuilder = createQueryBuilder({
      data: null,
      error: { message: "soft delete failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => softDeleteBuilder) });

    const { useSoftDeleteRecord, useRestoreRecord } = await import("./use-medical-records");
    const softDelete = renderHookWithQueryClient(() => useSoftDeleteRecord());
    await expect(softDelete.result.current.mutateAsync("record-1")).rejects.toThrow(
      "soft delete failed",
    );

    const restoreBuilder = createQueryBuilder({
      data: null,
      error: { message: "restore failed" },
    });
    createClientMock.mockReturnValue({ from: vi.fn(() => restoreBuilder) });
    const restore = renderHookWithQueryClient(() => useRestoreRecord());
    await expect(restore.result.current.mutateAsync("record-1")).rejects.toThrow("restore failed");
  });

  it("hard deletes record and removes storage files", async () => {
    const recordBuilder = createQueryBuilder({
      data: { person_id: "person-1" },
      error: null,
    });
    const deleteBuilder = createQueryBuilder({
      data: null,
      error: null,
    });
    const list = vi.fn().mockResolvedValue({
      data: [{ name: "a.png" }, { name: "b.pdf" }],
    });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const storageFrom = vi.fn(() => ({ list, remove }));

    createClientMock.mockReturnValue({
      from: vi.fn((table: string) => (table === "medical_records" ? recordBuilder : deleteBuilder)),
      storage: {
        from: storageFrom,
      },
    });

    const { useHardDeleteRecord } = await import("./use-medical-records");
    const { result } = renderHookWithQueryClient(() => useHardDeleteRecord());

    await act(async () => {
      await result.current.mutateAsync("record-1");
    });

    expect(storageFrom).toHaveBeenCalledWith("medical-attachments");
    expect(list).toHaveBeenCalledWith("person-1/record-1");
    expect(remove).toHaveBeenCalledWith(["person-1/record-1/a.png", "person-1/record-1/b.pdf"]);
    expect(recordBuilder.delete).toHaveBeenCalled();
  });

  it("hard deletes when record is missing and when folder has no files", async () => {
    const recordMissingBuilder = createQueryBuilder({
      data: null,
      error: null,
    });
    const deleteBuilder = createQueryBuilder({
      data: null,
      error: null,
    });
    const list = vi.fn().mockResolvedValue({ data: [] });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const storageFrom = vi.fn(() => ({ list, remove }));
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "medical_records" ? recordMissingBuilder : deleteBuilder,
      ),
      storage: { from: storageFrom },
    });

    const { useHardDeleteRecord } = await import("./use-medical-records");
    const missingRecord = renderHookWithQueryClient(() => useHardDeleteRecord());
    await missingRecord.result.current.mutateAsync("record-1");
    expect(list).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    const recordWithFolderBuilder = createQueryBuilder({
      data: { person_id: "person-1" },
      error: null,
    });
    createClientMock.mockReturnValue({
      from: vi.fn((table: string) =>
        table === "medical_records" ? recordWithFolderBuilder : deleteBuilder,
      ),
      storage: { from: storageFrom },
    });
    const noFiles = renderHookWithQueryClient(() => useHardDeleteRecord());
    await noFiles.result.current.mutateAsync("record-2");
    expect(list).toHaveBeenCalledWith("person-1/record-2");
    expect(remove).not.toHaveBeenCalled();
  });

  it("returns hard-delete error when record delete fails", async () => {
    const recordBuilder = createQueryBuilder({
      data: null,
      error: null,
    });
    const deleteBuilder = createQueryBuilder({
      data: null,
      error: { message: "delete failed" },
    });
    const from = vi
      .fn()
      .mockImplementationOnce(() => recordBuilder)
      .mockImplementationOnce(() => deleteBuilder);
    createClientMock.mockReturnValue({
      from,
      storage: {
        from: vi.fn(() => ({ list: vi.fn(), remove: vi.fn() })),
      },
    });

    const { useHardDeleteRecord } = await import("./use-medical-records");
    const { result } = renderHookWithQueryClient(() => useHardDeleteRecord());

    await expect(result.current.mutateAsync("record-1")).rejects.toThrow("delete failed");
  });

  it("ingests record successfully and invalidates record query", async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { access_token: "token-1" } },
    });
    createClientMock.mockReturnValue({
      auth: { getSession },
      from: vi.fn(() => createQueryBuilder({ data: null, error: null })),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          success: true,
          extraction: {},
        }),
      })) as unknown as typeof fetch,
    );

    const { useIngestRecord } = await import("./use-medical-records");
    const { result, queryClient } = renderHookWithQueryClient(() => useIngestRecord());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({ recordId: "record-1" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["medical-record", "record-1"],
    });
  });

  it("returns ingest error when session is missing", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
        }),
      },
      from: vi.fn(() => createQueryBuilder({ data: null, error: null })),
    });

    const { useIngestRecord } = await import("./use-medical-records");
    const { result } = renderHookWithQueryClient(() => useIngestRecord());

    await act(async () => {
      await expect(result.current.mutateAsync({ recordId: "record-1" })).rejects.toThrow(
        "Not authenticated",
      );
    });
  });

  it("returns ingest error when supabase url is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-1" } },
        }),
      },
      from: vi.fn(() => createQueryBuilder({ data: null, error: null })),
    });

    const { useIngestRecord } = await import("./use-medical-records");
    const { result } = renderHookWithQueryClient(() => useIngestRecord());
    await expect(result.current.mutateAsync({ recordId: "record-1" })).rejects.toThrow(
      "Supabase URL not configured",
    );
  });

  it("returns ingest network error when fetch throws", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-1" } },
        }),
      },
      from: vi.fn(() => createQueryBuilder({ data: null, error: null })),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    );

    const { useIngestRecord } = await import("./use-medical-records");
    const { result } = renderHookWithQueryClient(() => useIngestRecord());
    await expect(result.current.mutateAsync({ recordId: "record-1" })).rejects.toThrow(
      "Cannot connect to Edge Functions",
    );
  });

  it("returns ingest http/json/business errors", async () => {
    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { access_token: "token-1" } },
        }),
      },
      from: vi.fn(() => createQueryBuilder({ data: null, error: null })),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: async () => "upstream failed",
      })) as unknown as typeof fetch,
    );
    let hook = renderHookWithQueryClient((await import("./use-medical-records")).useIngestRecord);
    await expect(hook.result.current.mutateAsync({ recordId: "record-1" })).rejects.toThrow(
      "Edge Function error (500): upstream failed",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new Error("bad json");
        },
      })) as unknown as typeof fetch,
    );
    hook = renderHookWithQueryClient((await import("./use-medical-records")).useIngestRecord);
    await expect(hook.result.current.mutateAsync({ recordId: "record-1" })).rejects.toThrow(
      "Invalid response from Edge Function",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          success: false,
          error: "ingestion failed",
        }),
      })) as unknown as typeof fetch,
    );
    hook = renderHookWithQueryClient((await import("./use-medical-records")).useIngestRecord);
    await expect(hook.result.current.mutateAsync({ recordId: "record-1" })).rejects.toThrow(
      "ingestion failed",
    );
  });
});
