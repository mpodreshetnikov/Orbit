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
import { createDoseEventsFake } from "./dose-events-fake";

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

    const { regimens } = await listMedications(stub.client, { personId: "p-1" });

    expect(regimens[0].effective_status).toBe("active");
    // The UI shows this as completed; the tool must agree.
    expect(regimens[1].effective_status).toBe("completed");
    expect(regimens[1].status).toBe("active");
  });

  it("filters by name in the query, case-insensitively", async () => {
    // In memory this was a filter over a response PostgREST had already capped
    // at `max_rows`, so a long history could hide its own oldest courses.
    const stub = createSupabaseStub({
      med_regimens: [{ data: [regimen({ custom_name: "Ferrous sulfate" })] }],
    });

    const { regimens } = await listMedications(stub.client, {
      personId: "p-1",
      search: "FERROUS",
    });

    expect(stub.argsFor("med_regimens", "regexIMatch")).toEqual([["custom_name", "FERROUS"]]);
    expect(regimens.map((r) => r.custom_name)).toEqual(["Ferrous sulfate"]);
  });

  it("matches a name containing pattern characters literally", async () => {
    // `ilike` was the wrong operator here: PostgREST reads `*` in its value as
    // `%`, so "B*Complex" would have quietly become a wildcard search.
    const stub = createSupabaseStub({ med_regimens: [{ data: [] }] });
    await listMedications(stub.client, { personId: "p-1", search: "B*Complex (50%)" });

    expect(stub.argsFor("med_regimens", "regexIMatch")).toEqual([
      ["custom_name", "B\\*Complex \\(50%\\)"],
    ]);
  });

  it("ignores a whitespace-only search", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: [regimen(), regimen()] }] });
    const { regimens } = await listMedications(stub.client, { personId: "p-1", search: "  " });

    expect(stub.argsFor("med_regimens", "regexIMatch")).toHaveLength(0);
    expect(regimens).toHaveLength(2);
  });

  it("pages in the query and reports the count the database returned", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: [regimen()], count: 1200 }] });

    const { regimens, total } = await listMedications(stub.client, {
      personId: "p-1",
      limit: 20,
      offset: 60,
    });

    expect(stub.argsFor("med_regimens", "range")).toEqual([[60, 79]]);
    expect(regimens).toHaveLength(1);
    expect(total).toBe(1200);
  });

  it("orders by a unique column as well, so a page boundary cannot repeat a row", async () => {
    // Four courses of one medication were created in the same minute in
    // production, so `created_at` alone is not a stable order.
    const stub = createSupabaseStub({ med_regimens: [{ data: [] }] });
    await listMedications(stub.client, { personId: "p-1" });

    expect(stub.argsFor("med_regimens", "order")).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: true }],
    ]);
  });

  it("surfaces a query error", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ error: { message: "boom" } }] });
    await expect(listMedications(stub.client, { personId: "p-1" })).rejects.toThrow(
      /Failed to load medications/,
    );
  });
});

describe("getMedication", () => {
  it("asks for the doses either side of now separately, each counted", async () => {
    // One unbounded window split in memory would be cut at PostgREST's
    // `max_rows`: an hourly course over a 30-day horizon has ~1440 events a
    // side, so the ascending page would have ended before "upcoming" began and
    // the counts would have reported the truncation as the total.
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const future = new Date(Date.now() + 3_600_000).toISOString();

    const stub = createSupabaseStub({
      med_regimens: [{ data: regimen() }],
      med_dose_events: [
        // Newest first, as the recent query orders them.
        {
          data: [
            doseEvent({ id: "yesterday", scheduled_at: past, actual_at: past }),
            doseEvent({ id: "older", scheduled_at: past, actual_at: past }),
          ],
          count: 812,
        },
        {
          data: [
            doseEvent({ id: "future", scheduled_at: future, actual_at: future }),
            // Snoozed forward: still scheduled for an hour ago, but due in an
            // hour, which is where the app and the reminder query place it.
            doseEvent({
              id: "snoozed",
              scheduled_at: past,
              actual_at: future,
              status: "snoozed",
            }),
          ],
          count: 1440,
        },
      ],
      med_inventory_transactions: [{ data: [] }],
    });

    const result = await getMedication(stub.client, { regimenId: "r-1", horizonDays: 30 });

    // The recent page comes back newest-first and is returned ascending, so the
    // renderer's "last" slice really is the intakes nearest now.
    expect(result?.recentDoses.map((d) => d.id)).toEqual(["older", "yesterday"]);
    expect(result?.upcomingDoses.map((d) => d.id)).toEqual(["future", "snoozed"]);
    expect(result?.recentTotal).toBe(812);
    expect(result?.upcomingTotal).toBe(1440);

    // Both pages are bounded in the database, and the boundary between them is
    // now: the recent side ends strictly before it, the upcoming side starts at
    // it, so no dose falls in both or neither.
    expect(stub.argsFor("med_dose_events", "range")).toEqual([
      [0, 49],
      [0, 49],
    ]);
    const [[ltColumn, ltValue]] = stub.argsFor("med_dose_events", "lt") as [[string, string]];
    const gte = stub.argsFor("med_dose_events", "gte") as Array<[string, string]>;
    expect(ltColumn).toBe("actual_at");
    expect(gte.map(([column]) => column)).toEqual(["actual_at", "actual_at"]);
    expect(gte[1][1]).toBe(ltValue);
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

    const [[lowerColumn, lower]] = stub.argsFor("med_dose_events", "gte") as [[string, string]];
    const [[upperColumn, upper]] = stub.argsFor("med_dose_events", "lte") as [[string, string]];
    const span = Date.parse(upper) - Date.parse(lower);
    expect(Math.round(span / 86_400_000)).toBe(6);
    // The window is over the effective time, so a dose snoozed into or out of
    // it is selected where it is now due rather than where it was planned.
    expect([lowerColumn, upperColumn]).toEqual(["actual_at", "actual_at"]);
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

    const { doses } = await listMedicationDoses(stub.client, {
      personId: "p-1",
      from: "2026-06-15T00:00:00Z",
      to: "2026-06-15T23:59:59Z",
    });

    expect(doses[0].medication_name).toBe("Ferrous sulfate");
  });

  it("pages in the query and reports the count the database returned", async () => {
    // PostgREST caps a response at `max_rows` (1000 in supabase/config.toml),
    // so counting the returned rows would report a truncated page as the whole
    // range and declare there was nothing left to fetch.
    const stub = createSupabaseStub({
      med_dose_events: [{ data: [doseEvent()], count: 1743 }],
    });

    const { doses, total } = await listMedicationDoses(stub.client, {
      personId: "p-1",
      from: "a",
      to: "b",
      limit: 20,
      offset: 40,
    });

    expect(doses).toHaveLength(1);
    expect(total).toBe(1743);
    expect(stub.argsFor("med_dose_events", "range")).toEqual([[40, 59]]);
  });

  it("ranges over the effective time, not the planned one", async () => {
    // `snooze_dose.sql` moves `actual_at` and leaves `scheduled_at`, so asking
    // by the planned time returns a dose snoozed into tomorrow on today's list
    // and hides it from tomorrow's.
    const stub = createSupabaseStub({ med_dose_events: [{ data: [doseEvent()] }] });

    await listMedicationDoses(stub.client, {
      personId: "p-1",
      from: "2026-06-15T00:00:00Z",
      to: "2026-06-15T23:59:59Z",
    });

    expect(stub.argsFor("med_dose_events", "gte")).toEqual([["actual_at", "2026-06-15T00:00:00Z"]]);
    expect(stub.argsFor("med_dose_events", "lte")).toEqual([["actual_at", "2026-06-15T23:59:59Z"]]);
  });

  it("asks the database for no range when the caller wants everything", async () => {
    const stub = createSupabaseStub({ med_dose_events: [{ data: [doseEvent()] }] });

    const { total } = await listMedicationDoses(stub.client, {
      personId: "p-1",
      from: "a",
      to: "b",
    });

    expect(stub.argsFor("med_dose_events", "range")).toEqual([]);
    expect(total).toBe(1);
  });

  it("falls back to null when the join is missing", async () => {
    const stub = createSupabaseStub({ med_dose_events: [{ data: [doseEvent()] }] });

    const { doses } = await listMedicationDoses(stub.client, {
      personId: "p-1",
      from: "a",
      to: "b",
    });

    expect(doses[0].medication_name).toBeNull();
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

  it("probes the minute the intake falls in, at every status", async () => {
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
    // No status filter: a dose already `taken` or `snoozed` at that minute is
    // outside the unique index, so only this probe can stop it duplicating.
    expect(stub.argsFor("med_dose_events", "in")).toHaveLength(0);
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
    expect(stub.argsFor("med_dose_events", "delete")).toHaveLength(0);
  });

  describe("against a fake that enforces the real constraints", () => {
    const AT = "2026-06-15T08:00:00.000Z";

    function fakeWith(events: Parameters<typeof createDoseEventsFake>[0]["events"]) {
      return createDoseEventsFake({ regimen: regimen(), events });
    }

    it("does not record a second intake when the minute is already taken", async () => {
      // The case the status-filtered probe missed: she ticked the 08:00 dose in
      // the app, then told the assistant about it. The partial unique index
      // does not cover `taken`, so nothing but the probe stands in the way.
      const fake = fakeWith([{ id: "d-1", status: "taken", taken_at: AT }]);

      const result = await logDose(fake.client, { regimenId: "r-1", at: AT, status: "taken" });

      expect(result.alreadyRecorded).toBe(true);
      expect(result.dose.id).toBe("d-1");
      expect(fake.events).toHaveLength(1);
      expect(fake.inventory).toHaveLength(0);
      expect(fake.rpc).not.toHaveBeenCalled();
    });

    it("corrects a taken dose to skipped in place instead of inserting", async () => {
      const fake = fakeWith([{ id: "d-1", status: "taken", taken_at: AT }]);

      const result = await logDose(fake.client, { regimenId: "r-1", at: AT, status: "skipped" });

      expect(result.alreadyRecorded).toBe(false);
      expect(fake.events).toHaveLength(1);
      expect(fake.events[0].status).toBe("skipped");
      // `mark_dose_skipped` reverses the earlier decrement rather than adding one.
      expect(fake.inventory).toEqual([
        expect.objectContaining({ type: "correction", event_id: "d-1" }),
      ]);
    });

    it("resolves a snoozed dose instead of leaving its reminder armed", async () => {
      // `snoozed` is outside the unique index too, so the insert would have
      // succeeded and left `d-1` owing a dose that was already taken.
      const fake = fakeWith([{ id: "d-1", status: "snoozed" }]);

      await logDose(fake.client, { regimenId: "r-1", at: AT, status: "taken" });

      expect(fake.events).toHaveLength(1);
      expect(fake.events[0].status).toBe("taken");
      expect(fake.inventory).toHaveLength(1);
    });

    it("resolves the planned dose rather than colliding with the unique index", async () => {
      const fake = fakeWith([{ id: "d-1", status: "scheduled" }]);

      const result = await logDose(fake.client, { regimenId: "r-1", at: AT, status: "taken" });

      expect(result.planned).toBe(true);
      expect(fake.events).toHaveLength(1);
      expect(fake.events[0].status).toBe("taken");
    });

    it("inserts and resolves when the minute is genuinely free", async () => {
      const fake = fakeWith([]);

      const result = await logDose(fake.client, { regimenId: "r-1", at: AT, status: "taken" });

      expect(result.planned).toBe(false);
      expect(fake.events).toHaveLength(1);
      expect(fake.events[0].status).toBe("taken");
      expect(fake.inventory).toHaveLength(1);
    });

    it("keeps a committed intake when only the RPC response is lost", async () => {
      // The destructive case: the RPC ran and committed, the reply did not
      // arrive. Deleting here would wipe the record and orphan its decrement.
      const fake = fakeWith([]);
      fake.loseRpcResponse("gateway timeout");

      const result = await logDose(fake.client, { regimenId: "r-1", at: AT, status: "taken" });

      expect(result.dose.status).toBe("taken");
      expect(fake.events).toHaveLength(1);
      expect(fake.inventory).toEqual([
        expect.objectContaining({ type: "decrement", event_id: "d-1" }),
      ]);
    });

    it("withdraws the inserted event when the RPC really did not run", async () => {
      const fake = fakeWith([]);
      fake.failNext("rpc", "rpc down");

      await expect(
        logDose(fake.client, { regimenId: "r-1", at: AT, status: "taken" }),
      ).rejects.toThrow(/rpc down/);

      expect(fake.events).toHaveLength(0);
      expect(fake.inventory).toHaveLength(0);
    });

    it("keeps the active ingredients when correcting the amount", async () => {
      const active = [{ name: "Hydroxyzine", amount: 25, unit: "mg" }];
      const fake = fakeWith([
        {
          id: "d-1",
          status: "scheduled",
          planned_intake: { intake: { amount: 1, unit: "tablet" }, active },
        },
      ]);

      await logDose(fake.client, { regimenId: "r-1", at: AT, amount: 0.5, status: "taken" });

      // The dose event is the only record of what was actually swallowed, and
      // the slot's own unit is what reaches the inventory ledger.
      expect(fake.events[0].planned_intake).toEqual({
        intake: { amount: 0.5, unit: "tablet" },
        active,
      });
      expect(fake.inventory[0]).toMatchObject({ amount: 0.5, unit: "tablet" });
    });

    it("refuses rather than guessing when the probe read fails", async () => {
      const fake = fakeWith([{ id: "d-1", status: "scheduled" }]);
      fake.failNext("med_dose_events", "connection reset");

      // Reading that failure as "no dose here" would take the insert branch
      // straight into a duplicate-key error, or duplicate a resolved intake.
      await expect(
        logDose(fake.client, { regimenId: "r-1", at: AT, status: "taken" }),
      ).rejects.toThrow(/Failed to look for an existing dose/);
      expect(fake.events).toHaveLength(1);
      expect(fake.events[0].status).toBe("scheduled");
    });
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
