import { describe, expect, it } from "vitest";
import { getCheckup, listCheckups } from "./checkups";
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
