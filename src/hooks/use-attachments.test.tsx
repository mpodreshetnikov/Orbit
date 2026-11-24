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

function mockSignedUrls(prefix = "") {
  const createSignedUrl = vi.fn(async (path: string) => ({
    data: { signedUrl: `https://signed.test/${prefix}${path}` },
    error: null,
  }));
  createClientMock.mockReturnValue({ storage: { from: () => ({ createSignedUrl }) } });
  return createSignedUrl;
}

function cachedUrlOptions(ageMinutes: number) {
  return { updatedAt: Date.now() - ageMinutes * 60_000 };
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
    expect(disabledUrlsHook.result.current).toMatchObject({
      status: "pending",
      fetchStatus: "idle",
    });

    const orderUpdate = createQueryBuilder<null>({ data: null, error: null });
    createClientMock.mockReturnValue({ from: vi.fn(() => orderUpdate) });
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
    expect(orderUpdate.update).toHaveBeenCalledExactlyOnceWith({ sort_order: 4 });
    expect(orderUpdate.eq).toHaveBeenCalledExactlyOnceWith("id", "att-a");

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

  it("shares a fresh batch across attachment reorderings and isolates different batches", async () => {
    const { useAttachmentUrls } = await import("./use-attachments");
    const a = makeAttachment({ id: "att-a", storage_path: "a.png" });
    const b = makeAttachment({ id: "att-b", storage_path: "b.png" });
    const c = makeAttachment({ id: "att-c", storage_path: "c.png" });
    const createSignedUrl = mockSignedUrls();
    const wrapper = createTestQueryWrapper(createTestQueryClient());
    const { result, rerender } = renderHook(({ files }) => useAttachmentUrls(files), {
      initialProps: { files: [b, a] },
      wrapper,
    });
    const firstBatch = {
      "att-a": "https://signed.test/a.png",
      "att-b": "https://signed.test/b.png",
    };
    await waitFor(() => expect(result.current.data).toEqual(firstBatch));

    rerender({ files: [a, b] });
    expect(result.current.data).toEqual(firstBatch);
    expect(result.current.fetchStatus).toBe("idle");
    expect(createSignedUrl).toHaveBeenCalledTimes(2);

    rerender({ files: [a, c] });
    await waitFor(() =>
      expect(result.current.data).toEqual({
        "att-a": "https://signed.test/a.png",
        "att-c": "https://signed.test/c.png",
      }),
    );
  });

  it("uses cached URLs for each attachment and refreshes them before they expire", async () => {
    const { useAttachmentUrl } = await import("./use-attachments");
    const createSignedUrl = mockSignedUrls("fresh/");
    const client = createTestQueryClient();
    client.setQueryData(
      ["attachment-url", "a.png"],
      "https://signed.test/cached/a.png",
      cachedUrlOptions(49),
    );
    client.setQueryData(
      ["attachment-url", "b.png"],
      "https://signed.test/cached/b.png",
      cachedUrlOptions(51),
    );
    const { result, rerender } = renderHook(({ path }) => useAttachmentUrl(path), {
      initialProps: { path: "a.png" },
      wrapper: createTestQueryWrapper(client),
    });

    expect(result.current.data).toBe("https://signed.test/cached/a.png");
    expect(result.current.fetchStatus).toBe("idle");

    rerender({ path: "b.png" });
    await waitFor(() => expect(result.current.data).toBe("https://signed.test/fresh/b.png"));
    expect(createSignedUrl).toHaveBeenCalledExactlyOnceWith("b.png", 3600);
  });

  it("refreshes a cached batch after the 50-minute reuse period", async () => {
    const { useAttachmentUrls } = await import("./use-attachments");
    const first = makeAttachment({ id: "att-a", storage_path: "a.png" });
    const second = makeAttachment({ id: "att-b", storage_path: "b.png" });
    const createSignedUrl = mockSignedUrls("fresh/");
    const client = createTestQueryClient();
    client.setQueryData(
      ["attachment-urls", ["att-a"]],
      { "att-a": "https://signed.test/cached/a.png" },
      cachedUrlOptions(49),
    );
    client.setQueryData(
      ["attachment-urls", ["att-b"]],
      { "att-b": "https://signed.test/cached/b.png" },
      cachedUrlOptions(51),
    );
    const { result, rerender } = renderHook(({ files }) => useAttachmentUrls(files), {
      initialProps: { files: [first] },
      wrapper: createTestQueryWrapper(client),
    });

    expect(result.current.data).toEqual({ "att-a": "https://signed.test/cached/a.png" });
    expect(result.current.fetchStatus).toBe("idle");

    rerender({ files: [second] });
    await waitFor(() =>
      expect(result.current.data).toEqual({ "att-b": "https://signed.test/fresh/b.png" }),
    );
    expect(createSignedUrl).toHaveBeenCalledExactlyOnceWith("b.png", 3600);
  });
});
