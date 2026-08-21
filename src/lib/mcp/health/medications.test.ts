import { describe, expect, it } from "vitest";
import {
  createRegimen,
  findRegimensByName,
  getMedication,
  listMedicationDoses,
  listMedications,
  logDose,
  updateRegimen,
} from "./medications";
import { createSupabaseStub, type StubResult } from "./test-support";

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

describe("findRegimensByName", () => {
  it("matches on the trimmed, lower-cased name, archived courses included", async () => {
    const stub = createSupabaseStub({
      med_regimens: [
        {
          data: [
            regimen({ id: "live", custom_name: "Атаракс" }),
            regimen({ id: "archived", custom_name: " атаракс ", status: "archived" }),
            regimen({ id: "other", custom_name: "Атаракс форте" }),
          ],
        },
      ],
    });

    const rows = await findRegimensByName(stub.client, { personId: "p-1", name: "  АТАРАКС " });

    // "Атаракс форте" is a different medication, not a spelling of this one.
    expect(rows.map((r) => r.id)).toEqual(["live", "archived"]);
    // Archived courses stay in the pool: a dose can be logged against one.
    expect(stub.argsFor("med_regimens", "neq")).toHaveLength(0);
  });

  it("does not query at all for an empty name", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: [regimen()] }] });

    await expect(findRegimensByName(stub.client, { personId: "p-1", name: "  " })).resolves.toEqual(
      [],
    );
    expect(stub.calls).toHaveLength(0);
  });
});

describe("logDose", () => {
  function stubFor(
    overrides: Record<string, unknown> = {},
    rpc: Record<string, StubResult> = {},
    planned: StubResult = { data: null },
  ) {
    return createSupabaseStub(
      {
        med_regimens: [{ data: regimen(overrides) }],
        med_dose_events: [
          // The same-minute planned-dose probe, then the insert, then the re-read.
          planned,
          { data: doseEvent() },
          { data: doseEvent({ status: "taken", taken_at: "2026-06-15T08:00:00Z" }) },
        ],
      },
      rpc,
    );
  }

  it("files the intake against the existing regimen and resolves it through the RPC", async () => {
    const stub = stubFor();

    const result = await logDose(stub.client, {
      regimenId: "r-1",
      at: "2026-06-15T08:00:00.000Z",
      status: "taken",
    });

    const [[values]] = stub.argsFor("med_dose_events", "insert") as [[Record<string, unknown>]];
    expect(values).toMatchObject({
      person_id: "p-1",
      regimen_id: "r-1",
      scheduled_at: "2026-06-15T08:00:00.000Z",
      // The UI sets both, and the reminder payload reads actual_at.
      actual_at: "2026-06-15T08:00:00.000Z",
      status: "scheduled",
    });
    // Inserting `taken` directly would skip the RPC that writes the inventory
    // transaction and decrements stock.
    expect(stub.rpc).toHaveBeenCalledWith("mark_dose_taken", { p_dose_event_id: "d-1" });
    expect(result.dose.status).toBe("taken");
    expect(result.regimen.effective_status).toBe("active");
    expect(result.planned).toBe(false);
  });

  it("resolves the dose already planned for that minute instead of inserting a second one", async () => {
    const stub = stubFor(
      {},
      {},
      { data: doseEvent({ id: "planned-1", scheduled_at: "2026-06-15T08:00:30Z" }) },
    );

    const result = await logDose(stub.client, {
      regimenId: "r-1",
      at: "2026-06-15T08:00:00.000Z",
      status: "taken",
    });

    // idx_med_dose_events_regimen_scheduled_minute uniquely indexes unresolved
    // events per regimen per minute, so an insert here would fail outright --
    // and "I took my 08:00 pill" is the most ordinary call there is.
    expect(stub.argsFor("med_dose_events", "insert")).toHaveLength(0);
    expect(stub.rpc).toHaveBeenCalledWith("mark_dose_taken", { p_dose_event_id: "planned-1" });
    expect(result.planned).toBe(true);
  });

  it("probes only the minute the intake falls in, among unresolved events", async () => {
    const stub = stubFor();

    await logDose(stub.client, {
      regimenId: "r-1",
      at: "2026-06-15T08:00:45.123Z",
      status: "taken",
    });

    expect(stub.argsFor("med_dose_events", "gte")).toEqual([
      ["scheduled_at", "2026-06-15T08:00:00.000Z"],
    ]);
    expect(stub.argsFor("med_dose_events", "lt")).toEqual([
      ["scheduled_at", "2026-06-15T08:01:00.000Z"],
    ]);
    expect(stub.argsFor("med_dose_events", "in")).toEqual([["status", ["scheduled", "sent"]]]);
  });

  it("takes the planned event's per-slot amount over the regimen default", async () => {
    const stub = stubFor(
      { dose_definition: { intake: { amount: 2, unit: "pill" } } },
      {},
      {
        data: doseEvent({
          id: "planned-1",
          planned_intake: { intake: { amount: 0.5, unit: "pill" }, active: [] },
        }),
      },
    );

    const result = await logDose(stub.client, {
      regimenId: "r-1",
      at: "2026-06-15T08:00:00.000Z",
      status: "taken",
    });

    // A daily_times schedule can plan a different amount per slot.
    expect(stub.argsFor("med_dose_events", "update")).toHaveLength(0);
    expect(result.planned).toBe(true);
  });

  it("amends a planned dose only when the caller corrected the amount", async () => {
    const stub = stubFor(
      {},
      {},
      {
        data: doseEvent({
          id: "planned-1",
          planned_intake: { intake: { amount: 1, unit: "pill" }, active: [] },
        }),
      },
    );

    await logDose(stub.client, {
      regimenId: "r-1",
      at: "2026-06-15T08:00:00.000Z",
      amount: 0.5,
      status: "taken",
    });

    const [[values]] = stub.argsFor("med_dose_events", "update") as [
      [{ planned_intake: { intake: { amount: number } } }],
    ];
    expect(values.planned_intake.intake.amount).toBe(0.5);
  });

  it("defaults the amount to the regimen's planned dose", async () => {
    const stub = stubFor({ dose_definition: { intake: { amount: 0.5, unit: "pill" } } });

    await logDose(stub.client, {
      regimenId: "r-1",
      at: "2026-06-15T08:00:00.000Z",
      status: "taken",
    });

    const [[values]] = stub.argsFor("med_dose_events", "insert") as [
      [{ planned_intake: { intake: { amount: number; unit: string } } }],
    ];
    expect(values.planned_intake.intake).toEqual({ amount: 0.5, unit: "pill" });
  });

  it("takes an explicit amount over the planned one", async () => {
    const stub = stubFor({ dose_definition: { intake: { amount: 1, unit: "pill" } } });

    await logDose(stub.client, {
      regimenId: "r-1",
      at: "2026-06-15T08:00:00.000Z",
      amount: 0.5,
      status: "taken",
    });

    const [[values]] = stub.argsFor("med_dose_events", "insert") as [
      [{ planned_intake: { intake: { amount: number } } }],
    ];
    expect(values.planned_intake.intake.amount).toBe(0.5);
  });

  it("routes a skip to the skip RPC and passes a trimmed note", async () => {
    const stub = stubFor();

    await logDose(stub.client, {
      regimenId: "r-1",
      at: "2026-06-15T08:00:00.000Z",
      status: "skipped",
      note: "  felt sick  ",
    });

    expect(stub.rpc).toHaveBeenCalledWith("mark_dose_skipped", {
      p_dose_event_id: "d-1",
      p_note: "felt sick",
    });
  });

  it("omits a blank note rather than clearing one", async () => {
    const stub = stubFor();

    await logDose(stub.client, {
      regimenId: "r-1",
      at: "2026-06-15T08:00:00.000Z",
      status: "taken",
      note: "   ",
    });

    expect(stub.rpc).toHaveBeenCalledWith("mark_dose_taken", { p_dose_event_id: "d-1" });
  });

  it("refuses an unknown or soft-deleted regimen before writing anything", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: null }] });

    await expect(
      logDose(stub.client, { regimenId: "nope", at: "2026-06-15T08:00:00.000Z", status: "taken" }),
    ).rejects.toThrow(/No medication with id nope/);
    expect(stub.argsFor("med_dose_events", "insert")).toHaveLength(0);
  });

  it("takes the event back out when the RPC fails, so no phantom reminder is left", async () => {
    const stub = stubFor({}, { mark_dose_taken: { error: { message: "rpc down" } } });

    await expect(
      logDose(stub.client, { regimenId: "r-1", at: "2026-06-15T08:00:00.000Z", status: "taken" }),
    ).rejects.toThrow(/rpc down/);

    const [[values]] = stub.argsFor("med_dose_events", "update") as [
      [{ deleted_at: string | null }],
    ];
    expect(values.deleted_at).toEqual(expect.any(String));
    expect(stub.argsFor("med_dose_events", "eq")).toContainEqual(["id", "d-1"]);
  });

  it("names the surviving event when the withdrawal fails too", async () => {
    const stub = createSupabaseStub(
      {
        med_regimens: [{ data: regimen() }],
        med_dose_events: [
          { data: null },
          { data: doseEvent() },
          { error: { message: "still down" } },
        ],
      },
      { mark_dose_taken: { error: { message: "rpc down" } } },
    );

    // Both halves failing is one outage, and silence would leave the person
    // being reminded about a dose they already took.
    await expect(
      logDose(stub.client, { regimenId: "r-1", at: "2026-06-15T08:00:00.000Z", status: "taken" }),
    ).rejects.toThrow(/dose event d-1 is left scheduled on Ferrous sulfate/);
  });

  it("leaves an already-planned event alone when the RPC fails", async () => {
    const stub = stubFor(
      {},
      { mark_dose_taken: { error: { message: "rpc down" } } },
      { data: doseEvent({ id: "planned-1" }) },
    );

    // Withdrawing it would delete part of the plan the person still owes.
    await expect(
      logDose(stub.client, { regimenId: "r-1", at: "2026-06-15T08:00:00.000Z", status: "taken" }),
    ).rejects.toThrow(/rpc down/);
    expect(stub.argsFor("med_dose_events", "update")).toHaveLength(0);
  });

  it("surfaces an insert error", async () => {
    const stub = createSupabaseStub({
      med_regimens: [{ data: regimen() }],
      med_dose_events: [{ data: null }, { error: { message: "boom" } }],
    });

    await expect(
      logDose(stub.client, { regimenId: "r-1", at: "2026-06-15T08:00:00.000Z", status: "taken" }),
    ).rejects.toThrow(/Failed to record the intake/);
  });
});
