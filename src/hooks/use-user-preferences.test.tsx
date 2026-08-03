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

function createSupabaseClient({
  userId = "user-1",
  prefsData = null,
  prefsError = null,
}: {
  userId?: string | null;
  prefsData?: Record<string, unknown> | null;
  prefsError?: { message: string } | null;
}) {
  const builder = createQueryBuilder({
    data: prefsData,
    error: prefsError,
  }) as ReturnType<typeof createQueryBuilder> & {
    upsert?: ReturnType<typeof vi.fn>;
  };
  builder.upsert = vi.fn(() => builder);
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: userId ? { id: userId } : null } }),
    },
    from: vi.fn(() => builder),
  };
}

describe("use-user-preferences", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  it("returns null when user is unauthenticated", async () => {
    const supabase = createSupabaseClient({ userId: null });
    createClientMock.mockReturnValue(supabase);

    const { useUserPreferences } = await import("./use-user-preferences");
    const { result } = renderHookWithQueryClient(() => useUserPreferences());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("returns mapped user preferences", async () => {
    const row = {
      auth_user_id: "user-1",
      checkup_notification_time: "09:00:00",
      checkup_notification_timezone: "Europe/Moscow",
      overdue_reminder_interval_minutes: 60,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    };
    const supabase = createSupabaseClient({ prefsData: row });
    createClientMock.mockReturnValue(supabase);

    const { useUserPreferences } = await import("./use-user-preferences");
    const { result } = renderHookWithQueryClient(() => useUserPreferences());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ ...row, hidden_measurement_codes: {} });
  });

  it("normalizes hidden measurement codes from the jsonb column", async () => {
    const supabase = createSupabaseClient({
      prefsData: {
        auth_user_id: "user-1",
        checkup_notification_time: "09:00:00",
        checkup_notification_timezone: null,
        overdue_reminder_interval_minutes: 30,
        // Deliberately malformed: a hand-edited row must not break the page.
        hidden_measurement_codes: { "person-1": ["height", 7], "person-2": "bmi" },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    });
    createClientMock.mockReturnValue(supabase);

    const { useUserPreferences } = await import("./use-user-preferences");
    const { result } = renderHookWithQueryClient(() => useUserPreferences());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.hidden_measurement_codes).toEqual({ "person-1": ["height"] });
  });

  it("returns query error from preferences fetch", async () => {
    const supabase = createSupabaseClient({
      prefsData: null,
      prefsError: { message: "preferences failed" },
    });
    createClientMock.mockReturnValue(supabase);

    const { useUserPreferences } = await import("./use-user-preferences");
    const { result } = renderHookWithQueryClient(() => useUserPreferences());

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toContain("preferences failed");
  });

  it("updates preferences and invalidates cache", async () => {
    const row = {
      auth_user_id: "user-1",
      checkup_notification_time: "08:30:00",
      checkup_notification_timezone: "UTC",
      overdue_reminder_interval_minutes: 15,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    };
    const supabase = createSupabaseClient({ prefsData: row });
    createClientMock.mockReturnValue(supabase);

    const { useUpdateUserPreferences } = await import("./use-user-preferences");
    const { result, queryClient } = renderHookWithQueryClient(() => useUpdateUserPreferences());
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await result.current.mutateAsync({
        checkup_notification_time: "08:30:00",
        overdue_reminder_interval_minutes: 15,
      });
    });

    const builder = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value as ReturnType<
      typeof createQueryBuilder
    >;
    expect(builder.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        auth_user_id: "user-1",
        checkup_notification_time: "08:30:00",
        overdue_reminder_interval_minutes: 15,
      }),
      { onConflict: "auth_user_id" },
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["user-preferences"],
    });
  });

  it("leaves hidden measurement codes alone when saving other preferences", async () => {
    // The payload is built field-by-field, so a settings-page save must not
    // clobber the hidden list written by the measurements page.
    const supabase = createSupabaseClient({
      prefsData: {
        auth_user_id: "user-1",
        checkup_notification_time: "08:30:00",
        checkup_notification_timezone: "UTC",
        overdue_reminder_interval_minutes: 15,
        hidden_measurement_codes: { "person-1": ["height"] },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    });
    createClientMock.mockReturnValue(supabase);

    const { useUpdateUserPreferences } = await import("./use-user-preferences");
    const { result } = renderHookWithQueryClient(() => useUpdateUserPreferences());

    await act(async () => {
      await result.current.mutateAsync({ checkup_notification_time: "08:30:00" });
    });

    const builder = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value as ReturnType<
      typeof createQueryBuilder
    >;
    expect(builder.upsert).toHaveBeenCalledWith(
      { auth_user_id: "user-1", checkup_notification_time: "08:30:00" },
      { onConflict: "auth_user_id" },
    );
  });

  it("writes hidden measurement codes when they are supplied", async () => {
    const supabase = createSupabaseClient({
      prefsData: {
        auth_user_id: "user-1",
        checkup_notification_time: "09:00:00",
        checkup_notification_timezone: null,
        overdue_reminder_interval_minutes: 30,
        hidden_measurement_codes: { "person-1": ["height"] },
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    });
    createClientMock.mockReturnValue(supabase);

    const { useUpdateUserPreferences } = await import("./use-user-preferences");
    const { result } = renderHookWithQueryClient(() => useUpdateUserPreferences());

    await act(async () => {
      await result.current.mutateAsync({
        hidden_measurement_codes: { "person-1": ["height"] },
      });
    });

    const builder = (supabase.from as ReturnType<typeof vi.fn>).mock.results[0].value as ReturnType<
      typeof createQueryBuilder
    >;
    expect(builder.upsert).toHaveBeenCalledWith(
      { auth_user_id: "user-1", hidden_measurement_codes: { "person-1": ["height"] } },
      { onConflict: "auth_user_id" },
    );
  });

  it("throws on update when user is unauthenticated", async () => {
    const supabase = createSupabaseClient({ userId: null });
    createClientMock.mockReturnValue(supabase);

    const { useUpdateUserPreferences } = await import("./use-user-preferences");
    const { result } = renderHookWithQueryClient(() => useUpdateUserPreferences());

    await expect(
      result.current.mutateAsync({
        checkup_notification_time: "08:30:00",
      }),
    ).rejects.toThrow("Not authenticated");
  });
});
