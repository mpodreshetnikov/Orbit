import { describe, expect, it } from "@jest/globals";
import { buildDashboard, withStatus } from "@/features/doses/dashboard";
import type { DayDose, DoseStatus } from "@/features/doses/model";

const NOW = new Date(2026, 9, 21, 12, 0);

function dose(
  id: string,
  hour: number,
  status: DoseStatus = "scheduled",
  extra: Partial<DayDose> = {},
): DayDose {
  return {
    id,
    regimen_id: `r-${id}`,
    actual_at: new Date(2026, 9, 21, hour, 0).toISOString(),
    taken_at: null,
    status,
    planned_intake: { intake: { amount: 1 } },
    regimen: {
      custom_name: `Лекарство ${id}`,
      intake_unit: "pill",
      intake_advice_type: null,
      intake_advice_text: null,
      schedule: { mode: "daily_times", times: [] },
    },
    ...extra,
  };
}

const today = { now: NOW, isToday: true, recentlyActed: new Set<string>() };

describe("buildDashboard", () => {
  it("keeps doses ahead pending and groups them by time", () => {
    const board = buildDashboard([dose("a", 18), dose("b", 14), dose("c", 18)], today);
    expect(board.pending.map((slot) => [slot.time, slot.doses.map((one) => one.id)])).toEqual([
      ["14:00", ["b"]],
      ["18:00", ["a", "c"]],
    ]);
    expect(board.completedCount).toBe(0);
  });

  it("keeps a passed open dose pending on today and marks it overdue", () => {
    const board = buildDashboard([dose("a", 9)], today);
    expect(board.pending[0]?.doses[0]?.id).toBe("a");
    expect(board.overdueIds.has("a")).toBe(true);
  });

  it("does not hold a passed one-off intake as overdue", () => {
    const oneOff = dose("a", 9, "scheduled", {
      regimen: { ...dose("x", 0).regimen!, schedule: { mode: "one_off" } },
    });
    const board = buildDashboard([oneOff], today);
    expect(board.overdueIds.size).toBe(0);
    expect(board.completedCount).toBe(1);
  });

  it("moves settled doses to the completed section", () => {
    const board = buildDashboard([dose("a", 8, "taken"), dose("b", 9, "skipped")], today);
    expect(board.pending).toEqual([]);
    expect(board.completedCount).toBe(2);
  });

  it("keeps a dose acted on a moment ago where it was", () => {
    const board = buildDashboard([dose("a", 8, "taken")], {
      ...today,
      recentlyActed: new Set(["a"]),
    });
    expect(board.pending[0]?.doses[0]?.id).toBe("a");
    expect(board.completedCount).toBe(0);
  });

  it("marks nothing overdue on a past day: passed open doses are history there", () => {
    const board = buildDashboard([dose("a", 9)], { ...today, isToday: false });
    expect(board.overdueIds.size).toBe(0);
    expect(board.completedCount).toBe(1);
  });

  it("sorts a taken dose by when it was taken", () => {
    const taken = dose("a", 8, "taken", { taken_at: new Date(2026, 9, 21, 10, 30).toISOString() });
    const board = buildDashboard([taken], today);
    expect(board.completed[0]?.time).toBe("10:30");
  });
});

describe("withStatus", () => {
  it("changes only the named dose", () => {
    const at = new Date(NOW).toISOString();
    const list = withStatus([dose("a", 9), dose("b", 10)], "a", "taken", at);
    expect(list.map((one) => [one.status, one.taken_at])).toEqual([
      ["taken", at],
      ["scheduled", null],
    ]);
  });
});
