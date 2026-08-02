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

function prefsRow(hidden: Record<string, string[]>) {
  return {
    auth_user_id: "user-1",
    checkup_notification_time: "09:00:00",
    checkup_notification_timezone: null,
    overdue_reminder_interval_minutes: 30,
    hidden_measurement_codes: hidden,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };
}

/**
 * Stateful fake: an upsert updates the row that later reads return, so a
 * refetch after a mutation sees what was actually written. A static fake would
 * always replay the original row and make the optimistic path untestable.
 */
function createSupabaseClient(hidden: Record<string, string[]>) {
  const result = { data: prefsRow(hidden), error: null };
  const builder = createQueryBuilder(result) as ReturnType<typeof createQueryBuilder> & {
    upsert?: ReturnType<typeof vi.fn>;
  };
  builder.upsert = vi.fn((payload: Record<string, unknown>) => {
    if (payload.hidden_measurement_codes !== undefined) {
      result.data = {
        ...result.data,
        hidden_measurement_codes: payload.hidden_measurement_codes as Record<string, string[]>,
      };
    }
    return builder;
  });
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }),
    },
    from: vi.fn(() => builder),
    __builder: builder,
  };
}

describe("use-hidden-measurements", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("exposes only the selected person's hidden codes", async () => {
    createClientMock.mockReturnValue(
      createSupabaseClient({ "person-1": ["height"], "person-2": ["bmi"] }),
    );

    const { useHiddenMeasurements } = await import("./use-hidden-measurements");
    const { result } = renderHookWithQueryClient(() => useHiddenMeasurements("person-1"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect([...result.current.hiddenCodes]).toEqual(["height"]);
  });

  it("returns an empty set when no person is selected", async () => {
    createClientMock.mockReturnValue(createSupabaseClient({ "person-1": ["height"] }));

    const { useHiddenMeasurements } = await import("./use-hidden-measurements");
    const { result } = renderHookWithQueryClient(() => useHiddenMeasurements(null));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hiddenCodes.size).toBe(0);
  });

  it("hides a code by upserting the merged map", async () => {
    const supabase = createSupabaseClient({ "person-2": ["bmi"] });
    createClientMock.mockReturnValue(supabase);

    const { useHiddenMeasurements } = await import("./use-hidden-measurements");
    const { result } = renderHookWithQueryClient(() => useHiddenMeasurements("person-1"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      result.current.toggleHidden("height");
    });

    await waitFor(() =>
      expect(supabase.__builder.upsert).toHaveBeenCalledWith(
        {
          auth_user_id: "user-1",
          // Other people are preserved.
          hidden_measurement_codes: { "person-2": ["bmi"], "person-1": ["height"] },
        },
        { onConflict: "auth_user_id" },
      ),
    );
  });

  it("unhides a code that was already hidden", async () => {
    const supabase = createSupabaseClient({ "person-1": ["height"] });
    createClientMock.mockReturnValue(supabase);

    const { useHiddenMeasurements } = await import("./use-hidden-measurements");
    const { result } = renderHookWithQueryClient(() => useHiddenMeasurements("person-1"));

    await waitFor(() => expect(result.current.hiddenCodes.size).toBe(1));
    await act(async () => {
      result.current.toggleHidden("height");
    });

    await waitFor(() =>
      expect(supabase.__builder.upsert).toHaveBeenCalledWith(
        { auth_user_id: "user-1", hidden_measurement_codes: {} },
        { onConflict: "auth_user_id" },
      ),
    );
  });

  it("applies the toggle optimistically so rapid toggles do not clobber", async () => {
    // The whole blob is read-modify-written. Without the optimistic cache write
    // in onMutate, a second toggle fired before the first settles would read
    // pre-toggle state and drop the earlier change.
    const supabase = createSupabaseClient({});
    createClientMock.mockReturnValue(supabase);

    const { useHiddenMeasurements } = await import("./use-hidden-measurements");
    const { result } = renderHookWithQueryClient(() => useHiddenMeasurements("person-1"));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.toggleHidden("height");
    });
    await waitFor(() => expect([...result.current.hiddenCodes]).toEqual(["height"]));

    await act(async () => {
      result.current.toggleHidden("bmi");
    });

    await waitFor(() =>
      expect(supabase.__builder.upsert).toHaveBeenLastCalledWith(
        { auth_user_id: "user-1", hidden_measurement_codes: { "person-1": ["height", "bmi"] } },
        { onConflict: "auth_user_id" },
      ),
    );
  });

  it("ignores a toggle when no person is selected", async () => {
    const supabase = createSupabaseClient({});
    createClientMock.mockReturnValue(supabase);

    const { useHiddenMeasurements } = await import("./use-hidden-measurements");
    const { result } = renderHookWithQueryClient(() => useHiddenMeasurements(null));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      result.current.toggleHidden("height");
    });

    expect(supabase.__builder.upsert).not.toHaveBeenCalled();
  });
});
