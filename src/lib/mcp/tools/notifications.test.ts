import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolServer } from "./types";

const settings = vi.hoisted(() => ({
  getNotificationSettings: vi.fn(),
  updateNotificationSettings: vi.fn(),
}));

vi.mock("../health/notification-settings", () => settings);
vi.mock("../supabase-user-client", () => ({
  createUserScopedSupabaseClient: vi.fn(() => ({}) as never),
}));

type Handler = (
  args: unknown,
  ctx: unknown,
) => Promise<{
  isError?: boolean;
  content: Array<{ text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

function ctx(scopes = ["health:read", "health:write"]) {
  return {
    http: {
      authInfo: {
        scopes,
        extra: {
          grantId: "g-1",
          authUserId: "11111111-1111-1111-1111-111111111111",
          userEmail: "u@example.com",
        },
      },
    },
  };
}

const SNAPSHOT = {
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
};

async function handlers(): Promise<Map<string, Handler>> {
  const { registerNotificationTools } = await import("./notifications");
  const map = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _c: unknown, handler: Handler) => {
      map.set(name, handler);
      return {} as never;
    }),
  } as unknown as McpToolServer;
  registerNotificationTools(server);
  return map;
}

beforeEach(() => {
  vi.clearAllMocks();
  settings.getNotificationSettings.mockResolvedValue(SNAPSHOT);
  settings.updateNotificationSettings.mockResolvedValue({
    ...SNAPSHOT,
    checkup_reminder: { time: "07:30", timezone: "Europe/Berlin" },
  });
});

describe("get_notification_settings", () => {
  it("summarises checkup reminder time/tz and each routing row", async () => {
    const result = await (await handlers()).get("get_notification_settings")!({}, ctx());

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("09:00");
    expect(result.content[0].text).toContain("Europe/Moscow");
    expect(result.content[0].text).toContain("Пёс");
    expect(result.structuredContent).toEqual(SNAPSHOT);
  });

  it("works on a read-only grant", async () => {
    const result = await (await handlers()).get("get_notification_settings")!(
      {},
      ctx(["health:read"]),
    );

    expect(result.isError).toBeFalsy();
    expect(settings.getNotificationSettings).toHaveBeenCalled();
  });
});

describe("update_notification_settings", () => {
  it("passes normalised reminder fields and routing to the data layer", async () => {
    const result = await (await handlers()).get("update_notification_settings")!(
      {
        checkup_reminder_time: "7:30",
        checkup_reminder_timezone: "Europe/Berlin",
        routing: [
          {
            person_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            enabled: true,
            custom_prefix: " Собака ",
          },
        ],
      },
      ctx(),
    );

    expect(result.isError).toBeFalsy();
    expect(settings.updateNotificationSettings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        authUserId: "11111111-1111-1111-1111-111111111111",
        checkupReminderTime: "07:30",
        checkupReminderTimezone: "Europe/Berlin",
        routing: [
          {
            person_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            enabled: true,
            custom_prefix: "Собака",
          },
        ],
      }),
    );
    expect(result.structuredContent).toMatchObject({
      checkup_reminder: { time: "07:30", timezone: "Europe/Berlin" },
    });
  });

  it("refuses an unknown timezone before writing", async () => {
    const result = await (await handlers()).get("update_notification_settings")!(
      { checkup_reminder_timezone: "Mars/Olympus" },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(settings.updateNotificationSettings).not.toHaveBeenCalled();
  });

  it("refuses when nothing to update is given", async () => {
    const result = await (await handlers()).get("update_notification_settings")!({}, ctx());

    expect(result.isError).toBe(true);
    expect(settings.updateNotificationSettings).not.toHaveBeenCalled();
  });

  it("refuses on a read-only grant, before writing anything", async () => {
    const result = await (await handlers()).get("update_notification_settings")!(
      { checkup_reminder_time: "08:00" },
      ctx(["health:read"]),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("health:write");
    expect(settings.updateNotificationSettings).not.toHaveBeenCalled();
  });
});
