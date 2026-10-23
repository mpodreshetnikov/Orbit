import { describe, expect, it } from "vitest";
import type { CheckupItem } from "./checkup";
import {
  checkupLateness,
  groupCheckups,
  isoDay,
  rowToCheckupCompletion,
  rowToCheckupItem,
  searchCheckups,
} from "./checkup-summary";

const NOW = new Date("2026-10-21T12:00:00Z");

const item = (id: string, extra: Partial<CheckupItem> = {}): CheckupItem => ({
  id,
  person_id: "p",
  title: id,
  category: "lab",
  schedule: { type: "interval", every: 1, unit: "year" },
  next_due_at: null,
  status: "active",
  reminder_days_before: [7],
  planned_on: null,
  why_text: null,
  why_links: [],
  notes: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...extra,
});

describe("rowToCheckupItem", () => {
  it("keeps condition links, labels them by id when unlabelled, and defaults the reminders", () => {
    const row = {
      ...item("a"),
      why_links: [
        { type: "condition", id: "c1", label: "Анемия" },
        { type: "condition", id: "c2" },
        { type: "other", id: "x" },
        { type: "condition" },
        null,
      ],
      reminder_days_before: null,
      next_due_at: undefined,
    };
    expect(rowToCheckupItem(row)).toMatchObject({
      why_links: [
        { type: "condition", id: "c1", label: "Анемия" },
        { type: "condition", id: "c2", label: "c2" },
      ],
      reminder_days_before: [7],
      next_due_at: null,
    });
    expect(
      rowToCheckupItem({ ...item("b"), why_links: null, reminder_days_before: [3, "1"] }),
    ).toMatchObject({ why_links: [], reminder_days_before: [3] });
  });

  it("reads a completion", () => {
    expect(
      rowToCheckupCompletion({
        id: "d",
        checkup_item_id: "a",
        done_at: "2026-10-01",
        created_at: "2026-10-01T00:00:00Z",
      }),
    ).toEqual({
      id: "d",
      checkup_item_id: "a",
      done_at: "2026-10-01",
      note: null,
      evidence_record_id: null,
      created_at: "2026-10-01T00:00:00Z",
    });
  });
});

describe("checkupLateness", () => {
  const today = isoDay(NOW);

  it("takes today as the local calendar day, not the UTC one", () => {
    expect(isoDay(new Date(2026, 9, 22, 23, 30))).toBe("2026-10-22");
    expect(isoDay(new Date(2026, 0, 3, 0, 15))).toBe("2026-01-03");
  });

  it("is late by due date, or by plan while the due date is ahead", () => {
    expect(checkupLateness(item("a", { next_due_at: "2026-10-01" }), today)).toEqual({
      byDue: true,
      byPlan: false,
    });
    expect(
      checkupLateness(item("a", { next_due_at: "2026-12-01", planned_on: "2026-10-01" }), today),
    ).toEqual({ byDue: false, byPlan: true });
    expect(checkupLateness(item("a", { planned_on: "2026-10-01" }), today).byPlan).toBe(true);
  });

  it("is never late while not active", () => {
    expect(
      checkupLateness(item("a", { status: "paused", next_due_at: "2026-10-01" }), today),
    ).toEqual({ byDue: false, byPlan: false });
  });
});

describe("searchCheckups", () => {
  it("matches the title, ignoring case and a blank query", () => {
    const items = [item("Анализ крови"), item("Окулист")];
    expect(searchCheckups(items, " ")).toBe(items);
    expect(searchCheckups(items, "АНАЛИЗ").map((i) => i.id)).toEqual(["Анализ крови"]);
  });
});

describe("groupCheckups", () => {
  it("splits into overdue, this week, later and the rest", () => {
    const groups = groupCheckups(
      [
        item("late", { next_due_at: "2026-10-01" }),
        item("planLate", { next_due_at: "2026-12-01", planned_on: "2026-10-10" }),
        item("soon", { next_due_at: "2026-10-25" }),
        item("later", { next_due_at: "2026-12-01" }),
        item("undue"),
        item("paused", { status: "paused", next_due_at: "2026-10-01" }),
      ],
      NOW,
    );
    const ids = Object.fromEntries(
      Object.entries(groups).map(([name, list]) => [name, list.map((i) => i.id)]),
    );
    expect(ids).toEqual({
      overdue: ["late", "planLate"],
      upcoming: ["soon"],
      later: ["later"],
      rest: ["undue", "paused"],
    });
  });
});
