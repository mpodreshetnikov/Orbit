import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseStub } from "./test-support";
import { getNotificationSettings, updateNotificationSettings } from "./notification-settings";

const USER = "11111111-1111-1111-1111-111111111111";

describe("getNotificationSettings", () => {
  it("returns HH:mm reminder time, timezone, and routing rows for the user", async () => {
    const stub = createSupabaseStub({
      user_preferences: [
        {
          data: {
            checkup_notification_time: "09:00:00",
            checkup_notification_timezone: "Europe/Moscow",
          },
        },
      ],
      notification_routing: [
        {
          data: [
            {
              person_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              enabled: true,
              custom_prefix: null,
            },
            {
              person_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
              enabled: false,
              custom_prefix: "Пёс",
            },
          ],
        },
      ],
    });

    const result = await getNotificationSettings(stub.client as SupabaseClient<Database>, USER);

    expect(result).toEqual({
      checkup_reminder: { time: "09:00", timezone: "Europe/Moscow" },
      routing: [
        {
          person_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          enabled: true,
          custom_prefix: null,
        },
        {
          person_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          enabled: false,
          custom_prefix: "Пёс",
        },
      ],
    });
    expect(stub.argsFor("user_preferences", "eq")).toContainEqual(["auth_user_id", USER]);
    expect(stub.argsFor("notification_routing", "eq")).toContainEqual(["recipient_user_id", USER]);
  });

  it("defaults missing prefs to 09:00 and a null timezone", async () => {
    const stub = createSupabaseStub({
      user_preferences: [{ data: null }],
      notification_routing: [{ data: [] }],
    });

    const result = await getNotificationSettings(stub.client as SupabaseClient<Database>, USER);

    expect(result.checkup_reminder).toEqual({ time: "09:00", timezone: null });
    expect(result.routing).toEqual([]);
  });
});

describe("updateNotificationSettings", () => {
  it("upserts reminder prefs and routing, then returns the fresh snapshot", async () => {
    const stub = createSupabaseStub({
      user_preferences: [
        { data: null }, // upsert
        {
          data: {
            checkup_notification_time: "07:30:00",
            checkup_notification_timezone: "Europe/Berlin",
          },
        },
      ],
      notification_routing: [
        { data: null }, // upsert one row
        {
          data: [
            {
              person_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
              enabled: true,
              custom_prefix: "Собака",
            },
          ],
        },
      ],
    });

    const result = await updateNotificationSettings(stub.client as SupabaseClient<Database>, {
      authUserId: USER,
      checkupReminderTime: "07:30",
      checkupReminderTimezone: "Europe/Berlin",
      routing: [
        {
          person_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          enabled: true,
          custom_prefix: "Собака",
        },
      ],
    });

    expect(stub.argsFor("user_preferences", "upsert")[0]?.[0]).toEqual({
      auth_user_id: USER,
      checkup_notification_time: "07:30",
      checkup_notification_timezone: "Europe/Berlin",
    });
    expect(stub.argsFor("notification_routing", "upsert")[0]?.[0]).toEqual({
      recipient_user_id: USER,
      person_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      enabled: true,
      custom_prefix: "Собака",
    });
    expect(result.checkup_reminder).toEqual({
      time: "07:30",
      timezone: "Europe/Berlin",
    });
  });

  it("can update only routing without touching preferences", async () => {
    const stub = createSupabaseStub({
      user_preferences: [
        {
          data: {
            checkup_notification_time: "09:00:00",
            checkup_notification_timezone: "UTC",
          },
        },
      ],
      notification_routing: [
        { data: null },
        {
          data: [
            {
              person_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
              enabled: false,
              custom_prefix: null,
            },
          ],
        },
      ],
    });

    await updateNotificationSettings(stub.client as SupabaseClient<Database>, {
      authUserId: USER,
      routing: [
        {
          person_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          enabled: false,
          custom_prefix: null,
        },
      ],
    });

    expect(stub.argsFor("user_preferences", "upsert")).toEqual([]);
    expect(stub.argsFor("notification_routing", "upsert")).toHaveLength(1);
  });

  it("surfaces a preferences write error", async () => {
    const stub = createSupabaseStub({
      user_preferences: [{ data: null, error: { message: "prefs boom" } }],
    });

    await expect(
      updateNotificationSettings(stub.client as SupabaseClient<Database>, {
        authUserId: USER,
        checkupReminderTime: "08:00",
      }),
    ).rejects.toThrow("prefs boom");
  });
});
