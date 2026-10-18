import { describe, expect, it } from "vitest";
import { countDue, presentDoses, type DoseEventForDisplay } from "@/features/doses/present";

function event(overrides: Partial<DoseEventForDisplay> = {}): DoseEventForDisplay {
  return {
    id: "dose-1",
    actual_at: "2026-10-18T06:30:00.000Z",
    status: "scheduled",
    planned_intake: { intake: { amount: 1, unit: "pill" } },
    regimen: { custom_name: "Магний B6" },
    ...overrides,
  };
}

describe("presentDoses", () => {
  it("carries the medication's own name through unchanged", () => {
    expect(presentDoses([event()])[0]?.name).toBe("Магний B6");
  });

  it("writes the time in the phone's locale rather than in UTC", () => {
    const expected = new Date("2026-10-18T06:30:00.000Z").toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(presentDoses([event()])[0]?.time).toBe(expected);
  });

  it("falls back visibly rather than crashing on an unparseable timestamp", () => {
    expect(presentDoses([event({ actual_at: "not a date" })])[0]?.time).toBe("--:--");
  });

  it("omits an amount of one, which would say nothing beside a name", () => {
    expect(presentDoses([event()])[0]?.amount).toBeNull();
  });

  it("shows an amount that is not one", () => {
    const events = [event({ planned_intake: { intake: { amount: 2, unit: "pill" } } })];
    expect(presentDoses(events)[0]?.amount).toBe("2");
  });

  it.each([
    undefined,
    null,
    "nonsense",
    {},
    { intake: null },
    { intake: {} },
    { intake: { amount: "2" } },
    { intake: { amount: Number.NaN } },
  ])("treats an unusable planned_intake as no amount: %o", (plannedIntake) => {
    expect(presentDoses([event({ planned_intake: plannedIntake })])[0]?.amount).toBeNull();
  });

  it("does not invent a per-intake strength from unit_strength (ADR-260907-cvj)", () => {
    const events = [
      event({
        planned_intake: {
          intake: { amount: 2, unit: "pill" },
          unit_strength: [{ name: "magnesium", amount: 100, unit: "milligram" }],
        },
      }),
    ];
    expect(presentDoses(events)[0]?.amount).toBe("2");
  });

  it("names the medication as an em dash when the join returned nothing", () => {
    expect(presentDoses([event({ regimen: null })])[0]?.name).toBe("—");
  });

  it.each([
    ["scheduled", "due"],
    ["sent", "due"],
    ["snoozed", "due"],
    ["taken", "taken"],
    ["skipped", "skipped"],
    ["missed", "missed"],
    ["cancelled", "skipped"],
  ] as const)("maps status %s to state %s", (status, state) => {
    expect(presentDoses([event({ status })])[0]?.state).toBe(state);
  });

  it("keeps the order the query returned, which is the order of the day", () => {
    const cards = presentDoses([
      event({ id: "a", actual_at: "2026-10-18T06:00:00.000Z" }),
      event({ id: "b", actual_at: "2026-10-18T18:00:00.000Z" }),
    ]);
    expect(cards.map((card) => card.id)).toEqual(["a", "b"]);
  });
});

describe("countDue", () => {
  it("counts only what is still to be taken", () => {
    const cards = presentDoses([
      event({ id: "a", status: "scheduled" }),
      event({ id: "b", status: "snoozed" }),
      event({ id: "c", status: "taken" }),
      event({ id: "d", status: "missed" }),
    ]);
    expect(countDue(cards)).toBe(2);
  });

  it("is zero for an empty day", () => {
    expect(countDue([])).toBe(0);
  });
});
