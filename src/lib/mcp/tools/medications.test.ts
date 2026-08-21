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

  it("refuses when the person already has a medication with that name, naming every match", async () => {
    meds.findRegimensByName.mockResolvedValue([
      {
        id: "r-old",
        custom_name: "Ferrous sulfate",
        effective_status: "completed",
        dose_definition: { intake: { amount: 1, unit: "pill" } },
        schedule: { mode: "daily_times" },
      },
      {
        id: "r-older",
        custom_name: "Ferrous sulfate",
        effective_status: "archived",
        dose_definition: null,
        schedule: null,
      },
    ]);

    const result = await (await handlers()).get("add_medication")!(args, ctx());

    // A duplicate medication is exactly the bug this guard exists for: a
    // one-off intake must land on the existing course, not beside it.
    expect(result.isError).toBe(true);
    expect(meds.createRegimen).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("id r-old");
    expect(result.content[0].text).toContain("id r-older");
    expect(result.content[0].text).toContain("log_dose");
    expect(
      (result.structuredContent?.existing_medications as Array<{ id: string }>).map((r) => r.id),
    ).toEqual(["r-old", "r-older"]);
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
    regen.resolveTimezone.mockResolvedValue("Asia/Bangkok");

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

    expect(regen.resolveTimezone).toHaveBeenCalledWith(expect.anything(), {
      authUserId: "11111111-1111-1111-1111-111111111111",
      requestedTimezone: null,
    });
    // The beforeEach stub resolves Europe/Berlin, which is UTC+2 in August.
    const [, params] = meds.logDose.mock.calls[0] as [unknown, { at: string }];
    expect(params.at).toBe("2026-08-19T21:10:00.000Z");
  });

  it("does not consult a timezone for a time that carries its own offset", async () => {
    await (await handlers()).get("log_dose")!(
      { regimen_id: "r-1", taken_at: "2026-08-19T23:10:00+07:00", status: "taken" },
      ctx(),
    );

    expect(regen.resolveTimezone).not.toHaveBeenCalled();
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
