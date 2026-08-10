import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpToolServer } from "./types";

const meds = vi.hoisted(() => ({
  listMedications: vi.fn(),
  getMedication: vi.fn(),
  listMedicationDoses: vi.fn(),
  createRegimen: vi.fn(),
  updateRegimen: vi.fn(),
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
