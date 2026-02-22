import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordAttachment } from "@/types";
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

function makeAttachment(overrides: Partial<RecordAttachment> = {}): RecordAttachment {
  return {
    id: "att-1",
    record_id: "record-1",
    storage_path: "person-1/record-1/1700000000000_scan__.png",
    mime_type: "image/png",
    original_filename: "scan ?.png",
    file_size: 128,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("use-attachments", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("uploads attachment, defaults sort_order to 0, and invalidates record query", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const bucket = { upload, remove, createSignedUrl: vi.fn() };
    const bucketFrom = vi.fn(() => bucket);
    const builder = createQueryBuilder<RecordAttachment>({
      data: makeAttachment(),
      error: null,
    });
    const from = vi.fn(() => builder);
    createClientMock.mockReturnValue({
      storage: { from: bucketFrom },
      from,
    });

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
    const { useUploadAttachment } = await import("./use-attachments");
    const { result, queryClient } = renderHookWithQueryClient(() => useUploadAttachment());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const file = new File(["x"], "scan ?.png", { type: "image/png" });

    await act(async () => {
      await result.current.mutateAsync({
        recordId: "record-1",
        personId: "person-1",
        file,
      });
    });

    expect(upload).toHaveBeenCalledWith(
      "person-1/record-1/1700000000000_scan__.png",
      file,
      expect.objectContaining({
        cacheControl: "3600",
        upsert: false,
      }),
    );
    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        record_id: "record-1",
        storage_path: "person-1/record-1/1700000000000_scan__.png",
        sort_order: 0,
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["medical-record", "record-1"],
    });
    nowSpy.mockRestore();
  });

  it("throws when storage upload fails", async () => {
    const upload = vi.fn().mockResolvedValue({ error: { message: "upload failed" } });
    const bucket = { upload, remove: vi.fn(), createSignedUrl: vi.fn() };
    const from = vi.fn();
    createClientMock.mockReturnValue({
      storage: { from: vi.fn(() => bucket) },
      from,
    });

    const { useUploadAttachment } = await import("./use-attachments");
    const { result } = renderHookWithQueryClient(() => useUploadAttachment());

    await expect(
      result.current.mutateAsync({
        recordId: "record-1",
        personId: "person-1",
        file: new File(["x"], "scan.png", { type: "image/png" }),
      }),
    ).rejects.toThrow("Upload failed: upload failed");
    expect(from).not.toHaveBeenCalled();
  });

  it("cleans up storage when db insert fails", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const bucket = { upload, remove, createSignedUrl: vi.fn() };
    const builder = createQueryBuilder<RecordAttachment | null>({
      data: null,
      error: { message: "insert failed" },
    });
    createClientMock.mockReturnValue({
      storage: { from: vi.fn(() => bucket) },
      from: vi.fn(() => builder),
    });
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);

    const { useUploadAttachment } = await import("./use-attachments");
    const { result } = renderHookWithQueryClient(() => useUploadAttachment());

    await expect(
      result.current.mutateAsync({
        recordId: "record-1",
        personId: "person-1",
        file: new File(["x"], "scan ?.png", { type: "image/png" }),
      }),
    ).rejects.toThrow("insert failed");
    expect(remove).toHaveBeenCalledWith(["person-1/record-1/1700000000000_scan__.png"]);
    nowSpy.mockRestore();
  });

  it("uploads multiple attachments and invalidates only when result is non-empty", async () => {
    let call = 0;
    createClientMock.mockImplementation(() => {
      call += 1;
      const bucket = {
        upload: vi.fn().mockResolvedValue({ error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
        createSignedUrl: vi.fn(),
      };
      const builder = createQueryBuilder<RecordAttachment>({
        data: makeAttachment({ id: `att-${call}`, sort_order: call - 1 }),
        error: null,
      });
      return {
        storage: { from: vi.fn(() => bucket) },
        from: vi.fn(() => builder),
      };
    });

    const { useUploadMultipleAttachments } = await import("./use-attachments");
    const { result, queryClient } = renderHookWithQueryClient(() => useUploadMultipleAttachments());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const uploaded = await result.current.mutateAsync({
      recordId: "record-1",
      personId: "person-1",
      files: [
        new File(["a"], "a.png", { type: "image/png" }),
        new File(["b"], "b.png", { type: "image/png" }),
      ],
    });

    expect(uploaded).toHaveLength(2);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["medical-record", "record-1"],
    });

    createClientMock.mockReset();
    const emptyHook = renderHookWithQueryClient(() => useUploadMultipleAttachments());
    const emptyInvalidateSpy = vi.spyOn(emptyHook.queryClient, "invalidateQueries");
    const empty = await emptyHook.result.current.mutateAsync({
      recordId: "record-1",
      personId: "person-1",
      files: [],
    });
    expect(empty).toEqual([]);
    expect(emptyInvalidateSpy).not.toHaveBeenCalled();
  });

  it("throws for storage/delete errors and invalidates on success", async () => {
    const attachment = makeAttachment();

    const storageErrorClient = {
      storage: {
        from: vi.fn(() => ({
          remove: vi.fn().mockResolvedValue({ error: { message: "storage fail" } }),
        })),
      },
      from: vi.fn(),
    };
    createClientMock.mockReturnValue(storageErrorClient);
    const { useDeleteAttachment } = await import("./use-attachments");
    const storageErrorHook = renderHookWithQueryClient(() => useDeleteAttachment());
    await expect(storageErrorHook.result.current.mutateAsync(attachment)).rejects.toThrow(
      "Storage delete failed: storage fail",
    );

    const dbErrorBuilder = createQueryBuilder<null>({
      data: null,
      error: { message: "db delete failed" },
    });
    createClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          remove: vi.fn().mockResolvedValue({ error: null }),
        })),
      },
      from: vi.fn(() => dbErrorBuilder),
    });
    const dbErrorHook = renderHookWithQueryClient(() => useDeleteAttachment());
    await expect(dbErrorHook.result.current.mutateAsync(attachment)).rejects.toThrow(
      "db delete failed",
    );

    const successBuilder = createQueryBuilder<null>({ data: null, error: null });
    createClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          remove: vi.fn().mockResolvedValue({ error: null }),
        })),
      },
      from: vi.fn(() => successBuilder),
    });
    const successHook = renderHookWithQueryClient(() => useDeleteAttachment());
    const invalidateSpy = vi.spyOn(successHook.queryClient, "invalidateQueries");
    await act(async () => {
      await successHook.result.current.mutateAsync(attachment);
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["medical-record", "record-1"],
    });
  });

  it("handles attachment-url query enablement and error/success branches", async () => {
    const { useAttachmentUrl } = await import("./use-attachments");

    const disabledHook = renderHookWithQueryClient(() => useAttachmentUrl(null));
    await waitFor(() => expect(disabledHook.result.current.fetchStatus).toBe("idle"));
    expect(createClientMock).not.toHaveBeenCalled();

    createClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn().mockResolvedValue({
            data: { signedUrl: "https://signed.test/file-1" },
            error: null,
          }),
        })),
      },
    });
    const successHook = renderHookWithQueryClient(() => useAttachmentUrl("path/a"));
    await waitFor(() => expect(successHook.result.current.isSuccess).toBe(true));
    expect(successHook.result.current.data).toBe("https://signed.test/file-1");

    createClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "signed url failed" },
          }),
        })),
      },
    });
    const errorHook = renderHookWithQueryClient(() => useAttachmentUrl("path/b"));
    await waitFor(() => expect(errorHook.result.current.isError).toBe(true));
    expect((errorHook.result.current.error as Error).message).toBe("signed url failed");
  });

  it("handles multiple attachment url queries and update-order mutation", async () => {
    const attachmentA = makeAttachment({ id: "att-a", storage_path: "a/path.png" });
    const attachmentB = makeAttachment({ id: "att-b", storage_path: "b/path.png" });

    const createSignedUrl = vi
      .fn()
      .mockResolvedValueOnce({ data: { signedUrl: "https://signed.test/a" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "skip b" } });
    createClientMock.mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          createSignedUrl,
        })),
      },
      from: vi.fn(() => createQueryBuilder<null>({ data: null, error: null })),
    });

    const { useAttachmentUrls, useUpdateAttachmentOrder } = await import("./use-attachments");
    const urlsHook = renderHookWithQueryClient(() => useAttachmentUrls([attachmentA, attachmentB]));
    await waitFor(() => expect(urlsHook.result.current.isSuccess).toBe(true));
    expect(urlsHook.result.current.data).toEqual({ "att-a": "https://signed.test/a" });

    const disabledUrlsHook = renderHookWithQueryClient(() => useAttachmentUrls([]));
    await waitFor(() => expect(disabledUrlsHook.result.current.fetchStatus).toBe("idle"));

    const updateHook = renderHookWithQueryClient(() => useUpdateAttachmentOrder());
    const invalidateSpy = vi.spyOn(updateHook.queryClient, "invalidateQueries");
    await act(async () => {
      await updateHook.result.current.mutateAsync({
        attachmentId: "att-a",
        recordId: "record-1",
        newOrder: 4,
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["medical-record", "record-1"],
    });

    createClientMock.mockReturnValue({
      from: vi.fn(() =>
        createQueryBuilder<null>({
          data: null,
          error: { message: "update order failed" },
        }),
      ),
    });
    const errorUpdateHook = renderHookWithQueryClient(() => useUpdateAttachmentOrder());
    await expect(
      errorUpdateHook.result.current.mutateAsync({
        attachmentId: "att-a",
        recordId: "record-1",
        newOrder: 5,
      }),
    ).rejects.toThrow("update order failed");
  });
});
