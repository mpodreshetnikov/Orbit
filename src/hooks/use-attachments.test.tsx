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

  it("handles attachment-url query enablement and error/success branches", async () => {
    const { useAttachmentUrl } = await import("./use-attachments");

    const disabledHook = renderHookWithQueryClient(() => useAttachmentUrl(null));
    await waitFor(() => expect(disabledHook.result.current.fetchStatus).toBe("idle"));
    expect(createClientMock).not.toHaveBeenCalled();

    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: "https://signed.test/file-1" },
      error: null,
    });
    const from = vi.fn(() => ({ createSignedUrl }));
    createClientMock.mockReturnValue({
      storage: { from },
    });
    const successHook = renderHookWithQueryClient(() => useAttachmentUrl("path/a"));
    await waitFor(() => expect(successHook.result.current.isSuccess).toBe(true));
    expect(successHook.result.current.data).toBe("https://signed.test/file-1");
    expect(from).toHaveBeenCalledWith("medical-attachments");
    expect(createSignedUrl).toHaveBeenCalledWith("path/a", 3600);
    expect(createSignedUrl.mock.calls[0][1]).toBe(60 * 60);

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
