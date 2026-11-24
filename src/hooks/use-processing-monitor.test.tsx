import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProcessingQueueStore } from "@/stores/processing-queue-store";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";

const { createClientMock, toastSuccessMock, toastErrorMock, toastWarningMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastWarningMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: createClientMock,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: toastWarningMock,
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

function createSupabaseMock(
  initialProcessingIds: string[] = [],
  reconcileRows: Array<Record<string, unknown>> = [],
) {
  let changeHandler:
    | ((payload: {
        eventType: string;
        new: Record<string, unknown> | null;
        old: Record<string, unknown> | null;
      }) => void)
    | null = null;

  const initialProcessingRows = Promise.resolve({
    data: initialProcessingIds.map((id) => ({
      id,
      title: "Record",
      status: "ocr_processing",
      person_id: "person-1",
    })),
  });
  const eqMock = vi.fn(() => ({ in: () => initialProcessingRows }));
  // The reconcile query has no .eq(): it asks about the queue's own jobs, whoever they belong to.
  const reconcileInMock = vi.fn().mockResolvedValue({ data: reconcileRows, error: null });
  const selectMock = vi.fn(() => ({ eq: eqMock, in: reconcileInMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));

  const channel = {
    on: vi.fn((_event: string, _filter: Record<string, string>, cb: typeof changeHandler) => {
      changeHandler = cb;
      return channel;
    }),
    subscribe: vi.fn((cb?: (status: string, err?: Error) => void) => {
      cb?.("SUBSCRIBED");
      return channel;
    }),
  };

  const supabase = {
    from: fromMock,
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
  };

  return {
    supabase,
    initialProcessingRows,
    reconcileInMock,
    getChangeHandler: () => changeHandler,
  };
}

function addProcessingJob(recordId: string, person = { id: "person-1", name: "Alex" }) {
  useProcessingQueueStore.getState().addJob({
    id: recordId,
    recordId,
    personId: person.id,
    personName: person.name,
    stage: "processing",
    progress: 50,
  });
}

describe("use-processing-monitor", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    useProcessingQueueStore.setState({ jobs: {}, notifications: [] });
    toastWarningMock.mockReset();
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("does nothing when person id is missing", async () => {
    addProcessingJob("record-1");
    const { supabase } = createSupabaseMock(
      [],
      [{ id: "record-1", title: "Finished scan", status: "ocr_review" }],
    );
    createClientMock.mockReturnValue(supabase);

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    await act(async () => {
      renderHookWithQueryClient(() => useProcessingMonitor(null));
    });
    expect(createClientMock).not.toHaveBeenCalled();
    expect(useProcessingQueueStore.getState().getActiveJobs()).toEqual([
      expect.objectContaining({ id: "record-1", stage: "processing", progress: 50 }),
    ]);
    expect(useProcessingQueueStore.getState().notifications).toEqual([]);
  });

  it("marks OCR job complete on realtime status transition and unsubscribes on unmount", async () => {
    addProcessingJob("record-1");
    const { supabase, getChangeHandler } = createSupabaseMock(["record-1"]);
    createClientMock.mockReturnValue(supabase);

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    const { queryClient, unmount } = renderHookWithQueryClient(() =>
      useProcessingMonitor("person-1"),
    );
    const listKey = ["medical-records", "person-1"];
    const detailKey = ["medical-record", "record-1"];
    const otherDetailKey = ["medical-record", "record-2"];
    queryClient.setQueryData(listKey, [{ id: "record-1", status: "ocr_processing" }]);
    queryClient.setQueryData(detailKey, { id: "record-1", status: "ocr_processing" });
    queryClient.setQueryData(otherDetailKey, { id: "record-2", status: "ocr_processing" });

    const handler = getChangeHandler();
    expect(handler).toBeTypeOf("function");

    act(() => {
      handler?.({
        eventType: "UPDATE",
        old: {
          id: "record-1",
          title: "Old title",
          status: "ocr_processing",
          person_id: "person-1",
        },
        new: {
          id: "record-1",
          title: "New title",
          status: "ocr_review",
          person_id: "person-1",
        },
      });
    });

    expect(useProcessingQueueStore.getState().getJobByRecordId("record-1")).toEqual(
      expect.objectContaining({ stage: "completed", progress: 100, title: "New title" }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "processing.ocrComplete",
      expect.objectContaining({
        description: "New title",
      }),
    );
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherDetailKey)?.isInvalidated).toBe(false);

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  // Nothing is holding a response that could report a failure any more: the client stopped
  // waiting on the pipeline's call. A record that lands in ocr_failed has to close its job here,
  // or the queue shows a spinner that never resolves.
  it("fails the job when the record reports an OCR failure", async () => {
    addProcessingJob("record-1");
    const { supabase, getChangeHandler, initialProcessingRows } = createSupabaseMock(["record-1"]);
    createClientMock.mockReturnValue(supabase);

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    renderHookWithQueryClient(() => useProcessingMonitor("person-1"));

    await initialProcessingRows;
    const handler = getChangeHandler();

    act(() => {
      handler?.({
        eventType: "UPDATE",
        old: {
          id: "record-1",
          title: "Scan",
          status: "ocr_processing",
          person_id: "person-1",
        },
        new: {
          id: "record-1",
          title: "Scan",
          status: "ocr_failed",
          person_id: "person-1",
          ocr_error: "Failed to extract text from any attachment",
        },
      });
    });

    expect(useProcessingQueueStore.getState().getJobByRecordId("record-1")).toEqual(
      expect.objectContaining({
        stage: "failed",
        error: "Failed to extract text from any attachment",
      }),
    );
    expect(useProcessingQueueStore.getState().notifications).toEqual([
      expect.objectContaining({
        recordId: "record-1",
        type: "error",
        personName: "Alex",
        message: "Failed to extract text from any attachment",
      }),
    ]);
    expect(toastErrorMock).toHaveBeenCalled();
  });

  it("announces a transcription that lost a page as partial, not complete", async () => {
    addProcessingJob("record-1");
    const { supabase, getChangeHandler } = createSupabaseMock(["record-1"]);
    createClientMock.mockReturnValue(supabase);

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    renderHookWithQueryClient(() => useProcessingMonitor("person-1"));

    const handler = getChangeHandler();

    act(() => {
      handler?.({
        eventType: "UPDATE",
        old: { id: "record-1", title: "Scan", status: "ocr_processing", person_id: "person-1" },
        new: {
          id: "record-1",
          title: "Scan",
          status: "ocr_review",
          person_id: "person-1",
          ocr_error:
            "ocr_cause:provider_unavailable the transcription service was unavailable: " +
            "1 of 3 pages failed",
        },
      });
    });

    // "OCR complete" for a document that came back missing a page is the same defect one level
    // up from the column this work is about.
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastWarningMock).toHaveBeenCalledWith(
      "processing.ocrPartial",
      expect.objectContaining({
        description: "processing.ocrCause.provider_unavailable",
      }),
    );
    expect(useProcessingQueueStore.getState().getJobByRecordId("record-1")).toEqual(
      expect.objectContaining({ stage: "completed", progress: 100 }),
    );
    expect(useProcessingQueueStore.getState().notifications).toEqual([
      expect.objectContaining({
        recordId: "record-1",
        message: "processing.ocrCause.provider_unavailable",
      }),
    ]);
  });

  // A structuring failure has no failed status of its own: the record goes back to ocr_review,
  // which is also what a successful OCR looks like. Only the previous status tells them apart.
  it("fails the job when structuring returns the record to review", async () => {
    addProcessingJob("record-2");
    const { supabase, getChangeHandler, initialProcessingRows } = createSupabaseMock(["record-2"]);
    createClientMock.mockReturnValue(supabase);

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    renderHookWithQueryClient(() => useProcessingMonitor("person-1"));

    await initialProcessingRows;
    const handler = getChangeHandler();

    act(() => {
      handler?.({
        eventType: "UPDATE",
        old: {
          id: "record-2",
          title: "Panel",
          status: "structuring",
          person_id: "person-1",
        },
        new: {
          id: "record-2",
          title: "Panel",
          status: "ocr_review",
          person_id: "person-1",
          structure_error: "Model returned invalid JSON",
        },
      });
    });

    expect(useProcessingQueueStore.getState().getJobByRecordId("record-2")).toEqual(
      expect.objectContaining({ stage: "failed", error: "Model returned invalid JSON" }),
    );
  });

  // A client whose connection dropped can mark a record failed while the run that owns it is
  // still transcribing. When that run finishes, the recovery has to reach the job.
  it("treats a recovery from ocr_failed as a completion", async () => {
    addProcessingJob("record-1");
    const { supabase, getChangeHandler } = createSupabaseMock(["record-1"]);
    createClientMock.mockReturnValue(supabase);

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    renderHookWithQueryClient(() => useProcessingMonitor("person-1"));

    act(() => {
      getChangeHandler()?.({
        eventType: "UPDATE",
        old: { id: "record-1", title: "Scan", status: "ocr_failed", person_id: "person-1" },
        new: { id: "record-1", title: "Scan", status: "ocr_review", person_id: "person-1" },
      });
    });

    expect(useProcessingQueueStore.getState().getJobByRecordId("record-1")).toEqual(
      expect.objectContaining({ stage: "completed", progress: 100, title: "Scan" }),
    );
  });

  // The channel is filtered to the selected person, so a job for anyone else is invisible to it.
  it("closes out a job for a person this channel does not watch", async () => {
    addProcessingJob("record-9", { id: "person-2", name: "Sam" });
    addProcessingJob("record-1");

    const { supabase, reconcileInMock } = createSupabaseMock(
      [],
      [{ id: "record-9", title: "Other person's scan", status: "ocr_review", ocr_error: null }],
    );
    createClientMock.mockReturnValue(supabase);

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    renderHookWithQueryClient(() => useProcessingMonitor("person-1"));

    await waitFor(() =>
      expect(useProcessingQueueStore.getState().getJobByRecordId("record-9")).toEqual(
        expect.objectContaining({
          stage: "completed",
          progress: 100,
          title: "Other person's scan",
        }),
      ),
    );
    expect(reconcileInMock).toHaveBeenCalledWith("id", ["record-9"]);
    expect(useProcessingQueueStore.getState().getActiveJobs()).toEqual([
      expect.objectContaining({ id: "record-1", stage: "processing", progress: 50 }),
    ]);
  });

  it("handles structure completion, processing starts, inserts/deletes, and subscription errors", async () => {
    addProcessingJob("record-2");
    addProcessingJob("record-3");
    const { supabase, getChangeHandler } = createSupabaseMock();
    const subscriptionError = new Error("subscription failed");
    vi.mocked(supabase.channel).mockImplementation(() => {
      const channel = {
        on: vi.fn(
          (_event: string, _filter: Record<string, string>, cb: typeof getChangeHandler) => {
            (supabase as unknown as { __handler?: typeof getChangeHandler }).__handler = cb;
            return channel;
          },
        ),
        subscribe: vi.fn((cb?: (status: string, err?: Error) => void) => {
          cb?.("CHANNEL_ERROR", subscriptionError);
          return channel;
        }),
      };
      return channel;
    });
    createClientMock.mockReturnValue(supabase);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { useProcessingMonitor } = await import("./use-processing-monitor");
    const { queryClient, unmount } = renderHookWithQueryClient(() =>
      useProcessingMonitor("person-1"),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    expect(supabase.channel).toHaveBeenCalled();
    const handler =
      (supabase as unknown as { __handler?: ReturnType<typeof getChangeHandler> }).__handler ??
      getChangeHandler();
    expect(handler).toBeTypeOf("function");

    act(() => {
      handler?.({
        eventType: "UPDATE",
        old: {
          id: "record-2",
          title: "Old structuring",
          status: "structuring",
          person_id: "person-1",
        },
        new: {
          id: "record-2",
          title: "Structured title",
          status: "structure_review",
          person_id: "person-1",
        },
      });
      handler?.({
        eventType: "UPDATE",
        old: {
          id: "record-3",
          title: "Old processing",
          status: "draft",
          person_id: "person-1",
        },
        new: {
          id: "record-3",
          title: "Processing title",
          status: "processing",
          person_id: "person-1",
        },
      });
      handler?.({
        eventType: "UPDATE",
        old: {
          id: "record-3",
          title: "Processing title",
          status: "processing",
          person_id: "person-1",
        },
        new: {
          id: "record-3",
          title: "Renamed while processing",
          status: "processing",
          person_id: "person-1",
        },
      });
      handler?.({
        eventType: "INSERT",
        old: null,
        new: {
          id: "record-4",
          title: "Inserted processing",
          status: "processing",
          person_id: "person-1",
        },
      });
      handler?.({
        eventType: "DELETE",
        old: {
          id: "record-4",
          title: "Inserted processing",
          status: "processing",
          person_id: "person-1",
        },
        new: null,
      });
    });

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "processing.completed",
        expect.objectContaining({
          description: "Structured title",
        }),
      );
      expect(useProcessingQueueStore.getState().getJobByRecordId("record-3")).toEqual(
        expect.objectContaining({ stage: "processing", title: "Renamed while processing" }),
      );
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["medical-records"],
    });
    expect(errorSpy).toHaveBeenCalledWith("[Realtime] Subscription error:", subscriptionError);

    unmount();
    errorSpy.mockRestore();
  });
});
