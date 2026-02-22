import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";

const { createClientMock, useProcessingQueueStoreMock, toastErrorMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  useProcessingQueueStoreMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

vi.mock("@/stores/processing-queue-store", () => ({
  useProcessingQueueStore: useProcessingQueueStoreMock,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

function renderHookWithQueryClient<T>(hook: () => T) {
  const queryClient = createTestQueryClient();
  const wrapper = createTestQueryWrapper(queryClient);
  return {
    queryClient,
    ...renderHook(hook, { wrapper }),
  };
}

function createSupabaseClientMock(options: {
  sessionToken?: string | null;
  uploadError?: string | null;
  insertError?: string | null;
  updateError?: string | null;
}) {
  const updateEqMock = vi.fn().mockResolvedValue({
    error: options.updateError ? { message: options.updateError } : null,
  });
  const updateMock = vi.fn(() => ({ eq: updateEqMock }));
  const insertMock = vi.fn().mockResolvedValue({
    error: options.insertError ? { message: options.insertError } : null,
  });
  const uploadMock = vi.fn().mockResolvedValue({
    error: options.uploadError ? { message: options.uploadError } : null,
  });

  const fromMock = vi.fn((table: string) => {
    if (table === "record_attachments") {
      return { insert: insertMock };
    }
    if (table === "medical_records") {
      return { update: updateMock };
    }
    return {
      insert: insertMock,
      update: updateMock,
    };
  });

  return {
    client: {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: options.sessionToken ? { access_token: options.sessionToken } : null },
        }),
      },
      storage: {
        from: vi.fn(() => ({ upload: uploadMock })),
      },
      from: fromMock,
    },
    fromMock,
    insertMock,
    updateMock,
    updateEqMock,
    uploadMock,
  };
}

describe("use-background-ocr", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    useProcessingQueueStoreMock.mockReset();
    toastErrorMock.mockReset();
    vi.unstubAllGlobals();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  });

  it("fails retry when user is not authenticated", async () => {
    const addJobMock = vi.fn();
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();

    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        addJob: addJobMock,
        updateJob: updateJobMock,
        addNotification: addNotificationMock,
      }),
    );

    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      },
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        })),
      })),
    });

    const { useBackgroundOCR } = await import("./use-background-ocr");
    const { result } = renderHookWithQueryClient(() => useBackgroundOCR());

    let response:
      | {
          success: boolean;
          error?: string;
        }
      | undefined;
    await act(async () => {
      response = await result.current.retryOcr({
        recordId: "record-1",
        personId: "person-1",
        personName: "Alex",
      });
    });

    expect(addJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "record-1",
        stage: "processing",
      }),
    );
    expect(updateJobMock).toHaveBeenCalledWith(
      "record-1",
      expect.objectContaining({
        stage: "failed",
        error: "Not authenticated",
      }),
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      "processing.failed",
      expect.objectContaining({ description: "Not authenticated" }),
    );
    expect(response).toEqual({ success: false, error: "Not authenticated" });
  });

  it("fails startBackgroundOCR when session is missing and persists ocr_failed status", async () => {
    const addJobMock = vi.fn();
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();

    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        addJob: addJobMock,
        updateJob: updateJobMock,
        addNotification: addNotificationMock,
      }),
    );

    const eqMock = vi.fn().mockResolvedValue({ error: null });
    const updateMock = vi.fn(() => ({ eq: eqMock }));
    const fromMock = vi.fn(() => ({ update: updateMock }));

    createClientMock.mockReturnValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      },
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(),
        })),
      },
      from: fromMock,
    });

    const { useBackgroundOCR } = await import("./use-background-ocr");
    const { result, queryClient } = renderHookWithQueryClient(() => useBackgroundOCR());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const file = new File(["x"], "report.pdf", { type: "application/pdf" });
    let response:
      | {
          success: boolean;
          error?: string;
        }
      | undefined;
    await act(async () => {
      response = await result.current.startBackgroundOCR({
        recordId: "record-1",
        personId: "person-1",
        personName: "Alex",
        files: [file],
      });
    });

    expect(addJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "record-1",
        stage: "uploading",
      }),
    );
    expect(updateJobMock).toHaveBeenCalledWith(
      "record-1",
      expect.objectContaining({
        stage: "failed",
        error: "Not authenticated",
      }),
    );
    expect(addNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "record-1",
        type: "error",
      }),
    );
    expect(fromMock).toHaveBeenCalledWith("medical_records");
    expect(updateMock).toHaveBeenCalledWith({
      status: "ocr_failed",
      ocr_error: "Not authenticated",
    });
    expect(eqMock).toHaveBeenCalledWith("id", "record-1");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["medical-records"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["medical-record", "record-1"] });
    expect(response).toEqual({ success: false, error: "Not authenticated" });
  });

  it("completes startBackgroundOCR successfully and publishes completion notification", async () => {
    const addJobMock = vi.fn();
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        addJob: addJobMock,
        updateJob: updateJobMock,
        addNotification: addNotificationMock,
      }),
    );

    const { client, insertMock, uploadMock, updateMock } = createSupabaseClientMock({
      sessionToken: "token-1",
    });
    createClientMock.mockReturnValue(client);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          ocr_text: "OCR body",
          suggested_title: "  Lab result  ",
        }),
      }),
    );

    const { useBackgroundOCR } = await import("./use-background-ocr");
    const { result, queryClient } = renderHookWithQueryClient(() => useBackgroundOCR());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    let response:
      | {
          success: boolean;
          error?: string;
          ocr_text?: string;
        }
      | undefined;
    await act(async () => {
      response = await result.current.startBackgroundOCR({
        recordId: "record-1",
        personId: "person-1",
        personName: "Alex",
        files: [new File(["a"], "scan.pdf", { type: "application/pdf" })],
      });
    });

    expect(uploadMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith({ status: "ocr_processing" });
    expect(updateJobMock).toHaveBeenCalledWith(
      "record-1",
      expect.objectContaining({
        stage: "completed",
        progress: 100,
        title: "Lab result",
      }),
    );
    expect(addNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        title: "Lab result",
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["medical-records"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["medical-record", "record-1"] });
    expect(response).toEqual({ success: true, ocr_text: "OCR body" });
  });

  it("handles non-ok OCR function response in startBackgroundOCR", async () => {
    const addJobMock = vi.fn();
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        addJob: addJobMock,
        updateJob: updateJobMock,
        addNotification: addNotificationMock,
      }),
    );

    const { client, updateMock } = createSupabaseClientMock({
      sessionToken: "token-1",
    });
    createClientMock.mockReturnValue(client);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: "Bad Request",
        text: async () => JSON.stringify({ error: "ocr crashed" }),
      }),
    );

    const { useBackgroundOCR } = await import("./use-background-ocr");
    const { result } = renderHookWithQueryClient(() => useBackgroundOCR());

    let response:
      | {
          success: boolean;
          error?: string;
        }
      | undefined;
    await act(async () => {
      response = await result.current.startBackgroundOCR({
        recordId: "record-2",
        personId: "person-1",
        personName: "Alex",
        files: [new File(["a"], "scan.pdf", { type: "application/pdf" })],
      });
    });

    expect(updateMock).toHaveBeenCalledWith({
      status: "ocr_failed",
      ocr_error: "ocr crashed",
    });
    expect(updateJobMock).toHaveBeenCalledWith(
      "record-2",
      expect.objectContaining({ stage: "failed", error: "ocr crashed" }),
    );
    expect(addNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", message: "ocr crashed" }),
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      "processing.failed",
      expect.objectContaining({ description: "ocr crashed" }),
    );
    expect(response).toEqual({ success: false, error: "ocr crashed" });
  });

  it("fails retryOcr when Supabase URL is not configured", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";

    const addJobMock = vi.fn();
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        addJob: addJobMock,
        updateJob: updateJobMock,
        addNotification: addNotificationMock,
      }),
    );

    const { client, updateMock } = createSupabaseClientMock({
      sessionToken: "token-1",
    });
    createClientMock.mockReturnValue(client);

    const { useBackgroundOCR } = await import("./use-background-ocr");
    const { result, queryClient } = renderHookWithQueryClient(() => useBackgroundOCR());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    let response:
      | {
          success: boolean;
          error?: string;
        }
      | undefined;
    await act(async () => {
      response = await result.current.retryOcr({
        recordId: "record-3",
        personId: "person-1",
        personName: "Alex",
      });
    });

    expect(updateMock).toHaveBeenCalledWith({
      status: "ocr_failed",
      ocr_error: "Supabase URL not configured",
    });
    expect(updateJobMock).toHaveBeenCalledWith(
      "record-3",
      expect.objectContaining({ stage: "failed", error: "Supabase URL not configured" }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["medical-records"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["medical-record", "record-3"] });
    expect(response).toEqual({ success: false, error: "Supabase URL not configured" });
  });

  it("completes retryOcr and falls back to translated title", async () => {
    const addJobMock = vi.fn();
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        addJob: addJobMock,
        updateJob: updateJobMock,
        addNotification: addNotificationMock,
      }),
    );

    const { client, updateMock } = createSupabaseClientMock({
      sessionToken: "token-1",
    });
    createClientMock.mockReturnValue(client);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          suggested_title: "   ",
          ocr_text: "fresh ocr",
        }),
      }),
    );

    const { useBackgroundOCR } = await import("./use-background-ocr");
    const { result } = renderHookWithQueryClient(() => useBackgroundOCR());

    let response:
      | {
          success: boolean;
          error?: string;
          ocr_text?: string;
        }
      | undefined;
    await act(async () => {
      response = await result.current.retryOcr({
        recordId: "record-4",
        personId: "person-1",
        personName: "Alex",
      });
    });

    expect(updateMock).toHaveBeenCalledWith({
      status: "ocr_processing",
      ocr_error: null,
    });
    expect(updateJobMock).toHaveBeenCalledWith(
      "record-4",
      expect.objectContaining({
        stage: "completed",
        title: "processing.ocrComplete",
      }),
    );
    expect(addNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        title: "processing.ocrComplete",
      }),
    );
    expect(response).toEqual({ success: true, ocr_text: "fresh ocr" });
  });

  it("handles retryOcr timeout errors from fetch abort", async () => {
    const addJobMock = vi.fn();
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        addJob: addJobMock,
        updateJob: updateJobMock,
        addNotification: addNotificationMock,
      }),
    );

    const { client, updateMock } = createSupabaseClientMock({
      sessionToken: "token-1",
    });
    createClientMock.mockReturnValue(client);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        Object.assign(new Error("Aborted"), {
          name: "AbortError",
        }),
      ),
    );

    const { useBackgroundOCR } = await import("./use-background-ocr");
    const { result } = renderHookWithQueryClient(() => useBackgroundOCR());

    let response:
      | {
          success: boolean;
          error?: string;
        }
      | undefined;
    await act(async () => {
      response = await result.current.retryOcr({
        recordId: "record-5",
        personId: "person-1",
        personName: "Alex",
      });
    });

    expect(updateMock).toHaveBeenCalledWith({
      status: "ocr_failed",
      ocr_error: "processing.timeout",
    });
    expect(updateJobMock).toHaveBeenCalledWith(
      "record-5",
      expect.objectContaining({ stage: "failed", error: "processing.timeout" }),
    );
    expect(addNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        title: "processing.timeout",
      }),
    );
    expect(toastErrorMock).toHaveBeenCalledWith(
      "processing.timeout",
      expect.objectContaining({ description: "processing.timeoutDescription" }),
    );
    expect(response).toEqual({ success: false, error: "processing.timeout" });
  });

  it("retries updateRecordToOcrFailed and reports exhausted retries", async () => {
    vi.useFakeTimers();

    const eqMock = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: "e1" } })
      .mockResolvedValueOnce({ error: { message: "e2" } })
      .mockResolvedValueOnce({ error: null });
    const supabase = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: eqMock,
        })),
      })),
    } as unknown;

    const { updateRecordToOcrFailed } = await import("./use-background-ocr");
    const successPromise = updateRecordToOcrFailed(
      supabase as ReturnType<typeof import("@/lib/supabase").createClient>,
      "record-1",
      "boom",
    );
    await vi.runAllTimersAsync();
    await expect(successPromise).resolves.toBe(true);
    expect(eqMock).toHaveBeenCalledTimes(3);

    const failEqMock = vi.fn().mockResolvedValue({ error: { message: "always-fail" } });
    const alwaysFailSupabase = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: failEqMock,
        })),
      })),
    } as unknown;
    const failedPromise = updateRecordToOcrFailed(
      alwaysFailSupabase as ReturnType<typeof import("@/lib/supabase").createClient>,
      "record-2",
      "boom",
    );
    await vi.runAllTimersAsync();
    await expect(failedPromise).resolves.toBe(false);
    expect(failEqMock).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it("fails startBackgroundOCR for upload and attachment insert errors", async () => {
    const addJobMock = vi.fn();
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        addJob: addJobMock,
        updateJob: updateJobMock,
        addNotification: addNotificationMock,
      }),
    );

    const uploadFailure = createSupabaseClientMock({
      sessionToken: "token-1",
      uploadError: "upload failed",
    });
    const insertFailure = createSupabaseClientMock({
      sessionToken: "token-1",
      insertError: "insert failed",
    });

    const { useBackgroundOCR } = await import("./use-background-ocr");
    createClientMock.mockReturnValue(uploadFailure.client);
    const first = renderHookWithQueryClient(() => useBackgroundOCR());

    const uploadResult = await first.result.current.startBackgroundOCR({
      recordId: "record-upload",
      personId: "person-1",
      personName: "Alex",
      files: [new File(["a"], "scan.pdf", { type: "application/pdf" })],
    });

    createClientMock.mockReturnValue(insertFailure.client);
    const second = renderHookWithQueryClient(() => useBackgroundOCR());
    const insertResult = await second.result.current.startBackgroundOCR({
      recordId: "record-insert",
      personId: "person-1",
      personName: "Alex",
      files: [new File(["a"], "scan.pdf", { type: "application/pdf" })],
    });

    expect(uploadResult).toEqual({ success: false, error: "Upload failed: upload failed" });
    expect(insertResult).toEqual({
      success: false,
      error: "Failed to create attachment: insert failed",
    });
    expect(updateJobMock).toHaveBeenCalledWith(
      "record-upload",
      expect.objectContaining({ stage: "failed", error: "Upload failed: upload failed" }),
    );
    expect(updateJobMock).toHaveBeenCalledWith(
      "record-insert",
      expect.objectContaining({
        stage: "failed",
        error: "Failed to create attachment: insert failed",
      }),
    );
  });

  it("handles OCR json success=false and plain-text non-ok errors in startBackgroundOCR", async () => {
    const addJobMock = vi.fn();
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({
        addJob: addJobMock,
        updateJob: updateJobMock,
        addNotification: addNotificationMock,
      }),
    );

    const okButFailed = createSupabaseClientMock({ sessionToken: "token-1" });
    const nonOkPlain = createSupabaseClientMock({ sessionToken: "token-1" });
    createClientMock.mockReturnValueOnce(okButFailed.client).mockReturnValueOnce(nonOkPlain.client);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: false }),
      })
      .mockResolvedValueOnce({
        ok: false,
        statusText: "Bad Request",
        text: async () => "plain failure",
      });
    vi.stubGlobal("fetch", fetchMock);

    const { useBackgroundOCR } = await import("./use-background-ocr");
    const first = renderHookWithQueryClient(() => useBackgroundOCR());
    const second = renderHookWithQueryClient(() => useBackgroundOCR());

    const failedJsonResult = await first.result.current.startBackgroundOCR({
      recordId: "record-json-fail",
      personId: "person-1",
      personName: "Alex",
      files: [new File(["a"], "scan.pdf", { type: "application/pdf" })],
    });
    const plainTextResult = await second.result.current.startBackgroundOCR({
      recordId: "record-plain-fail",
      personId: "person-1",
      personName: "Alex",
      files: [new File(["a"], "scan.pdf", { type: "application/pdf" })],
    });

    expect(failedJsonResult).toEqual({ success: false, error: "OCR processing failed" });
    expect(plainTextResult).toEqual({ success: false, error: "plain failure" });
    expect(updateJobMock).toHaveBeenCalledWith(
      "record-json-fail",
      expect.objectContaining({ stage: "failed", error: "OCR processing failed" }),
    );
    expect(updateJobMock).toHaveBeenCalledWith(
      "record-plain-fail",
      expect.objectContaining({ stage: "failed", error: "plain failure" }),
    );
  });
});
