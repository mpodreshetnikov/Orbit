import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";

const { createClientMock, useProcessingQueueStoreMock, toastSuccessMock, toastErrorMock } =
  vi.hoisted(() => ({
    createClientMock: vi.fn(),
    useProcessingQueueStoreMock: Object.assign(vi.fn(), { getState: vi.fn() }),
    toastSuccessMock: vi.fn(),
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
    success: toastSuccessMock,
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

  const inMock = vi.fn().mockResolvedValue({
    data: initialProcessingIds.map((id) => ({
      id,
      title: "Record",
      status: "ocr_processing",
      person_id: "person-1",
    })),
  });
  const eqMock = vi.fn(() => ({ in: inMock }));
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
    inMock,
    reconcileInMock,
    getChangeHandler: () => changeHandler,
  };
}

describe("use-processing-monitor", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    useProcessingQueueStoreMock.mockReset();
    useProcessingQueueStoreMock.getState.mockReset();
    useProcessingQueueStoreMock.getState.mockReturnValue({
      getJobByRecordId: () => ({ personName: "Alex" }),
      getActiveJobs: () => [],
      updateJob: () => {},
    });
    toastSuccessMock.mockReset();
    toastErrorMock.mockReset();
  });

  it("does nothing when person id is missing", async () => {
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({ updateJob: updateJobMock, addNotification: addNotificationMock }),
    );

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    renderHookWithQueryClient(() => useProcessingMonitor(null));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createClientMock).not.toHaveBeenCalled();
    expect(updateJobMock).not.toHaveBeenCalled();
  });

  it("marks OCR job complete on realtime status transition and unsubscribes on unmount", async () => {
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({ updateJob: updateJobMock, addNotification: addNotificationMock }),
    );

    const { supabase, getChangeHandler } = createSupabaseMock(["record-1"]);
    createClientMock.mockReturnValue(supabase);

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    const { queryClient, unmount } = renderHookWithQueryClient(() =>
      useProcessingMonitor("person-1"),
    );
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await waitFor(() => expect(supabase.channel).toHaveBeenCalled());
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

    await waitFor(() =>
      expect(updateJobMock).toHaveBeenCalledWith(
        "record-1",
        expect.objectContaining({
          stage: "completed",
          progress: 100,
          title: "New title",
        }),
      ),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith(
      "processing.ocrComplete",
      expect.objectContaining({
        description: "New title",
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["medical-records"],
    });

    unmount();
    expect(supabase.removeChannel).toHaveBeenCalled();
  });

  // Nothing is holding a response that could report a failure any more: the client stopped
  // waiting on the pipeline's call. A record that lands in ocr_failed has to close its job here,
  // or the queue shows a spinner that never resolves.
  it("fails the job when the record reports an OCR failure", async () => {
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({ updateJob: updateJobMock, addNotification: addNotificationMock }),
    );

    const { supabase, getChangeHandler } = createSupabaseMock(["record-1"]);
    createClientMock.mockReturnValue(supabase);

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    renderHookWithQueryClient(() => useProcessingMonitor("person-1"));

    await waitFor(() => expect(supabase.channel).toHaveBeenCalled());
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

    await waitFor(() =>
      expect(updateJobMock).toHaveBeenCalledWith("record-1", {
        stage: "failed",
        error: "Failed to extract text from any attachment",
      }),
    );
    expect(addNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "error",
        personName: "Alex",
        message: "Failed to extract text from any attachment",
      }),
    );
    expect(toastErrorMock).toHaveBeenCalled();
  });

  // A structuring failure has no failed status of its own: the record goes back to ocr_review,
  // which is also what a successful OCR looks like. Only the previous status tells them apart.
  it("fails the job when structuring returns the record to review", async () => {
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({ updateJob: updateJobMock, addNotification: addNotificationMock }),
    );

    const { supabase, getChangeHandler } = createSupabaseMock(["record-2"]);
    createClientMock.mockReturnValue(supabase);

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    renderHookWithQueryClient(() => useProcessingMonitor("person-1"));

    await waitFor(() => expect(supabase.channel).toHaveBeenCalled());
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

    await waitFor(() =>
      expect(updateJobMock).toHaveBeenCalledWith("record-2", {
        stage: "failed",
        error: "Model returned invalid JSON",
      }),
    );
  });

  // A client whose connection dropped can mark a record failed while the run that owns it is
  // still transcribing. When that run finishes, the recovery has to reach the job.
  it("treats a recovery from ocr_failed as a completion", async () => {
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({ updateJob: updateJobMock, addNotification: addNotificationMock }),
    );

    const { supabase, getChangeHandler } = createSupabaseMock(["record-1"]);
    createClientMock.mockReturnValue(supabase);

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    renderHookWithQueryClient(() => useProcessingMonitor("person-1"));

    await waitFor(() => expect(supabase.channel).toHaveBeenCalled());
    act(() => {
      getChangeHandler()?.({
        eventType: "UPDATE",
        old: { id: "record-1", title: "Scan", status: "ocr_failed", person_id: "person-1" },
        new: { id: "record-1", title: "Scan", status: "ocr_review", person_id: "person-1" },
      });
    });

    await waitFor(() =>
      expect(updateJobMock).toHaveBeenCalledWith(
        "record-1",
        expect.objectContaining({ stage: "completed", progress: 100 }),
      ),
    );
  });

  // The channel is filtered to the selected person, so a job for anyone else is invisible to it.
  it("closes out a job for a person this channel does not watch", async () => {
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    const getActiveJobs = vi.fn(() => [
      {
        id: "record-9",
        recordId: "record-9",
        personId: "person-2",
        personName: "Sam",
        stage: "processing",
        progress: 50,
      },
    ]);
    const storeState = {
      updateJob: updateJobMock,
      addNotification: addNotificationMock,
      getActiveJobs,
      getJobByRecordId: () => undefined,
    };
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector(storeState),
    );
    useProcessingQueueStoreMock.getState.mockReturnValue(storeState);

    const { supabase, reconcileInMock } = createSupabaseMock(
      [],
      [{ id: "record-9", title: "Other person's scan", status: "ocr_review", ocr_error: null }],
    );
    createClientMock.mockReturnValue(supabase);

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    renderHookWithQueryClient(() => useProcessingMonitor("person-1"));

    await waitFor(() => expect(reconcileInMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(updateJobMock).toHaveBeenCalledWith(
        "record-9",
        expect.objectContaining({ stage: "completed", title: "Other person's scan" }),
      ),
    );
  });

  it("handles structure completion, processing starts, inserts/deletes, and subscription errors", async () => {
    const updateJobMock = vi.fn();
    const addNotificationMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({ updateJob: updateJobMock, addNotification: addNotificationMock }),
    );

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

    await waitFor(() => expect(supabase.channel).toHaveBeenCalled());
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
      expect(updateJobMock).toHaveBeenCalledWith("record-3", { title: "Renamed while processing" });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["medical-records"],
    });
    expect(errorSpy).toHaveBeenCalledWith("[Realtime] Subscription error:", subscriptionError);

    unmount();
    errorSpy.mockRestore();
  });
});
