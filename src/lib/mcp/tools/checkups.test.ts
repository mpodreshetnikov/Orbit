import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolServer } from "./types";

const checkups = vi.hoisted(() => ({
  listCheckups: vi.fn(),
  getCheckup: vi.fn(),
  loadCheckupItem: vi.fn(),
  markCheckupDone: vi.fn(),
  updateCheckupSchedule: vi.fn(),
  scheduleColumnFromWrite: vi.fn(),
}));

vi.mock("../health/checkups", async () => {
  const actual = await vi.importActual<typeof import("../health/checkups")>("../health/checkups");
  return {
    ...actual,
    listCheckups: checkups.listCheckups,
    getCheckup: checkups.getCheckup,
    loadCheckupItem: checkups.loadCheckupItem,
    markCheckupDone: checkups.markCheckupDone,
    updateCheckupSchedule: checkups.updateCheckupSchedule,
    scheduleColumnFromWrite: (...args: unknown[]) => {
      checkups.scheduleColumnFromWrite(...args);
      return actual.scheduleColumnFromWrite(
        ...(args as Parameters<typeof actual.scheduleColumnFromWrite>),
      );
    },
  };
});
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

const ITEM = {
  id: "11111111-1111-4111-8111-111111111111",
  person_id: "p-1",
  title: "Blood panel",
  category: "lab",
  status: "active",
  schedule: { type: "interval", every: 6, unit: "month" },
  next_due_at: "2026-06-20",
  reminder_days_before: [7],
};

async function handlers(): Promise<Map<string, Handler>> {
  const { registerCheckupTools } = await import("./checkups");
  const map = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _c: unknown, handler: Handler) => {
      map.set(name, handler);
      return {} as never;
    }),
  } as unknown as McpToolServer;
  registerCheckupTools(server);
  return map;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
  checkups.loadCheckupItem.mockResolvedValue(ITEM);
  checkups.markCheckupDone.mockResolvedValue({
    checkup: { ...ITEM, next_due_at: "2026-12-15" },
    completion: {
      id: "done-1",
      done_at: "2026-06-15",
      note: null,
      evidence_record_id: null,
    },
  });
  checkups.updateCheckupSchedule.mockResolvedValue({
    before: ITEM,
    after: {
      ...ITEM,
      schedule: { type: "interval", every: 3, unit: "month", anchor_date: "2026-03-20" },
      reminder_days_before: [14, 7],
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mark_checkup_done", () => {
  it("writes today's completion without a confirm flag", async () => {
    const result = await (await handlers()).get("mark_checkup_done")!(
      { checkup_id: ITEM.id },
      ctx(),
    );

    expect(result.isError).toBeFalsy();
    expect(checkups.markCheckupDone).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ checkupId: ITEM.id, doneAt: "2026-06-15" }),
    );
    expect(result.content[0].text).toContain("Marked");
    expect(result.content[0].text).toContain("2026-12-15");
  });

  it("previews a backdate and writes nothing until confirm=true", async () => {
    const map = await handlers();
    const preview = await map.get("mark_checkup_done")!(
      { checkup_id: ITEM.id, done_at: "2026-05-01" },
      ctx(),
    );

    expect(preview.isError).toBeFalsy();
    expect(preview.structuredContent?.needs_confirm).toBe(true);
    expect(checkups.markCheckupDone).not.toHaveBeenCalled();
    expect(preview.content[0].text).toContain("Preview only");

    await map.get("mark_checkup_done")!(
      { checkup_id: ITEM.id, done_at: "2026-05-01", confirm: true },
      ctx(),
    );
    expect(checkups.markCheckupDone).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ doneAt: "2026-05-01" }),
    );
  });

  it("refuses on a read-only grant before writing", async () => {
    const result = await (await handlers()).get("mark_checkup_done")!(
      { checkup_id: ITEM.id },
      ctx(["health:read"]),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("health:write");
    expect(checkups.markCheckupDone).not.toHaveBeenCalled();
  });
});

describe("update_checkup_schedule", () => {
  it("previews then writes only with confirm=true", async () => {
    const map = await handlers();
    const schedule = { type: "interval" as const, every: 3, unit: "month" as const };

    const preview = await map.get("update_checkup_schedule")!(
      { checkup_id: ITEM.id, schedule, reminder_days_before: [7, 14] },
      ctx(),
    );
    expect(preview.structuredContent?.needs_confirm).toBe(true);
    expect(checkups.updateCheckupSchedule).not.toHaveBeenCalled();

    const written = await map.get("update_checkup_schedule")!(
      { checkup_id: ITEM.id, schedule, reminder_days_before: [7, 14], confirm: true },
      ctx(),
    );
    expect(written.isError).toBeFalsy();
    expect(checkups.updateCheckupSchedule).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        checkupId: ITEM.id,
        schedule,
        reminderDaysBefore: [7, 14],
      }),
    );
  });

  it("refuses on a read-only grant before writing", async () => {
    const result = await (await handlers()).get("update_checkup_schedule")!(
      {
        checkup_id: ITEM.id,
        schedule: { type: "one_off", due_at: "2026-12-01" },
        confirm: true,
      },
      ctx(["health:read"]),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("health:write");
    expect(checkups.updateCheckupSchedule).not.toHaveBeenCalled();
  });
});
