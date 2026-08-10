import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { regenerateDoseEvents } from "./regenerate-dose-events";

/**
 * These pin the two behaviours that make this function safe to share between
 * the API route and the MCP tools: the timezone precedence chain, and the
 * deliberate asymmetry between a failed clear (tolerated) and a failed
 * generate (fatal).
 */

function makeSupabase(options: {
  prefsTimezone?: string | null;
  rpcResults?: Record<string, { data?: unknown; error?: { message: string } }>;
}) {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: options.prefsTimezone ? { checkup_notification_timezone: options.prefsTimezone } : null,
    error: null,
  });

  const rpc = vi.fn(async (name: string) => {
    const configured = options.rpcResults?.[name];
    if (configured?.error) return { data: null, error: configured.error };
    return { data: configured?.data ?? 0, error: null };
  });

  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
      upsert,
    })),
    rpc,
  } as unknown as SupabaseClient<Database>;

  return { client, rpc, upsert };
}

describe("regenerateDoseEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("timezone precedence", () => {
    it("prefers the caller's timezone over the stored preference", async () => {
      const { client, rpc } = makeSupabase({ prefsTimezone: "Asia/Tokyo" });

      const result = await regenerateDoseEvents(client, {
        authUserId: "user-1",
        timezone: "Europe/Berlin",
      });

      expect(result.timezone).toBe("Europe/Berlin");
      expect(rpc).toHaveBeenCalledWith(
        "generate_med_dose_events_for_horizon",
        expect.objectContaining({ p_timezone: "Europe/Berlin" }),
      );
    });

    it("falls back to the stored preference", async () => {
      const { client } = makeSupabase({ prefsTimezone: "Asia/Tokyo" });

      const result = await regenerateDoseEvents(client, { authUserId: "user-1" });

      expect(result.timezone).toBe("Asia/Tokyo");
    });

    it("falls back to UTC when neither is set", async () => {
      const { client } = makeSupabase({});

      const result = await regenerateDoseEvents(client, { authUserId: "user-1" });

      expect(result.timezone).toBe("UTC");
    });

    it("persists a new caller timezone so cron generates at the same local times", async () => {
      const { client, upsert } = makeSupabase({ prefsTimezone: "Asia/Tokyo" });

      await regenerateDoseEvents(client, { authUserId: "user-1", timezone: "Europe/Berlin" });

      expect(upsert).toHaveBeenCalledWith(
        { auth_user_id: "user-1", checkup_notification_timezone: "Europe/Berlin" },
        { onConflict: "auth_user_id" },
      );
    });

    it("does not write when the timezone is unchanged", async () => {
      const { client, upsert } = makeSupabase({ prefsTimezone: "Asia/Tokyo" });

      await regenerateDoseEvents(client, { authUserId: "user-1", timezone: "Asia/Tokyo" });

      expect(upsert).not.toHaveBeenCalled();
    });

    it("ignores a blank timezone", async () => {
      const { client, upsert } = makeSupabase({ prefsTimezone: "Asia/Tokyo" });

      const result = await regenerateDoseEvents(client, { authUserId: "user-1", timezone: "   " });

      expect(result.timezone).toBe("Asia/Tokyo");
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe("scope", () => {
    it("uses the person-scoped RPCs when a person is given", async () => {
      const { client, rpc } = makeSupabase({
        rpcResults: {
          clear_future_med_dose_events_for_person: { data: 3 },
          generate_med_dose_events_for_horizon_for_person: { data: 14 },
        },
      });

      const result = await regenerateDoseEvents(client, {
        authUserId: "user-1",
        personId: "p-1",
      });

      expect(rpc).toHaveBeenCalledWith("clear_future_med_dose_events_for_person", {
        p_person_id: "p-1",
        p_horizon_days: 7,
      });
      expect(result).toMatchObject({ eventsCleared: 3, eventsGenerated: 14 });
    });

    it("uses the user-scoped RPCs when no person is given", async () => {
      const { client, rpc } = makeSupabase({
        rpcResults: { generate_med_dose_events_for_horizon: { data: 9 } },
      });

      const result = await regenerateDoseEvents(client, { authUserId: "user-1" });

      expect(rpc).toHaveBeenCalledWith(
        "clear_future_med_dose_events",
        expect.objectContaining({ p_auth_user_id: "user-1" }),
      );
      expect(result.eventsGenerated).toBe(9);
    });

    it("treats a blank person id as no person", async () => {
      const { client, rpc } = makeSupabase({});

      await regenerateDoseEvents(client, { authUserId: "user-1", personId: "  " });

      expect(rpc).toHaveBeenCalledWith(
        "clear_future_med_dose_events",
        expect.objectContaining({ p_auth_user_id: "user-1" }),
      );
    });
  });

  describe("failure handling", () => {
    it("tolerates a failed clear and still regenerates", async () => {
      // A partial clear still leaves regeneration able to produce a correct
      // forward plan, so this must not abort.
      const { client } = makeSupabase({
        rpcResults: {
          clear_future_med_dose_events: { error: { message: "deadlock" } },
          generate_med_dose_events_for_horizon: { data: 5 },
        },
      });

      const result = await regenerateDoseEvents(client, { authUserId: "user-1" });

      expect(result.eventsCleared).toBe(0);
      expect(result.eventsGenerated).toBe(5);
    });

    it("throws when generation fails, rather than reporting a silently empty plan", async () => {
      const { client } = makeSupabase({
        rpcResults: {
          generate_med_dose_events_for_horizon: { error: { message: "boom" } },
        },
      });

      await expect(regenerateDoseEvents(client, { authUserId: "user-1" })).rejects.toThrow(
        /Event generator failed: boom/,
      );
    });

    it("throws when person-scoped generation fails", async () => {
      const { client } = makeSupabase({
        rpcResults: {
          generate_med_dose_events_for_horizon_for_person: { error: { message: "boom" } },
        },
      });

      await expect(
        regenerateDoseEvents(client, { authUserId: "user-1", personId: "p-1" }),
      ).rejects.toThrow(/Event generator failed/);
    });
  });
});
