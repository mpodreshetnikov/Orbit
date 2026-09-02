import { describe, expect, it } from "vitest";
import {
  createRegimen,
  findRegimensByName,
  getMedication,
  listMedicationDoses,
  listMedications,
  logDose,
  updateRegimen,
  inventoryToStore,
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

  it("gives a new course with tracking on the decrement its owner asked for", async () => {
    // An absent flag reads as false in every function that reads it, and the
    // web form always writes true -- so a course created over MCP without one
    // tracked a figure that never moved.
    const stub = createSupabaseStub({ med_regimens: [{ data: regimen() }] });

    await createRegimen(stub.client, {
      custom_name: "X",
      inventory: { enabled: true, current_amount: 10 },
    });

    expect(stub.argsFor("med_regimens", "insert")[0][0]).toMatchObject({
      inventory: { enabled: true, current_amount: 10, auto_decrement_on_taken: true },
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

  it("keeps the stock fields an update did not name", async () => {
    // One jsonb column and every key optional, so "set the stock to 20" used to
    // drop the threshold, the unit and the decrement flag with it -- the refill
    // reminder went quiet and the figure stopped moving, silently.
    const stored = {
      enabled: true,
      current_amount: 4,
      unit: "pill",
      refill_threshold_amount: 2,
      capacity_amount: 30,
      auto_decrement_on_taken: true,
    };
    const stub = createSupabaseStub({
      med_regimens: [
        { data: { inventory: stored, updated_at: "2026-06-15T08:00:00.000Z" } },
        { data: regimen() },
      ],
    });

    await updateRegimen(stub.client, "r-1", {
      inventory: { enabled: true, current_amount: 20 },
    });

    expect(stub.argsFor("med_regimens", "update")[0][0]).toMatchObject({
      inventory: { ...stored, current_amount: 20 },
    });
    // And the write is conditional on the row not having moved under it.
    expect(stub.argsFor("med_regimens", "eq")).toContainEqual([
      "updated_at",
      "2026-06-15T08:00:00.000Z",
    ]);
  });

  it("merges again against what a concurrent write left", async () => {
    // A dose taken between the read and the write moves `current_amount`
    // through an RPC. Writing the merged object then carries the figure from
    // before it and gives the decrement back, silently.
    const stub = createSupabaseStub({
      med_regimens: [
        { data: { inventory: { enabled: true, current_amount: 10 }, updated_at: "t1" } },
        // The guard matched nothing: somebody got there first.
        { data: null },
        { data: { inventory: { enabled: true, current_amount: 9 }, updated_at: "t2" } },
        { data: regimen() },
      ],
    });

    await updateRegimen(stub.client, "r-1", { inventory: { refill_threshold_amount: 3 } });

    const writes = stub.argsFor("med_regimens", "update");
    expect(writes).toHaveLength(2);
    // The retry keeps their decrement rather than restoring the figure it first
    // read.
    expect(writes[1][0]).toMatchObject({
      inventory: { enabled: true, current_amount: 9, refill_threshold_amount: 3 },
    });
  });

  it("says the stock kept moving rather than reporting the medication missing", async () => {
    // Three collisions in a row is a caller hammering the same course, and an
    // honest error beats spinning -- but calling it a missing medication would
    // send them looking for the wrong thing.
    const contended = { data: { inventory: { enabled: true }, updated_at: "t" } };
    const stub = createSupabaseStub({
      med_regimens: [
        contended,
        { data: null },
        contended,
        { data: null },
        contended,
        { data: null },
        // The existence check on the way out.
        { data: { id: "r-1" } },
      ],
    });

    await expect(
      updateRegimen(stub.client, "r-1", { inventory: { current_amount: 20 } }),
    ).rejects.toThrow(/kept changing while this update was being applied/);
  });

  it("refuses rather than replacing when the stored stock cannot be read", async () => {
    // Treating an unreadable row as an empty one would store the supplied
    // object alone, which is the replacement the merge exists to prevent.
    const stub = createSupabaseStub({
      med_regimens: [{ error: { message: "connection reset" } }],
    });

    await expect(
      updateRegimen(stub.client, "r-1", { inventory: { current_amount: 20 } }),
    ).rejects.toThrow(/before updating it: connection reset/);
    expect(stub.argsFor("med_regimens", "update")).toHaveLength(0);
  });

  it("reads nothing extra when the update does not touch stock", async () => {
    const stub = createSupabaseStub({ med_regimens: [{ data: regimen() }] });

    await updateRegimen(stub.client, "r-1", { custom_name: "Y" });

    expect(stub.argsFor("med_regimens", "select")).toHaveLength(1);
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
    // The probe matches either timestamp in the minute, so it reads rows rather
    // than a single row; callers still pass the one planned dose they mean.
    const probe: StubResult = {
      ...planned,
      data: planned.data == null ? [] : Array.isArray(planned.data) ? planned.data : [planned.data],
    };
    return createSupabaseStub(
      {
        med_regimens: [{ data: regimen(overrides) }],
        med_dose_events: [
          // The same-minute planned-dose probe, then the insert, then the re-read.
          probe,
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

    // Both timestamps: `scheduled_at` is the planned slot, `actual_at` is where
    // a snooze moved it to and the time the read tools print, so a caller
    // logging the dose they were just shown finds it either way.
    expect(stub.argsFor("med_dose_events", "or")).toEqual([
      [
        "and(scheduled_at.gte.2026-06-15T08:00:00.000Z,scheduled_at.lt.2026-06-15T08:01:00.000Z)," +
          "and(actual_at.gte.2026-06-15T08:00:00.000Z,actual_at.lt.2026-06-15T08:01:00.000Z)",
      ],
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

    it("puts back what the dose actually took when the correction changes the amount", async () => {
      // The ledger hole: `mark_dose_skipped` reverses the amount it reads off
      // the row, so amending the row first made it restore 0.5 against a
      // decrement of 1 and leave half a pill missing from stock for good.
      const fake = fakeWith([{ id: "d-1", status: "taken", taken_at: AT }]);

      const result = await logDose(fake.client, {
        regimenId: "r-1",
        at: AT,
        status: "skipped",
        amount: 0.5,
      });

      expect(result.dose.status).toBe("skipped");
      expect(fake.inventory).toEqual([
        expect.objectContaining({ type: "correction", event_id: "d-1", amount: 1 }),
      ]);
      // And the record still ends up saying what the person reported.
      expect(fake.events[0].planned_intake).toMatchObject({ intake: { amount: 0.5 } });
    });

    it("decrements the corrected amount when the correction goes the other way", async () => {
      // The mirror: `mark_dose_taken` decrements what it reads, so here the
      // correction has to be on the row before the RPC looks at it.
      const fake = fakeWith([{ id: "d-1", status: "skipped", taken_at: AT }]);

      await logDose(fake.client, { regimenId: "r-1", at: AT, status: "taken", amount: 0.5 });

      expect(fake.inventory).toEqual([
        expect.objectContaining({ type: "decrement", event_id: "d-1", amount: 0.5 }),
      ]);
    });

    it("corrects the amount of a dose already taken instead of reporting nothing to do", async () => {
      // "Actually that was half a pill." A matching status is not a matching
      // outcome: refusing here left the record disagreeing with the person and
      // sent them round the toggle-to-skipped-and-back workaround.
      const fake = fakeWith([{ id: "d-1", status: "taken", taken_at: AT }]);

      const result = await logDose(fake.client, {
        regimenId: "r-1",
        at: AT,
        status: "taken",
        amount: 0.5,
      });

      expect(result.alreadyRecorded).toBe(false);
      expect(result.corrected).toBe(true);
      expect(fake.events).toHaveLength(1);
      expect(fake.events[0].planned_intake).toMatchObject({ intake: { amount: 0.5 } });
      // Reversed in full, then decremented anew -- the ledger moves by the
      // difference without ever inventing a second intake.
      expect(fake.inventory).toEqual([
        expect.objectContaining({ type: "correction", amount: 1 }),
        expect.objectContaining({ type: "decrement", amount: 0.5 }),
      ]);
    });

    it("corrects the amount of a dose already skipped without touching stock", async () => {
      const fake = fakeWith([{ id: "d-1", status: "skipped", taken_at: AT }]);

      const result = await logDose(fake.client, {
        regimenId: "r-1",
        at: AT,
        status: "skipped",
        amount: 0.5,
      });

      expect(result.corrected).toBe(true);
      expect(fake.events[0].planned_intake).toMatchObject({ intake: { amount: 0.5 } });
      // A dose that was skipped never took anything out, so nothing goes back.
      expect(fake.inventory).toHaveLength(0);
    });

    it("still writes the corrected amount when only the RPC's response is lost", async () => {
      // The reversal has committed against the amount really decremented, so
      // the half of the correction that waited for it is still owed: without
      // it the event keeps the amount it was taken as, and a later status
      // change moves stock by the wrong figure.
      const fake = fakeWith([{ id: "d-1", status: "taken", taken_at: AT }]);
      fake.loseRpcResponse("connection reset by peer");

      const result = await logDose(fake.client, {
        regimenId: "r-1",
        at: AT,
        status: "skipped",
        amount: 0.5,
      });

      expect(result.dose.status).toBe("skipped");
      expect(fake.events[0].planned_intake).toMatchObject({ intake: { amount: 0.5 } });
      expect(fake.inventory).toEqual([expect.objectContaining({ type: "correction", amount: 1 })]);
    });

    it("writes the note that came with a skipped-dose correction, and keeps it otherwise", async () => {
      // Nothing follows this branch to record the note, so dropping it reported
      // a correction the record did not carry.
      const withNote = fakeWith([{ id: "d-1", status: "skipped", note: "felt sick" }]);
      await logDose(withNote.client, {
        regimenId: "r-1",
        at: AT,
        status: "skipped",
        amount: 0.5,
        note: "took a quarter instead",
      });
      expect(withNote.events[0].note).toBe("took a quarter instead");

      const withoutNote = fakeWith([{ id: "d-1", status: "skipped", note: "felt sick" }]);
      await logDose(withoutNote.client, {
        regimenId: "r-1",
        at: AT,
        status: "skipped",
        amount: 0.5,
      });
      expect(withoutNote.events[0].note).toBe("felt sick");
    });

    it("answers a resolved dose changed to the other status as a correction", async () => {
      // It modified an intake already on the record, so "Logged ..." would read
      // as a second dose -- the very thing the correction reply exists to stop.
      const resolved = fakeWith([{ id: "d-1", status: "taken", taken_at: AT }]);
      const correction = await logDose(resolved.client, {
        regimenId: "r-1",
        at: AT,
        status: "skipped",
      });
      expect(correction.corrected).toBe(true);

      // A dose still owed is genuinely being logged for the first time.
      const owed = fakeWith([{ id: "d-1", status: "scheduled" }]);
      const logged = await logDose(owed.client, { regimenId: "r-1", at: AT, status: "taken" });
      expect(logged.corrected).toBe(false);
    });

    it("resolves the dose that was due when the intake came later", async () => {
      // The 08:00 dose swallowed at 08:15. One field did both jobs, so the
      // lookup went to 08:15, found nothing, inserted a second event and
      // decremented stock for it -- while the 08:00 dose stayed owed and its
      // reminder stayed armed.
      const fake = fakeWith([{ id: "d-1", status: "scheduled" }]);

      const result = await logDose(fake.client, {
        regimenId: "r-1",
        at: AT,
        takenAt: "2026-06-15T08:15:00.000Z",
        status: "taken",
      });

      expect(result.planned).toBe(true);
      expect(fake.events).toHaveLength(1);
      expect(fake.events[0].status).toBe("taken");
      expect(fake.inventory).toHaveLength(1);
      // And the moment the person reported is what the record carries, rather
      // than the slot the dose sat on.
      expect(fake.events[0].taken_at).toBe("2026-06-15T08:15:00.000Z");
      expect(fake.rpc).toHaveBeenCalledWith("mark_dose_taken", {
        p_dose_event_id: "d-1",
        p_taken_at: "2026-06-15T08:15:00.000Z",
      });
    });

    it("corrects the time a dose was taken, with the amount unchanged", async () => {
      // "The 8 o'clock one -- I actually took it at quarter past." Neither
      // status nor amount moves, and reading that as nothing to do left the
      // record saying 08:00 while the reply said 08:15.
      const fake = fakeWith([{ id: "d-1", status: "taken", taken_at: AT }]);

      const result = await logDose(fake.client, {
        regimenId: "r-1",
        at: AT,
        takenAt: "2026-06-15T08:15:00.000Z",
        status: "taken",
      });

      expect(result.alreadyRecorded).toBe(false);
      expect(result.corrected).toBe(true);
      expect(fake.events[0].taken_at).toBe("2026-06-15T08:15:00.000Z");
      // The amount did not change, so nothing moves in the ledger.
      expect(fake.inventory).toHaveLength(0);
    });

    it("still says nothing was written when the time is the one on record", async () => {
      // The column comes back with whatever offset PostgREST renders it in, so
      // the comparison is between instants rather than between strings.
      const fake = fakeWith([
        { id: "d-1", status: "taken", taken_at: "2026-06-15T08:00:00+00:00" },
      ]);

      const result = await logDose(fake.client, {
        regimenId: "r-1",
        at: AT,
        takenAt: AT,
        status: "taken",
      });

      expect(result.alreadyRecorded).toBe(true);
      expect(fake.rpc).not.toHaveBeenCalled();
    });

    it("still says nothing was written when the amount is the one on record", async () => {
      const fake = fakeWith([{ id: "d-1", status: "taken", taken_at: AT }]);

      const result = await logDose(fake.client, {
        regimenId: "r-1",
        at: AT,
        status: "taken",
        amount: 1,
      });

      expect(result.alreadyRecorded).toBe(true);
      expect(result.corrected).toBe(false);
      expect(fake.rpc).not.toHaveBeenCalled();
      expect(fake.inventory).toHaveLength(0);
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

    it("resolves a dose snoozed to the time the caller was shown", async () => {
      // The read tools print `actual_at`, so this is the time a caller repeats:
      // the 09:00 dose was snoozed to 11:00 and the owner logs it at 11:00.
      // Probing only `scheduled_at` inserted a second event, decremented stock
      // for it, and left the snoozed reminder armed.
      const fake = fakeWith([
        {
          id: "d-1",
          status: "snoozed",
          scheduled_at: "2026-06-15T09:00:00.000Z",
          actual_at: "2026-06-15T11:00:00.000Z",
        },
      ]);

      const result = await logDose(fake.client, {
        regimenId: "r-1",
        at: "2026-06-15T11:00:00.000Z",
        status: "taken",
      });

      expect(result.planned).toBe(true);
      expect(fake.events).toHaveLength(1);
      expect(fake.events[0].status).toBe("taken");
      expect(fake.inventory).toHaveLength(1);
    });

    it("resolves the dose that still needs it when two share the minute", async () => {
      // `snooze_dose` can move a dose onto a minute that already holds a
      // resolved one. Picking the resolved row would answer "already recorded"
      // and leave the other owing a dose, its reminder armed and its stock
      // movement unwritten.
      const fake = fakeWith([
        {
          id: "d-1",
          status: "taken",
          taken_at: AT,
          scheduled_at: AT,
          actual_at: AT,
          created_at: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "d-2",
          status: "snoozed",
          scheduled_at: "2026-06-15T07:00:00.000Z",
          actual_at: AT,
          created_at: "2026-06-01T00:00:01.000Z",
        },
      ]);

      const result = await logDose(fake.client, { regimenId: "r-1", at: AT, status: "taken" });

      expect(result.alreadyRecorded).toBeFalsy();
      expect(fake.events).toHaveLength(2);
      expect(fake.events.find((event) => event.id === "d-2")?.status).toBe("taken");
      expect(fake.inventory).toHaveLength(1);
    });

    it("prefers a dose still owed over one resolved the other way", async () => {
      // Both differ from the requested status, so "needs the transition" alone
      // ties them and the older skipped row would win — rewriting a real record
      // while the snoozed dose kept its reminder armed.
      const fake = fakeWith([
        {
          id: "d-1",
          status: "skipped",
          taken_at: AT,
          scheduled_at: AT,
          actual_at: AT,
          created_at: "2026-06-01T00:00:00.000Z",
        },
        {
          id: "d-2",
          status: "snoozed",
          scheduled_at: "2026-06-15T07:00:00.000Z",
          actual_at: AT,
          created_at: "2026-06-01T00:00:01.000Z",
        },
      ]);

      await logDose(fake.client, { regimenId: "r-1", at: AT, status: "taken" });

      expect(fake.events.find((event) => event.id === "d-2")?.status).toBe("taken");
      expect(fake.events.find((event) => event.id === "d-1")?.status).toBe("skipped");
      expect(fake.inventory).toHaveLength(1);
    });

    it("records the intake rather than reporting a missed dose as logged", async () => {
      // `mark_dose_taken` selects only scheduled/sent/snoozed/skipped rows, so a
      // `missed` one is a silent no-op that the readback returns unchanged —
      // "logged" with nothing recorded. It is left alone and the intake becomes
      // its own event.
      const fake = fakeWith([{ id: "d-1", status: "missed", scheduled_at: AT, actual_at: AT }]);

      await logDose(fake.client, { regimenId: "r-1", at: AT, status: "taken" });

      expect(fake.events.find((event) => event.id === "d-1")?.status).toBe("missed");
      expect(fake.events).toHaveLength(2);
      expect(fake.events[1].status).toBe("taken");
      expect(fake.inventory).toHaveLength(1);
    });

    it("ranks every candidate on the minute, however many share it", async () => {
      // A cap applied before the ranking could discard the dose still owed:
      // eleven snoozed doses collide, ten are resolved, and the next call would
      // see only resolved rows and answer "already recorded".
      const fake = fakeWith([
        ...Array.from({ length: 10 }, (_, index) => ({
          id: `taken-${index}`,
          status: "taken",
          taken_at: AT,
          scheduled_at: AT,
          actual_at: AT,
          created_at: `2026-06-01T00:00:0${index}.000Z`,
        })),
        {
          id: "owed",
          status: "snoozed",
          scheduled_at: "2026-06-15T07:00:00.000Z",
          actual_at: AT,
          created_at: "2026-06-01T00:00:20.000Z",
        },
      ]);

      const result = await logDose(fake.client, { regimenId: "r-1", at: AT, status: "taken" });

      expect(result.alreadyRecorded).toBeFalsy();
      expect(fake.events.find((event) => event.id === "owed")?.status).toBe("taken");
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

describe("inventoryToStore", () => {
  it("means yes when tracking is on and nobody said otherwise", () => {
    // The only surface that writes the flag always writes true, and turning
    // tracking on is a request for the number to go down.
    expect(inventoryToStore(null, { enabled: true, current_amount: 10 })).toEqual({
      enabled: true,
      current_amount: 10,
      auto_decrement_on_taken: true,
    });
  });

  it("leaves an explicit refusal alone", () => {
    expect(inventoryToStore(null, { enabled: true, auto_decrement_on_taken: false })).toMatchObject(
      { auto_decrement_on_taken: false },
    );
  });

  it("adds no default where tracking is off", () => {
    expect(inventoryToStore(null, { enabled: false })).toEqual({ enabled: false });
  });

  it("clears the whole thing on an explicit null, which is how tracking is turned off", () => {
    expect(inventoryToStore({ enabled: true, current_amount: 5 }, null)).toBeNull();
  });

  it("leaves the stored object alone when the caller named no stock at all", () => {
    const stored = { enabled: true, current_amount: 5 };
    expect(inventoryToStore(stored, undefined)).toEqual(stored);
  });
});
