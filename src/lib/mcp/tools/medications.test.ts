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
    meds.listMedications.mockResolvedValue([
      {
        id: "r-1",
        custom_name: "Ferrous sulfate",
        status: "active",
        effective_status: "completed",
        dose_definition: { intake: { amount: 1, unit: "pill" } },
        schedule: { mode: "daily_times" },
      },
    ]);

    const result = await (await handlers()).get("list_medications")!({}, ctx());

    expect(result.content[0].text).toContain("Ferrous sulfate — completed, 1 pill");
  });

  it("copes with a regimen that has no dose or schedule recorded", async () => {
    meds.listMedications.mockResolvedValue([
      {
        id: "r-1",
        custom_name: "Unknown",
        status: "active",
        effective_status: "active",
        dose_definition: null,
        schedule: null,
      },
    ]);

    const result = await (await handlers()).get("list_medications")!({}, ctx());

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
      { regimen_id: "r-1", horizon_days: 7 },
      ctx(),
    );

    expect(result.content[0].text).toContain("2 upcoming dose(s), 1 in the recent window");
  });

  it("reports an unknown regimen", async () => {
    meds.getMedication.mockResolvedValue(null);

    const result = await (await handlers()).get("get_medication")!(
      { regimen_id: "nope", horizon_days: 7 },
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
      { regimen_id: "r-1", horizon_days: 7 },
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

  it("refuses a timezone it cannot resolve rather than answering in UTC", async () => {
    const result = await (await handlers()).get("get_medication")!(
      { regimen_id: "r-1", horizon_days: 7, timezone: "Mars/Olympus" },
      ctx(),
    );

    expect(result.isError).toBe(true);
    expect(meds.getMedication).not.toHaveBeenCalled();
  });
});

describe("list_medication_doses", () => {
  it("resolves the local day rather than assuming UTC", async () => {
    meds.listMedicationDoses.mockResolvedValue([]);

    await (await handlers()).get("list_medication_doses")!(
      { from: "2026-06-15", to: "2026-06-15" },
      ctx(),
    );

    const [, params] = meds.listMedicationDoses.mock.calls[0] as [unknown, Record<string, string>];
    // Berlin is UTC+2 in June, so the local day starts at 22:00 the day before.
    expect(params.from).toBe("2026-06-14T22:00:00.000Z");
    expect(params.to).toBe("2026-06-15T21:59:59.999Z");
  });

  it("names the timezone it used, so the answer is checkable", async () => {
    meds.listMedicationDoses.mockResolvedValue([]);

    const result = await (await handlers()).get("list_medication_doses")!(
      { from: "2026-06-15", to: "2026-06-15" },
      ctx(),
    );

    expect(result.content[0].text).toContain("Europe/Berlin");
  });

  it("renders an intake with its amount and status", async () => {
    meds.listMedicationDoses.mockResolvedValue([
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
    ]);

    const result = await (await handlers()).get("list_medication_doses")!(
      { from: "2026-06-15", to: "2026-06-15" },
      ctx(),
    );

    expect(result.content[0].text).toContain("Ferrous sulfate, 1 pill [taken]");
    expect(result.content[0].text).toContain("unknown [scheduled]");
  });

  it("quotes each intake in the zone the header names, not in UTC", async () => {
    regen.readTimezonePreference.mockResolvedValue("Asia/Bangkok");
    meds.listMedicationDoses.mockResolvedValue([
      {
        scheduled_at: "2026-08-24T15:00:00+00:00",
        actual_at: "2026-08-24T15:00:00+00:00",
        taken_at: null,
        medication_name: "Атаракс",
        planned_intake: { intake: { amount: 0.5, unit: "pill" } },
        status: "scheduled",
      },
    ]);

    const result = await (await handlers()).get("list_medication_doses")!(
      { from: "2026-08-24", to: "2026-08-24" },
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
    meds.listMedicationDoses.mockResolvedValue([
      {
        scheduled_at: "2026-08-24T15:00:00+00:00",
        actual_at: "2026-08-24T15:00:00+00:00",
        taken_at: "2026-08-24T16:33:47+00:00",
        medication_name: "Атаракс",
        planned_intake: null,
        status: "taken",
      },
    ]);

    const result = await (await handlers()).get("list_medication_doses")!(
      { from: "2026-08-24", to: "2026-08-24" },
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
      { from: "2026-08-24", to: "2026-08-24", timezone: "Mars/Olympus" },
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
