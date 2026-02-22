import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient, createTestQueryWrapper } from "../../test/utils/web/render";

const { createClientMock, useProcessingQueueStoreMock, toastSuccessMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  useProcessingQueueStoreMock: vi.fn(),
  toastSuccessMock: vi.fn(),
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

function createSupabaseMock(initialProcessingIds: string[] = []) {
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
  const selectMock = vi.fn(() => ({ eq: eqMock }));
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
    getChangeHandler: () => changeHandler,
  };
}

describe("use-processing-monitor", () => {
  beforeEach(() => {
    createClientMock.mockReset();
    useProcessingQueueStoreMock.mockReset();
    toastSuccessMock.mockReset();
  });

  it("does nothing when person id is missing", async () => {
    const updateJobMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({ updateJob: updateJobMock }),
    );

    const { useProcessingMonitor } = await import("./use-processing-monitor");
    renderHookWithQueryClient(() => useProcessingMonitor(null));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createClientMock).not.toHaveBeenCalled();
    expect(updateJobMock).not.toHaveBeenCalled();
  });

  it("marks OCR job complete on realtime status transition and unsubscribes on unmount", async () => {
    const updateJobMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({ updateJob: updateJobMock }),
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

  it("handles structure completion, processing starts, inserts/deletes, and subscription errors", async () => {
    const updateJobMock = vi.fn();
    useProcessingQueueStoreMock.mockImplementation((selector: (state: unknown) => unknown) =>
      selector({ updateJob: updateJobMock }),
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
