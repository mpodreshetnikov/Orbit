import { describe, expect, it } from "vitest";
import {
  isInCurrentCycle,
  pickReconciliationSuggestions,
  reviewReconciliationDecision,
  type GateCheckup,
  type GateCondition,
} from "./reconciliation-gate";

/**
 * The owner's own case from 2026-10-26: a lab dated 2026-03-06 that ended two deficiencies and
 * covered eight checkups due 2026-03-01, ingested without a word about any of them.
 */
const CONDITIONS: GateCondition[] = [
  { id: "c-b12", name: "Недостаточность витамина B12", code: "E53.8", current_status: "active" },
  { id: "c-d", name: "Дефицит витамина D", code: "E55.9", current_status: "active" },
  { id: "c-opist", name: "Описторхоз", code: "B66.0", current_status: "suspected" },
  { id: "c-foll", name: "Фолликулиты", code: null, current_status: "resolved" },
  { id: "c-gerd", name: "Гастроэзофагеальный рефлюкс", code: "K21.9", current_status: "active" },
];

const YEARLY = { type: "interval", every: 1, unit: "year" };

function checkup(id: string, title: string, extra: Partial<GateCheckup> = {}): GateCheckup {
  return {
    id,
    title,
    category: "lab",
    schedule: YEARLY,
    next_due_at: "2026-03-01",
    last_done_at: null,
    ...extra,
  };
}

const CHECKUPS: GateCheckup[] = [
  checkup("k-lipid", "Липидный профиль"),
  checkup("k-chol", "Общий холестерин"),
  checkup("k-glu", "Глюкоза натощак"),
  checkup("k-liver", "АЛТ/АСТ/Билирубин/ГГТ"),
  checkup("k-b12", "Витамин B12"),
  checkup("k-d", "Витамин D"),
  checkup("k-cbc", "ОАК"),
  checkup("k-sti", "ЗППП скрининг"),
  checkup("k-us", "УЗИ брюшной полости", { category: "imaging" }),
];

const LAB_TEXT = [
  "Гемоглобин 152 г/л",
  "Лейкоциты 6.1",
  "Холестерин общий 4.9 ммоль/л",
  "ЛПНП 2.8",
  "Глюкоза 5.1 ммоль/л",
  "Аланинаминотрансфераза (АЛТ) 21 Ед/л",
  "Витамин D (25-OH) 31.08 нг/мл",
  "Витамин B12 704 пг/мл",
  "ВИЧ 1/2 антитела: не обнаружено",
].join("\n");

function pick(overrides: Partial<Parameters<typeof pickReconciliationSuggestions>[0]> = {}) {
  return pickReconciliationSuggestions({
    conditions: CONDITIONS,
    checkups: CHECKUPS,
    recordDate: "2026-03-06",
    sourceText: LAB_TEXT,
    observationLabels: [],
    today: "2026-10-26",
    ...overrides,
  });
}

describe("pickReconciliationSuggestions", () => {
  it("names both deficiencies the lab measured, and none it did not", () => {
    const ids = pick()
      .suggestions.filter((s) => s.kind === "condition")
      .map((s) => s.id);
    expect(ids).toEqual(["c-b12", "c-d"]);
  });

  it("names a suspected diagnosis the document mentions by name", () => {
    const result = pick({
      sourceText: `${LAB_TEXT}\nАт к Opisthorchis felineus (описторхоз) IgG отр.`,
    });
    expect(result.suggestions.map((s) => s.id)).toContain("c-opist");
  });

  it("never suggests a condition that is already resolved", () => {
    const result = pick({ sourceText: "Фолликулит волосистой части головы" });
    expect(result.suggestions.map((s) => s.id)).not.toContain("c-foll");
  });

  it("names the eight lab checkups the report covers and leaves the ultrasound as merely due", () => {
    const result = pick();
    expect(
      result.suggestions
        .filter((s) => s.kind === "checkup")
        .map((s) => s.id)
        .sort(),
    ).toEqual(["k-b12", "k-cbc", "k-chol", "k-d", "k-glu", "k-lipid", "k-liver", "k-sti"]);
    expect(result.alsoDue.map((s) => s.id)).toEqual(["k-us"]);
  });

  it("reads Latin and Cyrillic look-alikes as the same letters", () => {
    const result = pick({ sourceText: "Витамин В12 (цианокобаламин) 704", checkups: [] });
    expect(result.suggestions.map((s) => s.id)).toEqual(["c-b12"]);
  });

  it("suggests no checkup for a document without a date", () => {
    const result = pick({ recordDate: null });
    expect(result.suggestions.every((s) => s.kind === "condition")).toBe(true);
    expect(result.alsoDue).toEqual([]);
  });
});

describe("isInCurrentCycle", () => {
  const due = checkup("k", "Витамин D");

  it("takes a report from the year before the due date", () => {
    expect(isInCurrentCycle(due, "2026-03-06", "2026-10-26")).toBe(true);
    expect(isInCurrentCycle(due, "2025-03-02", "2026-10-26")).toBe(true);
  });

  it("refuses a report from a cycle long gone", () => {
    expect(isInCurrentCycle(due, "2024-04-25", "2026-10-26")).toBe(false);
  });

  it("refuses a report from before the last completion", () => {
    const done = { ...due, last_done_at: "2026-03-10" };
    expect(isInCurrentCycle(done, "2026-03-06", "2026-10-26")).toBe(false);
  });

  it("refuses a report dated in the future", () => {
    expect(isInCurrentCycle(due, "2026-11-01", "2026-10-26")).toBe(false);
  });

  it("measures the cycle by the schedule's own interval", () => {
    const quarterly = { ...due, schedule: { type: "interval", every: 3, unit: "month" } };
    expect(isInCurrentCycle(quarterly, "2025-12-15", "2026-10-26")).toBe(true);
    expect(isInCurrentCycle(quarterly, "2025-11-15", "2026-10-26")).toBe(false);
  });
});

describe("reviewReconciliationDecision", () => {
  const context = {
    suggestions: [
      { kind: "condition" as const, id: "c-d", label: "Дефицит витамина D", reason: "" },
      { kind: "checkup" as const, id: "k-d", label: "Витамин D", reason: "" },
    ],
    alsoDue: [],
  };

  it("refuses a submission that never decided", () => {
    expect(reviewReconciliationDecision(context, undefined)).toEqual({
      ok: false,
      missing: "decision",
      unruled: context.suggestions,
    });
  });

  it("refuses while any suggestion is neither acted on nor ruled out", () => {
    const verdict = reviewReconciliationDecision(context, {
      conditions_to_resolve: [{ condition_id: "c-d" }],
    });
    expect(verdict).toEqual({ ok: false, missing: "rulings", unruled: [context.suggestions[1]] });
  });

  it("accepts every suggestion acted on or ruled out with a reason", () => {
    expect(
      reviewReconciliationDecision(context, {
        conditions_to_resolve: [{ condition_id: "c-d" }],
        not_applicable: [{ id: "k-d", reason: "completed separately last week" }],
      }),
    ).toEqual({ ok: true });
  });

  it("refuses an empty decision without the flag, even with nothing suggested", () => {
    const empty = { suggestions: [], alsoDue: [] };
    expect(reviewReconciliationDecision(empty, {})).toEqual({
      ok: false,
      missing: "flag",
      unruled: [],
    });
    expect(reviewReconciliationDecision(empty, { nothing_to_reconcile: true })).toEqual({
      ok: true,
    });
  });

  it("does not let the flag stand in for a suggestion it ignores", () => {
    const verdict = reviewReconciliationDecision(context, { nothing_to_reconcile: true });
    expect(verdict.ok).toBe(false);
  });
});
