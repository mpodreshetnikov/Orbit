import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolServer } from "./types";

const meds = vi.hoisted(() => ({
  listMedications: vi.fn(),
  getMedication: vi.fn(),
  listMedicationDoses: vi.fn(),
  createRegimen: vi.fn(),
  updateRegimen: vi.fn(),
  findRegimensByName: vi.fn(),
  logDose: vi.fn(),
}));
const regen = vi.hoisted(() => ({
  regenerateDoseEvents: vi.fn(),
  resolveTimezone: vi.fn(),
  readTimezonePreference: vi.fn(),
}));
const person = vi.hoisted(() => ({ resolvePerson: vi.fn(), listPeople: vi.fn() }));

vi.mock("../health/medications", () => meds);
vi.mock("@/lib/medications/regenerate-dose-events", () => regen);
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

const PERSON = { id: "p-1", name: "Maria", kind: "human" };

// The handlers are called directly here, so zod's defaults for the paging
// arguments are never applied. Spread this where the tool takes them.
const PAGE = { limit: 20, offset: 0 };

async function handlers(): Promise<Map<string, Handler>> {
  const { registerMedicationTools } = await import("./medications");
  const map = new Map<string, Handler>();
  const server = {
    registerTool: vi.fn((name: string, _c: unknown, handler: Handler) => {
      map.set(name, handler);
      return {} as never;
    }),
  } as unknown as McpToolServer;
  registerMedicationTools(server);
  return map;
}

beforeEach(() => {
  vi.clearAllMocks();
  person.resolvePerson.mockResolvedValue({ status: "ok", person: PERSON });
  meds.findRegimensByName.mockResolvedValue([]);
  regen.resolveTimezone.mockResolvedValue("Europe/Berlin");
  regen.readTimezonePreference.mockResolvedValue("Europe/Berlin");
  regen.regenerateDoseEvents.mockResolvedValue({
    eventsCleared: 2,
    eventsGenerated: 14,
    timezone: "Europe/Berlin",
  });
});

describe("list_medications", () => {
  it("prefers the effective status over the stored one", async () => {
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Ferrous sulfate",
          status: "active",
          effective_status: "completed",
          dose_definition: { intake: { amount: 1, unit: "pill" } },
          schedule: { mode: "daily_times" },
        },
      ],
      total: 1,
    });

    const result = await (await handlers()).get("list_medications")!({ ...PAGE }, ctx());

    expect(result.content[0].text).toContain("Ferrous sulfate — completed, 1 pill");
  });

  it("prints the milligrams, the course window, the stock and the note the row carries", async () => {
    // Every one of these was in the row and in `structuredContent` already, and
    // none of it reached the text block -- which is why an assistant asked how
    // long a 100 mg dose had run and had to answer "50 mg or 100 mg, depending".
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Золофт",
          status: "active",
          effective_status: "active",
          intake_unit: "pill",
          dose_definition: {
            intake: { amount: 1.5, unit: "pill" },
            active: [{ name: "Сертралин", amount: 150, unit: "milligram" }],
          },
          schedule: { mode: "daily_times", times: ["09:00"] },
          duration: { type: "endless", start_date: "2026-08-07" },
          inventory: { enabled: true, current_amount: 12, unit: "pill" },
          notes: "1.5 таб по 100 мг",
        },
      ],
      total: 1,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    expect(text).toContain("1.5 pill (Сертралин 150 milligram)");
    expect(text).toContain("schedule daily_times at 09:00 (local wall clock)");
    expect(text).toContain("from 2026-08-07");
    expect(text).toContain("stock 12 pill");
    expect(text).toContain('note "1.5 таб по 100 мг"');
  });

  it("prints each slot's own amount, not the course default", async () => {
    // A regimen can carry a different amount per time of day, and the generator
    // honours it. Printing the base dose beside bare times would describe half a
    // pill in the morning and one and a half at night as the same intake.
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Атаракс",
          status: "active",
          effective_status: "active",
          dose_definition: { intake: { amount: 0.5, unit: "pill" } },
          schedule: { mode: "daily_times", times: ["09:00", "22:00"], amounts: [0.5, 1.5] },
        },
      ],
      total: 1,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    expect(text).toContain("at 09:00 (0.5 pill), 22:00 (1.5 pill) (local wall clock)");
  });

  it("says the strength belongs to the base dose when a slot overrides the amount", async () => {
    // The generator copies `active` unchanged while replacing the amount, so a
    // reader must not carry 150 mg onto the 0.5-pill slot — the same rule the
    // intake lines follow when an amount disagrees with its course.
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Золофт",
          status: "active",
          effective_status: "active",
          dose_definition: {
            intake: { amount: 1.5, unit: "pill" },
            active: [{ name: "Сертралин", amount: 150, unit: "milligram" }],
          },
          schedule: { mode: "daily_times", times: ["09:00", "21:00"], amounts: [1.5, 0.5] },
        },
      ],
      total: 1,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    expect(text).toContain("strength on file is for the 1.5 pill dose only");
  });

  it("names only a bounded number of active ingredients", async () => {
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Комбинация",
          status: "active",
          effective_status: "active",
          dose_definition: {
            intake: { amount: 1, unit: "pill" },
            active: Array.from({ length: 9 }, (_, i) => ({
              name: `Вещество ${i}`,
              amount: 10 + i,
              unit: "milligram",
            })),
          },
          schedule: { mode: "daily_times", times: ["09:00"] },
        },
      ],
      total: 1,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    // A page can carry a hundred rows; an unbounded ingredient list on each is
    // the same context problem notes already have a cap for.
    expect(text).toContain("Вещество 0 10 milligram");
    expect(text).toContain("…5 more");
    expect(text).not.toContain("Вещество 8");
  });

  it("renders a one-off due time in the zone it names", async () => {
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Флуконазол",
          status: "active",
          effective_status: "active",
          dose_definition: { intake: { amount: 1, unit: "capsule" } },
          schedule: { mode: "one_off", due_at: "2026-08-30T02:00:00+00:00" },
        },
      ],
      total: 1,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    // T-0027: an instant is converted and labelled, or it is not printed. The
    // tool resolves the saved preference (Europe/Berlin in these tests), so the
    // due time is quoted with its offset rather than left in the payload.
    expect(text).toContain("schedule one_off, due 2026-08-30 04:00 +02:00");
  });

  it("refuses a timezone it cannot resolve rather than listing in UTC", async () => {
    const result = await (await handlers()).get("list_medications")!(
      { ...PAGE, timezone: "Mars/Olympus" },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(meds.listMedications).not.toHaveBeenCalled();
  });

  it("keeps the time of a legacy interval_days row", async () => {
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Метотрексат",
          status: "active",
          effective_status: "active",
          dose_definition: { intake: { amount: 1, unit: "pill" } },
          schedule: { mode: "interval_days", interval: { every: 3 }, time_of_day: "09:00" },
        },
      ],
      total: 1,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    expect(text).toContain("every 3d at 09:00 (local wall clock)");
  });

  it("says how long a for_days course runs when it records no start date", async () => {
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Аугментин",
          status: "active",
          effective_status: "active",
          dose_definition: { intake: { amount: 1, unit: "pill" } },
          schedule: { mode: "daily_times", times: ["09:00"] },
          duration: { type: "for_days", days: 7 },
        },
      ],
      total: 1,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    expect(text).toContain("for 7 days (start date not recorded)");
  });

  it("warns when an interval_hours schedule overrides the base amount", async () => {
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Ибупрофен",
          status: "active",
          effective_status: "active",
          dose_definition: {
            intake: { amount: 1, unit: "pill" },
            active: [{ name: "Ибупрофен", amount: 100, unit: "milligram" }],
          },
          schedule: { mode: "interval_hours", interval: { every: 8 }, amount: 2 },
        },
      ],
      total: 1,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    expect(text).toContain("every 8h (2 pill per intake)");
    expect(text).toContain("strength on file is for the 1 pill dose only");
  });

  it("cuts a long note rather than spending the reply on it", async () => {
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Золофт",
          status: "active",
          effective_status: "active",
          dose_definition: { intake: { amount: 1, unit: "pill" } },
          schedule: { mode: "daily_times", times: ["09:00"] },
          notes: "и".repeat(400),
        },
      ],
      total: 1,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    // Notes are unbounded free text, and a page can carry twenty of them; the
    // whole note stays in `structuredContent`.
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(400);
  });

  it("dates each course, so two courses of one medication are distinguishable", async () => {
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-old",
          custom_name: "Золофт",
          status: "active",
          effective_status: "completed",
          dose_definition: { intake: { amount: 1, unit: "pill" } },
          schedule: { mode: "daily_times", times: ["21:00"] },
          duration: { type: "for_days", days: 4, start_date: "2026-07-26" },
        },
        {
          id: "r-new",
          custom_name: "Золофт",
          status: "active",
          effective_status: "completed",
          dose_definition: { intake: { amount: 1.5, unit: "pill" } },
          schedule: { mode: "daily_times", times: ["21:00"] },
          duration: { type: "for_days", days: 4, start_date: "2026-08-03" },
        },
      ],
      total: 2,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    expect(text).toContain("2026-07-26 to 2026-07-29");
    expect(text).toContain("2026-08-03 to 2026-08-06");
  });

  it("pages from the query, so nothing is stranded behind a truncated response", async () => {
    const row = (i: number) => ({
      id: `r-${i}`,
      custom_name: `Med ${i}`,
      status: "active",
      effective_status: "active",
      dose_definition: { intake: { amount: 1, unit: "pill" } },
      schedule: { mode: "daily_times", times: ["09:00"] },
    });

    meds.listMedications.mockResolvedValue({
      regimens: Array.from({ length: 20 }, (_, i) => row(i)),
      total: 25,
    });

    const first = await (await handlers()).get("list_medications")!(
      { limit: 20, offset: 0 },
      ctx(),
    );

    const [, params] = meds.listMedications.mock.calls[0] as [unknown, Record<string, number>];
    expect(params.limit).toBe(20);
    expect(params.offset).toBe(0);
    expect(first.content[0].text).toContain("25 medications for Maria (showing 1-20)");
    expect(first.content[0].text).toContain("pass offset: 20 to continue");
    expect(first.structuredContent).toMatchObject({ total: 25, has_more: true, next_offset: 20 });

    meds.listMedications.mockResolvedValue({
      regimens: Array.from({ length: 5 }, (_, i) => row(20 + i)),
      total: 25,
    });

    const second = await (await handlers()).get("list_medications")!(
      { limit: 20, offset: 20 },
      ctx(),
    );

    expect(second.content[0].text).toContain("Med 24");
    expect(second.structuredContent).toMatchObject({ has_more: false, next_offset: null });
  });

  it("renders the medications around a malformed row instead of failing wholesale", async () => {
    // `dose_definition` is jsonb with no shape constraint, so a legacy or
    // imported row can carry anything. One of those must not take down the
    // listing for the healthy courses beside it.
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-bad",
          custom_name: "Imported",
          status: "active",
          effective_status: "active",
          dose_definition: { intake: { amount: 1, unit: "pill" }, active: "Сертралин 150 мг" },
          schedule: { mode: "daily_times", times: ["09:00"] },
        },
        {
          id: "r-good",
          custom_name: "Золофт",
          status: "active",
          effective_status: "active",
          dose_definition: {
            intake: { amount: 1.5, unit: "pill" },
            active: [{ name: "Сертралин", amount: 150, unit: "milligram" }],
          },
          schedule: { mode: "daily_times", times: ["09:00"] },
        },
      ],
      total: 2,
    });

    const result = await (await handlers()).get("list_medications")!({ ...PAGE }, ctx());

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Imported — active, 1 pill");
    expect(result.content[0].text).toContain("1.5 pill (Сертралин 150 milligram)");
  });

  it("renders a schedule whose times are not an array instead of throwing", async () => {
    // A string has a length, so a length check would have let "09:00" reach
    // `.map`. `schedule` is jsonb with no shape constraint.
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Imported",
          status: "active",
          effective_status: "active",
          dose_definition: { intake: { amount: 1, unit: "pill" } },
          schedule: { mode: "daily_times", times: "09:00", days_of_week: 3 },
        },
      ],
      total: 1,
    });

    const result = await (await handlers()).get("list_medications")!({ ...PAGE }, ctx());

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Imported — active, 1 pill, schedule daily_times");
  });

  it("says an offset is past the end rather than printing an impossible window", async () => {
    // Reachable by asking for it, or by paging after rows were removed between
    // two calls. "showing 41-40" reads as a broken tool.
    meds.listMedications.mockResolvedValue({ regimens: [], total: 25 });

    const text = (
      await (await handlers()).get("list_medications")!({ limit: 20, offset: 40 }, ctx())
    ).content[0].text;

    expect(text).toContain("offset 40 is past the end");
    expect(text).toContain("offset: 0");
    expect(text).not.toContain("showing 41");
  });

  it("copes with a regimen that has no dose or schedule recorded", async () => {
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Unknown",
          status: "active",
          effective_status: "active",
          dose_definition: null,
          schedule: null,
        },
      ],
      total: 1,
    });

    const result = await (await handlers()).get("list_medications")!({ ...PAGE }, ctx());

    expect(result.content[0].text).toContain("schedule unknown");
    expect(result.isError).toBeUndefined();
  });
});

describe("get_medication", () => {
  it("summarizes the dose windows", async () => {
    meds.getMedication.mockResolvedValue({
      regimen: { custom_name: "Ferrous sulfate", effective_status: "active" },
      upcomingDoses: [{ id: "d-1" }, { id: "d-2" }],
      recentDoses: [{ id: "d-0" }],
      inventoryTransactions: [],
    });

    const result = await (await handlers()).get("get_medication")!(
      { regimen_id: "r-1", horizon_days: 7, inventory_offset: 0 },
      ctx(),
    );

    expect(result.content[0].text).toContain("2 upcoming dose(s), 1 in the recent window");
  });

  it("reports an unknown regimen", async () => {
    meds.getMedication.mockResolvedValue(null);

    const result = await (await handlers()).get("get_medication")!(
      { regimen_id: "nope", horizon_days: 7, inventory_offset: 0 },
      ctx(),
    );

    expect(result.isError).toBe(true);
  });

  it("names the zone and quotes the next dose in it", async () => {
    regen.readTimezonePreference.mockResolvedValue("Asia/Bangkok");
    meds.getMedication.mockResolvedValue({
      // The regimen's own times are local wall-clock strings; its events are
      // UTC instants. Handing both over unlabelled is what let an assistant
      // conclude the app contradicted the user (T-0027).
      regimen: {
        custom_name: "Атаракс",
        effective_status: "active",
        schedule: { mode: "daily_times", times: ["22:00"] },
      },
      upcomingDoses: [
        { id: "d-2", scheduled_at: "2026-08-25T15:00:00+00:00", actual_at: null, taken_at: null },
      ],
      recentDoses: [
        {
          id: "d-1",
          scheduled_at: "2026-08-24T15:00:00+00:00",
          actual_at: null,
          taken_at: "2026-08-24T16:33:47+00:00",
        },
      ],
      inventoryTransactions: [{ id: "t-1", created_at: "2026-08-24T16:33:47+00:00" }],
    });

    const result = await (await handlers()).get("get_medication")!(
      { regimen_id: "r-1", horizon_days: 7, inventory_offset: 0 },
      ctx(),
    );

    expect(result.content[0].text).toContain("Times are Asia/Bangkok");
    expect(result.content[0].text).toContain("next 2026-08-25 22:00 +07:00");
    expect(result.content[0].text).toContain("last 2026-08-24 23:33 +07:00");
    expect(result.structuredContent).toMatchObject({ timezone: "Asia/Bangkok" });
    expect(
      (result.structuredContent?.upcomingDoses as Array<Record<string, unknown>>)[0],
    ).toMatchObject({ scheduled_at_local: "2026-08-25T22:00:00+07:00" });
    expect(
      (result.structuredContent?.inventoryTransactions as Array<Record<string, unknown>>)[0],
    ).toMatchObject({ created_at_local: "2026-08-24T23:33:47+07:00" });
  });

  it("returns the detail its description promises, not just a count", async () => {
    regen.readTimezonePreference.mockResolvedValue("Asia/Bangkok");
    meds.getMedication.mockResolvedValue({
      regimen: {
        custom_name: "Золофт",
        effective_status: "active",
        intake_unit: "pill",
        dose_definition: {
          intake: { amount: 1.5, unit: "pill" },
          active: [{ name: "Сертралин", amount: 150, unit: "milligram" }],
        },
        schedule: { mode: "daily_times", times: ["09:00"] },
        duration: { type: "endless", start_date: "2026-08-07" },
        inventory: { enabled: true, current_amount: 9, unit: "pill" },
        notes: "1.5 таб по 100 мг",
      },
      upcomingDoses: [
        {
          id: "d-2",
          scheduled_at: "2026-08-30T02:00:00+00:00",
          planned_intake: { intake: { amount: 1.5, unit: "pill" } },
          status: "scheduled",
        },
      ],
      recentDoses: [
        {
          id: "d-1",
          scheduled_at: "2026-08-29T02:00:00+00:00",
          taken_at: "2026-08-29T04:09:00+00:00",
          planned_intake: {
            intake: { amount: 1.5, unit: "pill" },
            active: [{ name: "Сертралин", amount: 150, unit: "milligram" }],
          },
          status: "taken",
          note: "с едой",
        },
      ],
      inventoryTransactions: [
        {
          id: "t-1",
          created_at: "2026-08-29T04:09:00+00:00",
          type: "decrement",
          amount: 1.5,
          unit: "pill",
          note: null,
        },
      ],
    });

    const text = (
      await (await handlers()).get("get_medication")!(
        { regimen_id: "r-1", horizon_days: 7, inventory_offset: 0 },
        ctx(),
      )
    ).content[0].text;

    // The count line stays -- it is the T-0027 zone contract -- and the detail
    // the description has always promised now follows it.
    expect(text).toContain("1 upcoming dose(s), 1 in the recent window");
    expect(text).toContain("1.5 pill (Сертралин 150 milligram)");
    expect(text).toContain("from 2026-08-07");
    expect(text).toContain("stock 9 pill");
    expect(text).toContain("Notes: 1.5 таб по 100 мг");
    expect(text).toContain("2026-08-29 09:00 +07:00 — 1.5 pill (Сертралин 150 milligram) [taken]");
    expect(text).toContain('note "с едой"');
    expect(text).toContain("decrement 1.5 pill");
  });

  it("says the stock ledger is truncated rather than presenting a partial one as whole", async () => {
    meds.getMedication.mockResolvedValue({
      regimen: { custom_name: "Золофт", effective_status: "active" },
      upcomingDoses: [],
      recentDoses: [],
      inventoryTransactions: [
        {
          id: "t-1",
          created_at: "2026-08-29T04:09:00+00:00",
          type: "decrement",
          amount: 1.5,
          unit: "pill",
        },
      ],
      inventoryTotal: 143,
    });

    const text = (
      await (await handlers()).get("get_medication")!(
        { regimen_id: "r-1", horizon_days: 7, inventory_offset: 0 },
        ctx(),
      )
    ).content[0].text;

    expect(text).toContain("Inventory movements (1-1 of 143, newest first");
    expect(text).toContain("pass inventory_offset: 1 for older");
  });

  it("says an inventory offset is past the end rather than dropping the section", async () => {
    // An offset can outrun the ledger by being asked for directly or by
    // movements being removed between two continuation calls. Answering a
    // question about the stock history with no section at all reads as "there
    // is no ledger".
    meds.getMedication.mockResolvedValue({
      regimen: { custom_name: "Золофт", effective_status: "active" },
      upcomingDoses: [],
      recentDoses: [],
      inventoryTransactions: [],
      inventoryTotal: 143,
    });

    const text = (
      await (await handlers()).get("get_medication")!(
        { regimen_id: "r-1", horizon_days: 7, inventory_offset: 400 },
        ctx(),
      )
    ).content[0].text;

    expect(text).toContain("143 recorded, but inventory_offset 400 is past the end");
    expect(text).toContain("inventory_offset: 0");
  });

  it("does not report a skipped dose as taken, and dates a snoozed one where it moved to", async () => {
    // `mark_dose_skipped.sql` writes `taken_at` too, so an unconditional
    // "taken" labels a dose the owner deliberately did not take. And
    // `snooze_dose.sql` moves `actual_at` while leaving `scheduled_at`, which
    // is the time the reminder query and the dashboard both use.
    meds.getMedication.mockResolvedValue({
      regimen: { custom_name: "Золофт", effective_status: "active" },
      upcomingDoses: [
        {
          scheduled_at: "2026-08-29T02:00:00.000Z",
          actual_at: "2026-08-29T04:00:00.000Z",
          planned_intake: { intake: { amount: 1, unit: "pill" } },
          status: "snoozed",
        },
      ],
      recentDoses: [
        {
          scheduled_at: "2026-08-28T02:00:00.000Z",
          actual_at: "2026-08-28T02:00:00.000Z",
          taken_at: "2026-08-28T03:30:00.000Z",
          planned_intake: { intake: { amount: 1, unit: "pill" } },
          status: "skipped",
        },
      ],
      inventoryTransactions: [],
      inventoryTotal: 0,
    });

    const text = (
      await (await handlers()).get("get_medication")!(
        { regimen_id: "r-1", horizon_days: 7, inventory_offset: 0 },
        ctx(),
      )
    ).content[0].text;

    expect(text).toContain("[skipped], marked skipped 2026-08-28 05:30 +02:00");
    expect(text).not.toContain("[skipped], taken");
    expect(text).toContain("2026-08-29 06:00 +02:00 — 1 pill [snoozed]");
    expect(text).toContain("moved from 2026-08-29 04:00 +02:00");
  });

  it("refuses a timezone it cannot resolve rather than answering in UTC", async () => {
    const result = await (await handlers()).get("get_medication")!(
      { regimen_id: "r-1", horizon_days: 7, inventory_offset: 0, timezone: "Mars/Olympus" },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(meds.getMedication).not.toHaveBeenCalled();
  });
});

describe("list_medication_doses", () => {
  it("resolves the local day rather than assuming UTC", async () => {
    meds.listMedicationDoses.mockResolvedValue({ doses: [], total: 0 });

    await (await handlers()).get("list_medication_doses")!(
      { ...PAGE, from: "2026-06-15", to: "2026-06-15" },
      ctx(),
    );

    const [, params] = meds.listMedicationDoses.mock.calls[0] as [unknown, Record<string, string>];
    // Berlin is UTC+2 in June, so the local day starts at 22:00 the day before.
    expect(params.from).toBe("2026-06-14T22:00:00.000Z");
    expect(params.to).toBe("2026-06-15T21:59:59.999Z");
  });

  it("names the timezone it used, so the answer is checkable", async () => {
    meds.listMedicationDoses.mockResolvedValue({ doses: [], total: 0 });

    const result = await (await handlers()).get("list_medication_doses")!(
      { ...PAGE, from: "2026-06-15", to: "2026-06-15" },
      ctx(),
    );

    expect(result.content[0].text).toContain("Europe/Berlin");
  });

  it("renders an intake with its amount and status", async () => {
    meds.listMedicationDoses.mockResolvedValue({
      doses: [
        {
          scheduled_at: "2026-06-15T08:00:00.000Z",
          medication_name: "Ferrous sulfate",
          planned_intake: { intake: { amount: 1, unit: "pill" } },
          status: "taken",
        },
        {
          scheduled_at: "2026-06-15T20:00:00.000Z",
          medication_name: null,
          planned_intake: null,
          status: "scheduled",
        },
      ],
      total: 2,
    });

    const result = await (await handlers()).get("list_medication_doses")!(
      { ...PAGE, from: "2026-06-15", to: "2026-06-15" },
      ctx(),
    );

    expect(result.content[0].text).toContain("Ferrous sulfate, 1 pill [taken]");
    expect(result.content[0].text).toContain("unknown [scheduled]");
  });

  it("carries the milligrams and the note of each intake", async () => {
    meds.listMedicationDoses.mockResolvedValue({
      doses: [
        {
          scheduled_at: "2026-06-15T08:00:00.000Z",
          medication_name: "Золофт",
          planned_intake: {
            intake: { amount: 1.5, unit: "pill" },
            active: [{ name: "Сертралин", amount: 150, unit: "milligram" }],
          },
          status: "taken",
          note: "принял позже обычного",
        },
      ],
      total: 1,
    });

    const text = (
      await (await handlers()).get("list_medication_doses")!(
        { ...PAGE, from: "2026-06-15", to: "2026-06-15" },
        ctx(),
      )
    ).content[0].text;

    // Without the milligrams the model cannot answer "how much did I take",
    // and without the note it cannot tell an empty note apart from a tool that
    // never returns one.
    expect(text).toContain("Золофт, 1.5 pill (Сертралин 150 milligram) [taken]");
    expect(text).toContain('note "принял позже обычного"');
  });

  it("withholds a strength that cannot be tied to this amount", async () => {
    // Nothing rescales `active`: the generator copies it while overriding a
    // slot's amount, and `log_dose` keeps it when a caller corrects one. So an
    // intake of 2 pills on a course defined as 1.5 still carries the 150 mg
    // recorded for 1.5, and printing "2 pill (Сертралин 150 milligram)" would
    // state a dose the record does not support. Naming the course's amount
    // instead would be no better: `dose_definition` is edited in place, so a
    // past intake can sit beside a definition that moved under it.
    meds.listMedicationDoses.mockResolvedValue({
      doses: [
        {
          scheduled_at: "2026-06-15T08:00:00.000Z",
          medication_name: "Золофт",
          planned_intake: {
            intake: { amount: 2, unit: "pill" },
            active: [{ name: "Сертралин", amount: 150, unit: "milligram" }],
          },
          medication_dose: {
            intake: { amount: 1.5, unit: "pill" },
            active: [{ name: "Сертралин", amount: 150, unit: "milligram" }],
          },
          status: "taken",
        },
      ],
      total: 1,
    });

    const text = (
      await (await handlers()).get("list_medication_doses")!(
        { ...PAGE, from: "2026-06-15", to: "2026-06-15" },
        ctx(),
      )
    ).content[0].text;

    expect(text).toContain("Золофт, 2 pill (strength not recorded for this amount)");
    expect(text).not.toContain("150 milligram");
  });

  it("withholds a strength on a course whose slots override the amount", async () => {
    // The matching amounts are not evidence here. An event generated from a
    // 2-pill slot of a 1-pill course stores 2 pills beside the 1-pill course's
    // milligrams; edit the course's own amount to 2 later and the stale copy
    // suddenly reads as verified. The row cannot tell that case from a current
    // one, so a schedule that overrides any amount withholds the strength.
    meds.listMedicationDoses.mockResolvedValue({
      doses: [
        {
          scheduled_at: "2026-06-15T08:00:00.000Z",
          medication_name: "Золофт",
          planned_intake: {
            intake: { amount: 2, unit: "pill" },
            active: [{ name: "Сертралин", amount: 100, unit: "milligram" }],
          },
          medication_dose: {
            intake: { amount: 2, unit: "pill" },
            active: [{ name: "Сертралин", amount: 100, unit: "milligram" }],
          },
          medication_schedule: { mode: "daily_times", times: ["08:00", "20:00"], amounts: [1, 2] },
          status: "taken",
        },
      ],
      total: 1,
    });

    const text = (
      await (await handlers()).get("list_medication_doses")!(
        { ...PAGE, from: "2026-06-15", to: "2026-06-15" },
        ctx(),
      )
    ).content[0].text;

    expect(text).toContain("Золофт, 2 pill (strength not recorded for this amount)");
    expect(text).not.toContain("100 milligram");
  });

  it("bounds the whole rendered ingredient, not only its name", async () => {
    // `unit` is an unrestricted string against a jsonb column, so an imported
    // row can carry a unit as long as a note -- once per ingredient, per row,
    // per page.
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Imported",
          status: "active",
          effective_status: "active",
          dose_definition: {
            intake: { amount: 1, unit: "pill" },
            active: [{ name: "Сертралин", amount: 150, unit: "u".repeat(400) }],
          },
          schedule: { mode: "daily_times", times: ["08:00"] },
        },
      ],
      total: 1,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    expect(text).not.toContain("u".repeat(200));
    expect(text).toContain("…");
  });

  it("bounds the unit it repeats across slots, stock and the ledger", async () => {
    // `unit` is unrestricted on the dose definition, on the inventory and on
    // `med_inventory_transactions.unit` (plain `text`), and it is the most
    // repeated field this server renders.
    meds.getMedication.mockResolvedValue({
      regimen: {
        custom_name: "Imported",
        effective_status: "active",
        dose_definition: { intake: { amount: 1, unit: "u".repeat(300) } },
        schedule: { mode: "daily_times", times: ["08:00", "20:00"] },
        inventory: { enabled: true, current_amount: 9, unit: "u".repeat(300) },
      },
      upcomingDoses: [],
      recentDoses: [],
      inventoryTransactions: [
        {
          id: "t-1",
          created_at: "2026-08-29T04:09:00+00:00",
          type: "decrement",
          amount: 1,
          unit: "u".repeat(300),
        },
      ],
      inventoryTotal: 1,
    });

    const text = (
      await (await handlers()).get("get_medication")!(
        { regimen_id: "r-1", horizon_days: 7, inventory_offset: 0 },
        ctx(),
      )
    ).content[0].text;

    expect(text).not.toContain("u".repeat(40));
    expect(text).toContain("decrement 1 ");
  });

  it("caps the schedule slots it renders and says how many were left out", async () => {
    // `times` has no maximum in the schema or in the column, so one valid write
    // can put hundreds of slots into a row that a listing renders for every
    // medication on the page.
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Hourly",
          status: "active",
          effective_status: "active",
          dose_definition: { intake: { amount: 1, unit: "pill" } },
          schedule: {
            mode: "daily_times",
            times: Array.from(
              { length: 40 },
              (_, index) => `${String(index % 24).padStart(2, "0")}:00`,
            ),
          },
        },
      ],
      total: 1,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    expect(text).toContain("…28 more");
  });

  it("prints the strength plainly when the intake is the course's own amount", async () => {
    meds.listMedicationDoses.mockResolvedValue({
      doses: [
        {
          scheduled_at: "2026-06-15T08:00:00.000Z",
          medication_name: "Золофт",
          planned_intake: {
            intake: { amount: 1.5, unit: "pill" },
            active: [{ name: "Сертралин", amount: 150, unit: "milligram" }],
          },
          medication_dose: {
            intake: { amount: 1.5, unit: "pill" },
            active: [{ name: "Сертралин", amount: 150, unit: "milligram" }],
          },
          status: "taken",
        },
      ],
      total: 1,
    });

    const text = (
      await (await handlers()).get("list_medication_doses")!(
        { ...PAGE, from: "2026-06-15", to: "2026-06-15" },
        ctx(),
      )
    ).content[0].text;

    expect(text).toContain("Золофт, 1.5 pill (Сертралин 150 milligram) [taken]");
  });

  it("renders a weekly schedule's per-slot amounts", async () => {
    // The generator reads `schedule.amounts` for `days_of_week` too; only the
    // TypeScript type omitted the field, which is why the renderer dropped it.
    meds.listMedications.mockResolvedValue({
      regimens: [
        {
          id: "r-1",
          custom_name: "Метотрексат",
          status: "active",
          effective_status: "active",
          dose_definition: { intake: { amount: 0.5, unit: "pill" } },
          schedule: {
            mode: "days_of_week",
            days_of_week: [1, 4],
            times: ["08:00", "20:00"],
            amounts: [0.5, 1.5],
          },
        },
      ],
      total: 1,
    });

    const text = (await (await handlers()).get("list_medications")!({ ...PAGE }, ctx())).content[0]
      .text;

    expect(text).toContain("on 1, 4 at 08:00 (0.5 pill), 20:00 (1.5 pill)");
  });

  it("cuts a long intake note instead of flooding the page with one", async () => {
    meds.listMedicationDoses.mockResolvedValue({
      doses: [
        {
          scheduled_at: "2026-06-15T08:00:00.000Z",
          medication_name: "Золофт",
          planned_intake: { intake: { amount: 1.5, unit: "pill" } },
          status: "taken",
          note: "з".repeat(400),
        },
      ],
      total: 1,
    });

    const text = (
      await (await handlers()).get("list_medication_doses")!(
        { ...PAGE, from: "2026-06-15", to: "2026-06-15" },
        ctx(),
      )
    ).content[0].text;

    // A hundred intakes each carrying an imported note would crowd out the
    // answer they were meant to support.
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(400);
  });

  it("takes its page and its total from the database, not from what came back", async () => {
    // A range wider than PostgREST's `max_rows` returns a truncated page. If the
    // tool counted those rows it would report the truncation as the total and
    // say there was nothing more, stranding every later intake.
    meds.listMedicationDoses.mockResolvedValue({
      doses: [
        {
          scheduled_at: "2026-06-15T08:00:00.000Z",
          medication_name: "Золофт",
          planned_intake: { intake: { amount: 1.5, unit: "pill" } },
          status: "taken",
        },
      ],
      total: 1743,
    });

    const result = await (await handlers()).get("list_medication_doses")!(
      { limit: 1, offset: 40, from: "2020-01-01", to: "2026-08-29" },
      ctx(),
    );

    const [, params] = meds.listMedicationDoses.mock.calls[0] as [unknown, Record<string, number>];
    expect(params.limit).toBe(1);
    expect(params.offset).toBe(40);
    expect(result.content[0].text).toContain("1743 medication intakes");
    expect(result.content[0].text).toContain("pass offset: 41 to continue");
    expect(result.structuredContent).toMatchObject({
      total: 1743,
      has_more: true,
      next_offset: 41,
    });
  });

  it("filters to one course in the query rather than making the caller sift", async () => {
    meds.listMedicationDoses.mockResolvedValue({ doses: [], total: 0 });

    await (await handlers()).get("list_medication_doses")!(
      {
        ...PAGE,
        from: "2026-07-26",
        to: "2026-08-29",
        regimen_id: "11111111-2222-4333-8444-555555555555",
      },
      ctx(),
    );

    const [, params] = meds.listMedicationDoses.mock.calls[0] as [unknown, Record<string, string>];
    expect(params.regimenId).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("quotes each intake in the zone the header names, not in UTC", async () => {
    regen.readTimezonePreference.mockResolvedValue("Asia/Bangkok");
    meds.listMedicationDoses.mockResolvedValue({
      doses: [
        {
          scheduled_at: "2026-08-24T15:00:00+00:00",
          actual_at: "2026-08-24T15:00:00+00:00",
          taken_at: null,
          medication_name: "Атаракс",
          planned_intake: { intake: { amount: 0.5, unit: "pill" } },
          status: "scheduled",
        },
      ],
      total: 1,
    });

    const result = await (await handlers()).get("list_medication_doses")!(
      { ...PAGE, from: "2026-08-24", to: "2026-08-24" },
      ctx(),
    );

    // The course is scheduled for 22:00 local. Printing the stored 15:00Z under
    // a header naming the local zone is the defect this test exists for: an
    // assistant read it as a 15:00 dose and refused to move a 22:00 one (T-0027).
    expect(result.content[0].text).toContain("2026-08-24 22:00 +07:00");
    expect(result.content[0].text).not.toContain("2026-08-24 15:00");
  });

  it("carries the zone and the local readings in the payload", async () => {
    regen.readTimezonePreference.mockResolvedValue("Asia/Bangkok");
    meds.listMedicationDoses.mockResolvedValue({
      doses: [
        {
          scheduled_at: "2026-08-24T15:00:00+00:00",
          actual_at: "2026-08-24T15:00:00+00:00",
          taken_at: "2026-08-24T16:33:47+00:00",
          medication_name: "Атаракс",
          planned_intake: null,
          status: "taken",
        },
      ],
      total: 1,
    });

    const result = await (await handlers()).get("list_medication_doses")!(
      { ...PAGE, from: "2026-08-24", to: "2026-08-24" },
      ctx(),
    );

    expect(result.structuredContent).toMatchObject({ timezone: "Asia/Bangkok" });
    expect((result.structuredContent?.doses as Array<Record<string, unknown>>)[0]).toMatchObject({
      scheduled_at: "2026-08-24T15:00:00+00:00",
      scheduled_at_local: "2026-08-24T22:00:00+07:00",
      taken_at_local: "2026-08-24T23:33:47+07:00",
    });
  });

  it("refuses a timezone it cannot resolve rather than answering in UTC", async () => {
    const result = await (await handlers()).get("list_medication_doses")!(
      { ...PAGE, from: "2026-08-24", to: "2026-08-24", timezone: "Mars/Olympus" },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(meds.listMedicationDoses).not.toHaveBeenCalled();
  });
});

describe("add_medication", () => {
  const args = {
    custom_name: "Ferrous sulfate",
    intake_unit: "pill",
    dose_definition: { intake: { amount: 1, unit: "pill" } },
    schedule: { mode: "daily_times", times: ["08:00"] },
    duration: { type: "endless" },
  };

  it("creates the regimen and regenerates its intakes", async () => {
    meds.createRegimen.mockResolvedValue({ id: "r-1", custom_name: "Ferrous sulfate" });

    const result = await (await handlers()).get("add_medication")!(args, ctx());

    expect(meds.createRegimen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ person_id: "p-1", status: "active", intake_advice_type: "none" }),
    );
    expect(regen.regenerateDoseEvents).toHaveBeenCalled();
    expect(result.content[0].text).toContain("generated 14 upcoming intake(s)");
  });

  it("refuses on a read-only grant, before writing anything", async () => {
    const result = await (await handlers()).get("add_medication")!(args, ctx(["health:read"]));

    expect(result.isError).toBe(true);
    expect(meds.createRegimen).not.toHaveBeenCalled();
  });

  it("refuses when a course of that name is still running, naming every match", async () => {
    meds.findRegimensByName.mockResolvedValue([
      {
        id: "r-live",
        custom_name: "Ferrous sulfate",
        effective_status: "active",
        dose_definition: { intake: { amount: 1, unit: "pill" } },
        schedule: { mode: "daily_times" },
      },
      {
        id: "r-old",
        custom_name: "Ferrous sulfate",
        effective_status: "archived",
        dose_definition: null,
        schedule: null,
      },
    ]);

    const result = await (await handlers()).get("add_medication")!(args, ctx());

    // A duplicate medication is exactly the bug this guard exists for: a
    // one-off intake must land on the running course, not beside it.
    expect(result.isError).toBe(true);
    expect(meds.createRegimen).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("id r-live");
    // The finished one is context, not a reason to refuse -- but the caller
    // should still see it before deciding.
    expect(result.content[0].text).toContain("id r-old");
    expect(result.content[0].text).toContain("already finished");
    expect(result.content[0].text).toContain("log_dose");
    expect(
      (result.structuredContent?.existing_medications as Array<{ id: string }>).map((r) => r.id),
    ).toEqual(["r-live", "r-old"]);
  });

  it("allows a new course when every match of that name has finished", async () => {
    // Titration and re-prescription are recorded as successive courses. Atarax
    // in 2025 does not make Atarax in 2026 a mistake, and neither log_dose nor
    // update_medication is the right home for it: one would file today's intake
    // against last year's course, the other would overwrite what that course
    // actually was.
    meds.findRegimensByName.mockResolvedValue([
      {
        id: "r-old",
        custom_name: "Ferrous sulfate",
        effective_status: "completed",
        dose_definition: null,
        schedule: null,
      },
    ]);

    const result = await (await handlers()).get("add_medication")!(args, ctx());

    expect(result.isError).toBeFalsy();
    expect(meds.createRegimen).toHaveBeenCalled();
  });

  it("creates anyway with allow_duplicate, and still names what it now sits beside", async () => {
    meds.findRegimensByName.mockResolvedValue([
      {
        id: "r-old",
        custom_name: "Ferrous sulfate",
        effective_status: "completed",
        dose_definition: null,
        schedule: null,
      },
    ]);
    meds.createRegimen.mockResolvedValue({ id: "r-1", custom_name: "Ferrous sulfate" });

    const result = await (await handlers()).get("add_medication")!(
      { ...args, allow_duplicate: true },
      ctx(),
    );

    expect(result.isError).toBeUndefined();
    expect(meds.createRegimen).toHaveBeenCalled();
    expect(result.content[0].text).toContain("r-old");
  });

  it("checks for duplicates before writing, not after", async () => {
    meds.findRegimensByName.mockResolvedValue([
      { id: "r-old", custom_name: "Ferrous sulfate", effective_status: "active" },
    ]);

    await (await handlers()).get("add_medication")!(args, ctx());

    expect(meds.findRegimensByName).toHaveBeenCalledWith(expect.anything(), {
      personId: "p-1",
      name: "Ferrous sulfate",
    });
    expect(regen.regenerateDoseEvents).not.toHaveBeenCalled();
  });

  it("reports partial success when regeneration fails after the save", async () => {
    meds.createRegimen.mockResolvedValue({ id: "r-1", custom_name: "Ferrous sulfate" });
    regen.regenerateDoseEvents.mockRejectedValue(new Error("generator down"));

    const result = await (await handlers()).get("add_medication")!(args, ctx());

    // The medication IS saved; saying "error" flatly would read as "nothing
    // happened" and invite a retry of the whole operation.
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("generator down");
    expect(result.content[0].text).toContain("medication is saved");
    expect(result.structuredContent?.dose_events_error).toBe("generator down");
  });
});

describe("update_medication", () => {
  it("sends only the fields supplied, so omissions do not null out data", async () => {
    meds.updateRegimen.mockResolvedValue({
      id: "r-1",
      person_id: "p-1",
      custom_name: "Ferrous sulfate",
      effective_status: "paused",
    });

    await (await handlers()).get("update_medication")!(
      { regimen_id: "r-1", status: "paused", notes: undefined },
      ctx(),
    );

    const [, , values] = meds.updateRegimen.mock.calls[0] as [
      unknown,
      string,
      Record<string, unknown>,
    ];
    expect(values).toEqual({ status: "paused" });
    expect(values).not.toHaveProperty("notes");
  });

  it("rejects an update with nothing to change", async () => {
    const result = await (await handlers()).get("update_medication")!({ regimen_id: "r-1" }, ctx());

    expect(result.isError).toBe(true);
    expect(meds.updateRegimen).not.toHaveBeenCalled();
  });

  it("does not treat the timezone as a field to update", async () => {
    meds.updateRegimen.mockResolvedValue({
      id: "r-1",
      person_id: "p-1",
      custom_name: "X",
      effective_status: "active",
    });

    const result = await (await handlers()).get("update_medication")!(
      { regimen_id: "r-1", timezone: "Asia/Tokyo" },
      ctx(),
    );

    // timezone steers regeneration; on its own there is nothing to change.
    expect(result.isError).toBe(true);
  });

  it("refuses on a read-only grant", async () => {
    const result = await (await handlers()).get("update_medication")!(
      { regimen_id: "r-1", status: "paused" },
      ctx(["health:read"]),
    );

    expect(result.isError).toBe(true);
    expect(meds.updateRegimen).not.toHaveBeenCalled();
  });

  it("reports partial success when regeneration fails after the update", async () => {
    meds.updateRegimen.mockResolvedValue({
      id: "r-1",
      person_id: "p-1",
      custom_name: "Ferrous sulfate",
      effective_status: "active",
    });
    regen.regenerateDoseEvents.mockRejectedValue(new Error("generator down"));

    const result = await (await handlers()).get("update_medication")!(
      { regimen_id: "r-1", status: "active" },
      ctx(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("reminders may be stale");
  });
});

describe("log_dose", () => {
  const dose = {
    id: "d-1",
    status: "taken",
    planned_intake: { intake: { amount: 0.5, unit: "pill" } },
  };

  beforeEach(() => {
    meds.logDose.mockResolvedValue({
      regimen: { id: "r-1", custom_name: "Атаракс", effective_status: "completed" },
      dose,
      planned: false,
    });
  });

  it("records the intake against the regimen it was given", async () => {
    const result = await (await handlers()).get("log_dose")!(
      { regimen_id: "r-1", taken_at: "2026-08-19T23:10:00+07:00", amount: 0.5, status: "taken" },
      ctx(),
    );

    expect(meds.logDose).toHaveBeenCalledWith(expect.anything(), {
      regimenId: "r-1",
      at: "2026-08-19T16:10:00.000Z",
      amount: 0.5,
      status: "taken",
      note: null,
    });
    expect(result.content[0].text).toContain("0.5 pill of Атаракс as taken");
  });

  it("logging an intake does not regenerate the plan", async () => {
    await (await handlers()).get("log_dose")!({ regimen_id: "r-1", status: "taken" }, ctx());

    // The schedule did not change, so the upcoming events are still correct.
    expect(regen.regenerateDoseEvents).not.toHaveBeenCalled();
  });

  it("defaults the time to now and leaves the amount to the regimen", async () => {
    await (await handlers()).get("log_dose")!({ regimen_id: "r-1", status: "taken" }, ctx());

    const [, params] = meds.logDose.mock.calls[0] as [
      unknown,
      { at: string; amount: number | null },
    ];
    expect(params.amount).toBeNull();
    expect(Date.parse(params.at)).toBeCloseTo(Date.now(), -4);
  });

  it("rejects a time it cannot read instead of filing the dose on the wrong day", async () => {
    const result = await (await handlers()).get("log_dose")!(
      { regimen_id: "r-1", taken_at: "yesterday evening", status: "taken" },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(meds.logDose).not.toHaveBeenCalled();
  });

  it("rejects non-ISO input that Date would happily accept", async () => {
    // `new Date("0")` is a valid date in the year 2000, so a NaN check alone
    // does not enforce the contract the description states.
    const result = await (await handlers()).get("log_dose")!(
      { regimen_id: "r-1", taken_at: "0", status: "taken" },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(meds.logDose).not.toHaveBeenCalled();
  });

  it("reads an offset-less time in the user's timezone, not the server's", async () => {
    const result = await (await handlers()).get("log_dose")!(
      {
        regimen_id: "r-1",
        taken_at: "2026-08-19T23:10",
        timezone: "Asia/Bangkok",
        status: "taken",
      },
      ctx(),
    );

    // Production runs in UTC; reading this there would move the intake 7 hours
    // and onto the previous local day.
    const [, params] = meds.logDose.mock.calls[0] as [unknown, { at: string }];
    expect(params.at).toBe("2026-08-19T16:10:00.000Z");
    expect(result.content[0].text).toContain("Asia/Bangkok");
  });

  it("falls back to the saved timezone when none is passed", async () => {
    await (await handlers()).get("log_dose")!(
      { regimen_id: "r-1", taken_at: "2026-08-19T23:10", status: "taken" },
      ctx(),
    );

    expect(regen.readTimezonePreference).toHaveBeenCalledWith(
      expect.anything(),
      "11111111-1111-1111-1111-111111111111",
    );
    // Never the resolving variant: it would persist the zone and re-time the
    // household's generated events and reminders.
    expect(regen.resolveTimezone).not.toHaveBeenCalled();
    // The beforeEach stub resolves Europe/Berlin, which is UTC+2 in August.
    const [, params] = meds.logDose.mock.calls[0] as [unknown, { at: string }];
    expect(params.at).toBe("2026-08-19T21:10:00.000Z");
  });

  it("reads the saved zone even for an offset-bearing time, to quote it back", async () => {
    await (await handlers()).get("log_dose")!(
      { regimen_id: "r-1", taken_at: "2026-08-19T23:10:00+07:00", status: "taken" },
      ctx(),
    );

    // The instant needs no zone, but the confirmation does: reporting it back
    // in UTC is how "I took it at 22:00" came back as "...at 15:00Z" (T-0027).
    // Reading the preference is free of side effects; resolving it is not.
    expect(regen.readTimezonePreference).toHaveBeenCalled();
    expect(regen.resolveTimezone).not.toHaveBeenCalled();
  });

  it("quotes the intake back in the caller's zone, never in UTC", async () => {
    const result = await (await handlers()).get("log_dose")!(
      {
        regimen_id: "r-1",
        taken_at: "2026-08-24T22:00",
        timezone: "Asia/Bangkok",
        status: "taken",
      },
      ctx(),
    );

    // Stored as 15:00Z. Quoting that instant raw is the whole defect.
    expect(result.content[0].text).toContain("2026-08-24 22:00 +07:00");
    expect(result.content[0].text).toContain("Asia/Bangkok");
    expect(result.content[0].text).not.toContain("15:00");
  });

  it("offers the local reading beside the stored instant in the payload", async () => {
    meds.logDose.mockResolvedValue({
      regimen: { id: "r-1", custom_name: "Атаракс", effective_status: "active" },
      dose: {
        id: "d-1",
        status: "taken",
        scheduled_at: "2026-08-24T15:00:00+00:00",
        taken_at: "2026-08-24T15:04:00+00:00",
        planned_intake: { intake: { amount: 0.5, unit: "pill" } },
      },
      planned: true,
    });

    const result = await (await handlers()).get("log_dose")!(
      { regimen_id: "r-1", timezone: "Asia/Bangkok", status: "taken" },
      ctx(),
    );

    expect(result.structuredContent).toMatchObject({
      timezone: "Asia/Bangkok",
      dose: {
        // Additive: whatever already parses the ISO instant keeps working.
        scheduled_at: "2026-08-24T15:00:00+00:00",
        scheduled_at_local: "2026-08-24T22:00:00+07:00",
        taken_at_local: "2026-08-24T22:04:00+07:00",
      },
    });
  });

  it("never persists the timezone it was handed", async () => {
    await (await handlers()).get("log_dose")!(
      {
        regimen_id: "r-1",
        taken_at: "2026-08-19T23:10",
        timezone: "Asia/Tokyo",
        status: "taken",
      },
      ctx(),
    );

    // `resolveTimezone` upserts `checkup_notification_timezone`, which the
    // nightly generation and both reminder digests run on. Logging history
    // must not move the plan.
    expect(regen.resolveTimezone).not.toHaveBeenCalled();
    const [, params] = meds.logDose.mock.calls[0] as [unknown, { at: string }];
    expect(params.at).toBe("2026-08-19T14:10:00.000Z");
  });

  it("refuses a timezone it cannot resolve rather than silently using UTC", async () => {
    const result = await (await handlers()).get("log_dose")!(
      {
        regimen_id: "r-1",
        taken_at: "2026-08-19T23:10",
        timezone: "Mars/Olympus",
        status: "taken",
      },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(meds.logDose).not.toHaveBeenCalled();
  });

  it("refuses a local time that does not exist in the zone", async () => {
    // 02:30 on a spring-forward night. Accepting it would file the intake an
    // hour off, and in some zones on the previous day.
    const result = await (await handlers()).get("log_dose")!(
      {
        regimen_id: "r-1",
        taken_at: "2026-03-29T02:30",
        timezone: "Europe/Berlin",
        status: "taken",
      },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(meds.logDose).not.toHaveBeenCalled();
  });

  it("reports an already-recorded dose as written nothing", async () => {
    meds.logDose.mockResolvedValue({
      regimen: { id: "r-1", custom_name: "Атаракс", effective_status: "active" },
      dose: { id: "d-1", status: "taken", planned_intake: { intake: { amount: 1, unit: "pill" } } },
      planned: true,
      alreadyRecorded: true,
    });

    const result = await (await handlers()).get("log_dose")!(
      { regimen_id: "r-1", taken_at: "2026-08-19T23:10:00Z", status: "taken" },
      ctx(),
    );

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("already recorded");
    expect(result.content[0].text).toContain("nothing was written");
    expect(result.structuredContent).toMatchObject({ already_recorded: true });
  });

  it("says whether the intake resolved a planned dose or was an extra", async () => {
    meds.logDose.mockResolvedValue({
      regimen: { id: "r-1", custom_name: "Атаракс", effective_status: "active" },
      dose,
      planned: true,
    });

    const result = await (await handlers()).get("log_dose")!(
      { regimen_id: "r-1", status: "taken" },
      ctx(),
    );

    expect(result.content[0].text).toContain("resolved the dose already on the plan");
    expect(result.structuredContent?.planned).toBe(true);
  });

  it("refuses on a read-only grant", async () => {
    const result = await (await handlers()).get("log_dose")!(
      { regimen_id: "r-1", status: "taken" },
      ctx(["health:read"]),
    );

    expect(result.isError).toBe(true);
    expect(meds.logDose).not.toHaveBeenCalled();
  });

  it("reports a missing medication as an error the model can act on", async () => {
    meds.logDose.mockRejectedValue(new Error("No medication with id r-9."));

    const result = await (await handlers()).get("log_dose")!(
      { regimen_id: "r-9", status: "taken" },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No medication with id r-9.");
  });
});
