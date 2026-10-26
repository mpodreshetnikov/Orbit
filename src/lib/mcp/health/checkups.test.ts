import { describe, expect, it } from "vitest";
import {
  addProposedCheckups,
  firstDueDate,
  getCheckup,
  listCheckups,
  reviewCheckupProposals,
  type ProposedCheckup,
} from "./checkups";
import { createSupabaseStub } from "./test-support";

const NOW = new Date("2026-06-15T12:00:00Z");

function checkup(overrides: Record<string, unknown> = {}) {
  return {
    id: "c-1",
    person_id: "p-1",
    title: "Blood panel",
    category: "lab",
    schedule: { type: "interval", every: 6, unit: "month" },
    next_due_at: "2026-06-20",
    status: "active",
    why_text: null,
    notes: null,
    planned_on: null,
    reminder_days_before: [7],
    ...overrides,
  };
}

describe("listCheckups", () => {
  it("scopes to the person and orders by due date", async () => {
    const stub = createSupabaseStub({ checkup_items: [{ data: [] }] });
    await listCheckups(stub.client, { personId: "p-1", now: NOW });

    expect(stub.argsFor("checkup_items", "eq")).toEqual([["person_id", "p-1"]]);
    expect(stub.argsFor("checkup_items", "order")).toEqual([
      ["next_due_at", { ascending: true, nullsFirst: false }],
    ]);
  });

  it("computes days until due and flags overdue items", async () => {
    const stub = createSupabaseStub({
      checkup_items: [
        {
          data: [
            checkup({ id: "future", next_due_at: "2026-06-20" }),
            checkup({ id: "past", next_due_at: "2026-06-10" }),
          ],
        },
      ],
    });

    const rows = await listCheckups(stub.client, { personId: "p-1", now: NOW });

    expect(rows[0]).toMatchObject({ id: "future", days_until_due: 5, is_overdue: false });
    expect(rows[1]).toMatchObject({ id: "past", days_until_due: -5, is_overdue: true });
  });

  it("treats a checkup due today as not overdue", async () => {
    const stub = createSupabaseStub({
      checkup_items: [{ data: [checkup({ next_due_at: "2026-06-15" })] }],
    });

    const [row] = await listCheckups(stub.client, { personId: "p-1", now: NOW });
    expect(row).toMatchObject({ days_until_due: 0, is_overdue: false });
  });

  it("never marks a paused or archived checkup overdue", async () => {
    const stub = createSupabaseStub({
      checkup_items: [
        {
          data: [
            checkup({ id: "paused", status: "paused", next_due_at: "2026-01-01" }),
            checkup({ id: "archived", status: "archived", next_due_at: "2026-01-01" }),
          ],
        },
      ],
    });

    const rows = await listCheckups(stub.client, { personId: "p-1", now: NOW });
    // These are not something the user is expected to act on.
    expect(rows.every((r) => r.is_overdue === false)).toBe(true);
  });

  it("handles a checkup with no due date", async () => {
    const stub = createSupabaseStub({
      checkup_items: [{ data: [checkup({ next_due_at: null })] }],
    });

    const [row] = await listCheckups(stub.client, { personId: "p-1", now: NOW });
    expect(row).toMatchObject({ days_until_due: null, is_overdue: false });
  });

  it("filters to overdue only", async () => {
    const stub = createSupabaseStub({
      checkup_items: [
        {
          data: [
            checkup({ id: "past", next_due_at: "2026-06-10" }),
            checkup({ id: "future", next_due_at: "2026-06-20" }),
            checkup({ id: "undated", next_due_at: null }),
          ],
        },
      ],
    });

    const rows = await listCheckups(stub.client, {
      personId: "p-1",
      dueWindow: "overdue",
      now: NOW,
    });

    expect(rows.map((r) => r.id)).toEqual(["past"]);
  });

  it("filters to upcoming only, excluding undated and inactive", async () => {
    const stub = createSupabaseStub({
      checkup_items: [
        {
          data: [
            checkup({ id: "past", next_due_at: "2026-06-10" }),
            checkup({ id: "future", next_due_at: "2026-06-20" }),
            checkup({ id: "undated", next_due_at: null }),
            checkup({ id: "paused", status: "paused", next_due_at: "2026-06-20" }),
          ],
        },
      ],
    });

    const rows = await listCheckups(stub.client, {
      personId: "p-1",
      dueWindow: "upcoming",
      now: NOW,
    });

    expect(rows.map((r) => r.id)).toEqual(["future"]);
  });

  it("returns everything for the 'all' window", async () => {
    const stub = createSupabaseStub({
      checkup_items: [{ data: [checkup({ id: "a" }), checkup({ id: "b", next_due_at: null })] }],
    });

    const rows = await listCheckups(stub.client, { personId: "p-1", dueWindow: "all", now: NOW });
    expect(rows).toHaveLength(2);
  });

  it("pushes category, status and due-before to the database", async () => {
    const stub = createSupabaseStub({ checkup_items: [{ data: [] }] });
    await listCheckups(stub.client, {
      personId: "p-1",
      category: "lab",
      status: "active",
      dueBefore: "2026-07-01",
      now: NOW,
    });

    expect(stub.argsFor("checkup_items", "eq")).toEqual(
      expect.arrayContaining([
        ["person_id", "p-1"],
        ["category", "lab"],
        ["status", "active"],
      ]),
    );
    expect(stub.argsFor("checkup_items", "lte")).toEqual([["next_due_at", "2026-07-01"]]);
  });

  it("surfaces a query error", async () => {
    const stub = createSupabaseStub({ checkup_items: [{ error: { message: "boom" } }] });
    await expect(listCheckups(stub.client, { personId: "p-1" })).rejects.toThrow(
      /Failed to load checkups: boom/,
    );
  });
});

describe("getCheckup", () => {
  it("returns the item with its completion log, newest first", async () => {
    const stub = createSupabaseStub({
      checkup_items: [{ data: checkup() }],
      checkup_completions: [{ data: [{ id: "done-1", done_at: "2026-01-01" }] }],
    });

    const result = await getCheckup(stub.client, "c-1");

    expect(result.checkup).toMatchObject({ id: "c-1" });
    expect(result.completions).toHaveLength(1);
    expect(stub.argsFor("checkup_completions", "order")).toEqual([
      ["done_at", { ascending: false }],
    ]);
  });

  it("returns nulls for an unknown checkup without querying completions", async () => {
    const stub = createSupabaseStub({ checkup_items: [{ data: null }] });

    const result = await getCheckup(stub.client, "nope");

    expect(result).toEqual({ checkup: null, completions: [] });
    expect(stub.argsFor("checkup_completions", "select")).toHaveLength(0);
  });

  it("tolerates a null completion list", async () => {
    const stub = createSupabaseStub({
      checkup_items: [{ data: checkup() }],
      checkup_completions: [{ data: null }],
    });

    await expect(getCheckup(stub.client, "c-1")).resolves.toMatchObject({ completions: [] });
  });

  it("surfaces a query error", async () => {
    const stub = createSupabaseStub({ checkup_items: [{ error: { message: "boom" } }] });
    await expect(getCheckup(stub.client, "c-1")).rejects.toThrow(/Failed to load checkup/);
  });
});

describe("firstDueDate", () => {
  const halfYear = { type: "interval" as const, every: 6, unit: "month" as const };

  it("takes the anchor, or one interval from today without one", () => {
    expect(firstDueDate(halfYear, "2026-12-01", "2026-10-26")).toBe("2026-12-01");
    expect(firstDueDate(halfYear, null, "2026-10-26")).toBe("2027-04-26");
  });

  it("moves a past anchor along the series, as the insert trigger does", () => {
    expect(firstDueDate(halfYear, "2026-03-06", "2026-10-26")).toBe("2027-03-06");
  });

  it("keeps a one-off date even when it has passed", () => {
    expect(firstDueDate({ type: "one_off", due_at: "2026-09-06" }, null, "2026-10-26")).toBe(
      "2026-09-06",
    );
  });
});

describe("reviewCheckupProposals", () => {
  const ultrasound: ProposedCheckup = {
    title: "УЗИ щитовидной железы",
    category: "imaging",
    schedule: { type: "interval", every: 1, unit: "year" },
    first_due_at: "2027-03-06",
    why: "Узел 4 мм, контроль через год",
    condition_id: "cond-1",
  };

  it("refuses a title the person already has, a repeat, and a stranger's condition", async () => {
    const stub = createSupabaseStub({
      checkup_items: [{ data: [{ title: "ОАК", status: "paused" }] }],
      conditions: [{ data: [{ id: "cond-1", name: "Узел щитовидной железы" }] }],
      medical_records: [{ data: { id: "rec-1", title: "УЗИ", record_date: "2026-03-06" } }],
    });

    const review = await reviewCheckupProposals(
      stub.client,
      "p-1",
      [
        ultrasound,
        { ...ultrasound, title: "узи  щитовидной железы" },
        { ...ultrasound, title: "оак", condition_id: null },
        { ...ultrasound, title: "Гастроскопия", condition_id: "cond-2" },
      ],
      "rec-1",
      "2026-10-26",
    );

    expect(review.accepted).toEqual([
      { input: ultrasound, first_due_at: "2027-03-06", condition_name: "Узел щитовидной железы" },
    ]);
    expect(review.refused.map((item) => item.title)).toEqual([
      "узи  щитовидной железы",
      "оак",
      "Гастроскопия",
    ]);
    expect(review.refused[1].reason).toContain('already scheduled as "ОАК" (paused)');
    expect(review.evidence).toEqual({
      record_id: "rec-1",
      title: "УЗИ",
      record_date: "2026-03-06",
    });
    expect(stub.argsFor("checkup_items", "in")).toEqual([["status", ["active", "paused"]]]);
  });

  it("refuses everything when the cited record is not the person's", async () => {
    const stub = createSupabaseStub({
      checkup_items: [{ data: [] }],
      conditions: [{ data: [{ id: "cond-1", name: "Узел" }] }],
      medical_records: [{ data: null }],
    });
    const review = await reviewCheckupProposals(
      stub.client,
      "p-1",
      [ultrasound],
      "rec-x",
      "2026-10-26",
    );
    expect(review.accepted).toEqual([]);
    expect(review.refused[0].reason).toContain("evidence_record_id");
  });

  it("writes the anchor, the condition link and where it came from", async () => {
    const stub = createSupabaseStub({
      checkup_items: [
        { data: [{ id: "k-1", title: ultrasound.title, next_due_at: "2027-03-06" }] },
      ],
    });
    const added = await addProposedCheckups(stub.client, "p-1", {
      accepted: [{ input: ultrasound, first_due_at: "2027-03-06", condition_name: "Узел" }],
      refused: [],
      evidence: { record_id: "rec-1", title: "УЗИ", record_date: "2026-03-06" },
    });

    expect(stub.argsFor("checkup_items", "insert")[0][0]).toEqual([
      {
        person_id: "p-1",
        title: "УЗИ щитовидной железы",
        category: "imaging",
        schedule: { type: "interval", every: 1, unit: "year", anchor_date: "2027-03-06" },
        why_text: "Узел 4 мм, контроль через год",
        why_links: [{ type: "condition", id: "cond-1", label: "Узел" }],
        notes: "Добавлено из Claude по записи «УЗИ» от 2026-03-06.",
      },
    ]);
    expect(added).toEqual([{ id: "k-1", title: ultrasound.title, next_due_at: "2027-03-06" }]);
  });
});
