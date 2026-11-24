import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolServer } from "./types";

const checkups = vi.hoisted(() => ({
  listCheckups: vi.fn(),
  getCheckup: vi.fn(),
  loadCheckupItem: vi.fn(),
  latestCompletionDay: vi.fn(),
  markCheckupDone: vi.fn(),
  updateCheckupSchedule: vi.fn(),
  scheduleColumnFromWrite: vi.fn(),
}));

const regen = vi.hoisted(() => ({
  readTimezonePreference: vi.fn(),
}));
const person = vi.hoisted(() => ({ resolvePerson: vi.fn(), listPeople: vi.fn() }));

vi.mock("../health/checkups", async () => {
  const actual = await vi.importActual<typeof import("../health/checkups")>("../health/checkups");
  return {
    ...actual,
    listCheckups: checkups.listCheckups,
    getCheckup: checkups.getCheckup,
    loadCheckupItem: checkups.loadCheckupItem,
    latestCompletionDay: checkups.latestCompletionDay,
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
vi.mock("@/lib/medications/regenerate-dose-events", () => ({
  readTimezonePreference: (...args: unknown[]) => regen.readTimezonePreference(...args),
}));
vi.mock("../resolve-person", () => person);
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
  person.resolvePerson.mockResolvedValue({
    status: "ok",
    person: { id: "p-1", name: "Максим", kind: "human" },
  });
  regen.readTimezonePreference.mockResolvedValue("UTC");
  checkups.loadCheckupItem.mockResolvedValue(ITEM);
  checkups.latestCompletionDay.mockResolvedValue(null);
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

  it("defaults done_at to local today across the Krasnoyarsk day boundary", async () => {
    // 01:00 Asia/Krasnoyarsk (UTC+7) is still 18:00 UTC on the previous calendar day.
    vi.setSystemTime(new Date("2026-06-14T18:00:00Z"));
    regen.readTimezonePreference.mockResolvedValue("Asia/Krasnoyarsk");
    checkups.markCheckupDone.mockResolvedValue({
      checkup: { ...ITEM, next_due_at: "2026-12-15" },
      completion: {
        id: "done-1",
        done_at: "2026-06-15",
        note: null,
        evidence_record_id: null,
      },
    });

    const result = await (await handlers()).get("mark_checkup_done")!(
      { checkup_id: ITEM.id },
      ctx(),
    );

    expect(result.isError).toBeFalsy();
    expect(checkups.markCheckupDone).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ doneAt: "2026-06-15" }),
    );
    expect(result.content[0].text).not.toContain("Preview only");
  });

  it("keeps an explicit done_at even when local today differs from UTC", async () => {
    vi.setSystemTime(new Date("2026-06-14T18:00:00Z"));
    regen.readTimezonePreference.mockResolvedValue("Asia/Krasnoyarsk");
    checkups.markCheckupDone.mockResolvedValueOnce({
      checkup: { ...ITEM, next_due_at: "2026-12-14" },
      completion: { id: "done-1", done_at: "2026-06-14" },
    });

    const result = await (await handlers()).get("mark_checkup_done")!(
      { checkup_id: ITEM.id, done_at: "2026-06-14", confirm: true },
      ctx(),
    );

    expect(checkups.markCheckupDone).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ doneAt: "2026-06-14" }),
    );
    expect(result.structuredContent).toMatchObject({
      completion: { id: "done-1", done_at: "2026-06-14" },
      checkup: { id: ITEM.id, next_due_at: "2026-12-14" },
    });
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

  it("refuses a missing or archived checkup before preview", async () => {
    const map = await handlers();
    checkups.loadCheckupItem.mockResolvedValueOnce(null);
    const missing = await map.get("update_checkup_schedule")!(
      {
        checkup_id: ITEM.id,
        schedule: { type: "one_off", due_at: "2026-12-01" },
      },
      ctx(),
    );
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toMatch(/No checkup/);

    checkups.loadCheckupItem.mockResolvedValueOnce({ ...ITEM, status: "archived" });
    const archived = await map.get("update_checkup_schedule")!(
      {
        checkup_id: ITEM.id,
        schedule: { type: "one_off", due_at: "2026-12-01" },
      },
      ctx(),
    );
    expect(archived.isError).toBe(true);
    expect(archived.content[0].text).toMatch(/archived/);
    expect(checkups.updateCheckupSchedule).not.toHaveBeenCalled();
  });

  it("previews reactivation when an interval rewrite hits a completed checkup", async () => {
    checkups.loadCheckupItem.mockResolvedValue({
      ...ITEM,
      status: "completed",
      schedule: { type: "one_off", due_at: "2026-01-01" },
    });
    const preview = await (await handlers()).get("update_checkup_schedule")!(
      {
        checkup_id: ITEM.id,
        schedule: { type: "interval", every: 1, unit: "year", next_due_from: "target" },
      },
      ctx(),
    );
    expect(preview.isError).toBeFalsy();
    expect(preview.content[0].text).toMatch(/completed → active/);
    expect(preview.content[0].text).toMatch(/one-off due/);
    expect(preview.content[0].text).toMatch(/every 1 year/);
    expect(preview.content[0].text).toMatch(/next from target/);
    expect(preview.structuredContent?.proposed).toMatchObject({ status: "active" });
  });
});

describe("list_checkups / get_checkup", () => {
  it("flags overdue rows and omits due date when absent", async () => {
    checkups.listCheckups.mockResolvedValue([
      {
        id: ITEM.id,
        title: "Blood panel",
        category: "lab",
        status: "active",
        next_due_at: "2026-01-01",
        is_overdue: true,
        days_until_due: -10,
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Dental",
        category: "dental",
        status: "paused",
        next_due_at: null,
        is_overdue: false,
        days_until_due: null,
      },
    ]);
    const result = await (await handlers()).get("list_checkups")!(
      { person_id: "p-1", due_window: "all" },
      ctx(),
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("1 overdue");
    expect(result.content[0].text).toContain("OVERDUE by 10 days");
    expect(result.content[0].text).toContain("no due date");
    expect(result.structuredContent?.overdue_count).toBe(1);
  });

  it("fails get_checkup when missing and quotes next due when present", async () => {
    const map = await handlers();
    checkups.getCheckup.mockResolvedValueOnce({ checkup: null, completions: [] });
    const missing = await map.get("get_checkup")!({ checkup_id: ITEM.id }, ctx());
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toMatch(/No checkup/);

    checkups.getCheckup.mockResolvedValueOnce({
      checkup: { ...ITEM, next_due_at: null },
      completions: [{ id: "done-1" }],
    });
    const noDue = await map.get("get_checkup")!({ checkup_id: ITEM.id }, ctx());
    expect(noDue.isError).toBeFalsy();
    expect(noDue.content[0].text).toContain("1 completion");
    expect(noDue.content[0].text).not.toContain("next due");

    checkups.getCheckup.mockResolvedValueOnce({
      checkup: ITEM,
      completions: [],
    });
    const withDue = await map.get("get_checkup")!({ checkup_id: ITEM.id }, ctx());
    expect(withDue.content[0].text).toContain("next due 2026-06-20");
  });
});

describe("mark_checkup_done guards", () => {
  it("rejects an unrecognised timezone before writing", async () => {
    const result = await (await handlers()).get("mark_checkup_done")!(
      { checkup_id: ITEM.id, timezone: "Not/AZone" },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/IANA/);
    expect(checkups.markCheckupDone).not.toHaveBeenCalled();
  });

  it("falls back to UTC when no preference is saved", async () => {
    vi.setSystemTime(new Date("2026-06-15T23:30:00Z"));
    regen.readTimezonePreference.mockResolvedValue(null);
    const result = await (await handlers()).get("mark_checkup_done")!(
      { checkup_id: ITEM.id },
      ctx(),
    );

    expect(checkups.markCheckupDone).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ doneAt: "2026-06-15" }),
    );
    expect(result.content[0].text).toBe(
      'Marked "Blood panel" done on 2026-06-15. Next due: 2026-12-15 (active).',
    );
  });

  it("refuses a done_at before the latest completion", async () => {
    checkups.latestCompletionDay.mockResolvedValue("2026-06-10");
    const result = await (await handlers()).get("mark_checkup_done")!(
      { checkup_id: ITEM.id, done_at: "2026-06-01", confirm: true },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/before the latest completion/);
    expect(checkups.markCheckupDone).not.toHaveBeenCalled();
  });

  it("fails backdate preview when the checkup row is gone", async () => {
    checkups.loadCheckupItem.mockResolvedValueOnce(null);
    const result = await (await handlers()).get("mark_checkup_done")!(
      { checkup_id: ITEM.id, done_at: "2026-05-01" },
      ctx(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/No checkup/);
    expect(checkups.markCheckupDone).not.toHaveBeenCalled();
  });
});
