import { describe, expect, it } from "vitest";
import {
  createRegimen,
  getMedication,
  listMedicationDoses,
  listMedications,
  updateRegimen,
} from "./medications";
import { createSupabaseStub } from "./test-support";

function regimen(overrides: Record<string, unknown> = {}) {
  return {
    id: "r-1",
    person_id: "p-1",
    custom_name: "Ferrous sulfate",
    status: "active",
    intake_unit: "pill",
    dose_definition: { intake: { amount: 1, unit: "pill" } },
    intake_advice_type: "none",
    intake_advice_text: null,
    schedule: { mode: "daily_times", times: ["08:00"] },
    duration: { type: "endless" },
    reminder_prefs: null,
    inventory: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function doseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "d-1",
    person_id: "p-1",
    regimen_id: "r-1",
    scheduled_at: "2026-06-15T08:00:00Z",
    actual_at: "2026-06-15T08:00:00Z",
    planned_intake: { intake: { amount: 1, unit: "pill" }, active: [] },
    status: "scheduled",
    taken_at: null,
    note: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("listMedications", () => {
  it("excludes soft-deleted regimens and archived ones by default", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: [] }] });
    await listMedications(stub.client, { personId: "p-1" });

    expect(stub.argsFor("med_regimens", "is")).toEqual([["deleted_at", null]]);
    expect(stub.argsFor("med_regimens", "neq")).toEqual([["status", "archived"]]);
  });

  it("includes archived when asked", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: [] }] });
    await listMedications(stub.client, { personId: "p-1", includeArchived: true });

    expect(stub.argsFor("med_regimens", "neq")).toHaveLength(0);
  });

  it("an explicit status filter takes precedence over the archived default", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: [] }] });
    await listMedications(stub.client, { personId: "p-1", status: "paused" });

    expect(stub.argsFor("med_regimens", "eq")).toEqual(
      expect.arrayContaining([["status", "paused"]]),
    );
    expect(stub.argsFor("med_regimens", "neq")).toHaveLength(0);
  });

  it("reports a finished course as completed even when stored active", async () => {
    const stub = createSupabaseStub({
      med_regimens: [
        {
          data: [
            regimen({ id: "ongoing" }),
            regimen({
              id: "ended",
              duration: { type: "until_date", end_date: "2020-01-01" },
            }),
          ],
        },
      ],
    });

    const rows = await listMedications(stub.client, { personId: "p-1" });

    expect(rows[0].effective_status).toBe("active");
    // The UI shows this as completed; the tool must agree.
    expect(rows[1].effective_status).toBe("completed");
    expect(rows[1].status).toBe("active");
  });

  it("filters by name in memory, case-insensitively", async () => {
    const stub = createSupabaseStub({
      med_regimens: [
        {
          data: [
            regimen({ custom_name: "Ferrous sulfate" }),
            regimen({ custom_name: "Vitamin D" }),
          ],
        },
      ],
    });

    const rows = await listMedications(stub.client, { personId: "p-1", search: "FERROUS" });
    expect(rows.map((r) => r.custom_name)).toEqual(["Ferrous sulfate"]);
  });

  it("ignores a whitespace-only search", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: [regimen(), regimen()] }] });
    const rows = await listMedications(stub.client, { personId: "p-1", search: "  " });
    expect(rows).toHaveLength(2);
  });

  it("surfaces a query error", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ error: { message: "boom" } }] });
    await expect(listMedications(stub.client, { personId: "p-1" })).rejects.toThrow(
      /Failed to load medications/,
    );
  });
});

describe("getMedication", () => {
  it("splits doses into upcoming and recent around now", async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();

    const stub = createSupabaseStub({
      med_regimens: [{ data: regimen() }],
      med_dose_events: [
        {
          data: [
            doseEvent({ id: "past", scheduled_at: past }),
            doseEvent({ id: "future", scheduled_at: future }),
          ],
        },
      ],
      med_inventory_transactions: [{ data: [] }],
    });

    const result = await getMedication(stub.client, { regimenId: "r-1", horizonDays: 7 });

    expect(result?.upcomingDoses.map((d) => d.id)).toEqual(["future"]);
    expect(result?.recentDoses.map((d) => d.id)).toEqual(["past"]);
  });

  it("returns null for an unknown or deleted regimen without further queries", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: null }] });

    await expect(
      getMedication(stub.client, { regimenId: "nope", horizonDays: 7 }),
    ).resolves.toBeNull();
    expect(stub.argsFor("med_dose_events", "select")).toHaveLength(0);
  });

  it("tolerates null dose and inventory results", async () => {
    const stub = createSupabaseStub({
      med_regimens: [{ data: regimen() }],
      med_dose_events: [{ data: null }],
      med_inventory_transactions: [{ data: null }],
    });

    const result = await getMedication(stub.client, { regimenId: "r-1", horizonDays: 7 });

    expect(result?.upcomingDoses).toEqual([]);
    expect(result?.inventoryTransactions).toEqual([]);
  });

  it("windows doses symmetrically around now", async () => {
    const stub = createSupabaseStub({
      med_regimens: [{ data: regimen() }],
      med_dose_events: [{ data: [] }],
      med_inventory_transactions: [{ data: [] }],
    });

    await getMedication(stub.client, { regimenId: "r-1", horizonDays: 3 });

    const [[, lower]] = stub.argsFor("med_dose_events", "gte") as [[string, string]];
    const [[, upper]] = stub.argsFor("med_dose_events", "lte") as [[string, string]];
    const span = Date.parse(upper) - Date.parse(lower);
    expect(Math.round(span / 86_400_000)).toBe(6);
  });

  it("surfaces a query error", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ error: { message: "boom" } }] });
    await expect(getMedication(stub.client, { regimenId: "r-1", horizonDays: 7 })).rejects.toThrow(
      /Failed to load medication/,
    );
  });
});

describe("listMedicationDoses", () => {
  it("joins the medication name onto each intake", async () => {
    const stub = createSupabaseStub({
      med_dose_events: [
        { data: [{ ...doseEvent(), regimen: { custom_name: "Ferrous sulfate" } }] },
      ],
    });

    const rows = await listMedicationDoses(stub.client, {
      personId: "p-1",
      from: "2026-06-15T00:00:00Z",
      to: "2026-06-15T23:59:59Z",
    });

    expect(rows[0].medication_name).toBe("Ferrous sulfate");
  });

  it("falls back to null when the join is missing", async () => {
    const stub = createSupabaseStub({ med_dose_events: [{ data: [doseEvent()] }] });

    const rows = await listMedicationDoses(stub.client, {
      personId: "p-1",
      from: "a",
      to: "b",
    });

    expect(rows[0].medication_name).toBeNull();
  });

  it("applies the status filter and excludes deleted events", async () => {
    const stub = createSupabaseStub({ med_dose_events: [{ data: [] }] });
    await listMedicationDoses(stub.client, {
      personId: "p-1",
      from: "a",
      to: "b",
      status: "taken",
    });

    expect(stub.argsFor("med_dose_events", "eq")).toEqual(
      expect.arrayContaining([
        ["person_id", "p-1"],
        ["status", "taken"],
      ]),
    );
    expect(stub.argsFor("med_dose_events", "is")).toEqual([["deleted_at", null]]);
  });

  it("surfaces a query error", async () => {
    const stub = createSupabaseStub({ med_dose_events: [{ error: { message: "boom" } }] });
    await expect(
      listMedicationDoses(stub.client, { personId: "p-1", from: "a", to: "b" }),
    ).rejects.toThrow(/Failed to load medication intakes/);
  });
});

describe("createRegimen / updateRegimen", () => {
  it("returns the created regimen with its effective status", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: regimen() }] });

    await expect(createRegimen(stub.client, { custom_name: "X" })).resolves.toMatchObject({
      id: "r-1",
      effective_status: "active",
    });
  });

  it("surfaces a create error", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ error: { message: "boom" } }] });
    await expect(createRegimen(stub.client, {})).rejects.toThrow(/Failed to create medication/);
  });

  it("surfaces a silent no-row create", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: null }] });
    await expect(createRegimen(stub.client, {})).rejects.toThrow(/no row returned/);
  });

  it("updates only a live regimen", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: regimen() }] });

    await updateRegimen(stub.client, "r-1", { custom_name: "Y" });

    expect(stub.argsFor("med_regimens", "eq")).toEqual([["id", "r-1"]]);
    expect(stub.argsFor("med_regimens", "is")).toEqual([["deleted_at", null]]);
  });

  it("reports a missing regimen on update", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: null }] });
    await expect(updateRegimen(stub.client, "nope", {})).rejects.toThrow(
      /No medication with id nope/,
    );
  });

  it("surfaces an update error", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ error: { message: "boom" } }] });
    await expect(updateRegimen(stub.client, "r-1", {})).rejects.toThrow(
      /Failed to update medication/,
    );
  });
});
