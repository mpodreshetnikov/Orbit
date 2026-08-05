import { describe, expect, it } from "vitest";
import { aggregate, keyed, matchKey, scoreCase, scoreSet, valuesEqual } from "./score";
import type { CaseSnapshot, ExpectedObservation } from "./types";

function observation(overrides: Partial<ExpectedObservation> = {}): ExpectedObservation {
  return {
    obs_name: "Глюкоза",
    obs_code: "glucose",
    value_numeric: 5.33,
    unit: "ммоль/л",
    ref_range_low: 4.1,
    ref_range_high: 5.9,
    status: "normal",
    value_canonical: 5.33,
    unit_canonical: "mmol/L",
    is_applied: true,
    ...overrides,
  };
}

function snapshot(overrides: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    record_type: "lab",
    record_date: "2026-03-06",
    observations: [observation()],
    findings: [],
    conditions: [],
    findings_to_resolve: [],
    conditions_to_resolve: [],
    checkups_to_complete: [],
    ...overrides,
  };
}

describe("matchKey", () => {
  it("folds Cyrillic homoglyphs so В12 and B12 are the same analyte", () => {
    expect(matchKey("Витамин В12")).toBe(matchKey("Витамин B12"));
  });

  it("ignores case, surrounding space and trailing punctuation", () => {
    expect(matchKey("  Глюкоза.  ")).toBe(matchKey("глюкоза"));
  });

  it("does not collapse genuinely different analytes", () => {
    expect(matchKey("Холестерин ЛПВП")).not.toBe(matchKey("Холестерин ЛПНП"));
  });
});

describe("valuesEqual", () => {
  it("treats null and undefined as absent", () => {
    expect(valuesEqual(null, undefined)).toBe(true);
    expect(valuesEqual(null, 0)).toBe(false);
  });

  it("compares floats with tolerance", () => {
    expect(valuesEqual(519.552, 519.552000001)).toBe(true);
    expect(valuesEqual(519.552, 704)).toBe(false);
  });
});

describe("scoreSet", () => {
  it("counts a duplicate in the output as a false positive", () => {
    const score = scoreSet([keyed("a")], [keyed("a"), keyed("a")]);
    expect(score).toMatchObject({ tp: 1, fp: 1, fn: 0 });
  });

  it("is perfect when both sides are empty", () => {
    expect(scoreSet([], [])).toMatchObject({ tp: 0, fp: 0, fn: 0, precision: 1, recall: 1 });
  });
});

describe("scoreCase", () => {
  it("scores an exact reproduction as perfect", () => {
    const score = scoreCase("case", snapshot(), snapshot());
    expect(score.recordType.correct).toBe(true);
    expect(score.recordDate.correct).toBe(true);
    expect(score.observations).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    expect(score.observationFields.every((field) => field.accuracy === 1)).toBe(true);
  });

  it("flags the wrong date when several are plausible", () => {
    const score = scoreCase("case", snapshot(), snapshot({ record_date: "2026-03-11" }));
    expect(score.recordDate).toMatchObject({
      correct: false,
      expected: "2026-03-06",
      actual: "2026-03-11",
    });
  });

  it("reports a missed observation as recall, not as a field error", () => {
    const expected = snapshot({ observations: [observation(), observation({ obs_name: "АЛТ" })] });
    const score = scoreCase("case", expected, snapshot());
    expect(score.observations).toMatchObject({ tp: 1, fp: 0, fn: 1 });
    expect(score.observations.falseNegatives).toEqual(["АЛТ"]);
    // The unmatched row must not be charged against all nine fields — one miss would otherwise
    // swamp every field accuracy at once.
    expect(score.observationFields.every((field) => field.total === 1)).toBe(true);
  });

  it("reports an invented observation as precision loss", () => {
    const actual = snapshot({
      observations: [observation(), observation({ obs_name: "Ферритин" })],
    });
    const score = scoreCase("case", snapshot(), actual);
    expect(score.observations).toMatchObject({ tp: 1, fp: 1, fn: 0 });
    expect(score.observations.falsePositives).toEqual(["Ферритин"]);
  });

  it("catches an unconverted unit that was relabelled as canonical", () => {
    // The real defect the corpus encodes: 704 pg/mL should become 519.552 pmol/L, but an
    // unmatched Cyrillic unit leaves the value untouched while still stamping the canonical unit.
    const expected = snapshot({
      observations: [
        observation({
          obs_name: "Витамин В12",
          value_canonical: 519.552,
          unit_canonical: "pmol/L",
        }),
      ],
    });
    const actual = snapshot({
      observations: [
        observation({ obs_name: "Витамин В12", value_canonical: 704, unit_canonical: "pmol/L" }),
      ],
    });
    const score = scoreCase("case", expected, actual);
    expect(score.observations.tp).toBe(1);
    const canonical = score.observationFields.find((field) => field.field === "value_canonical");
    expect(canonical).toMatchObject({ correct: 0, total: 1 });
    expect(canonical?.mismatches[0]).toMatchObject({ expected: 519.552, actual: 704 });
    // The unit label matches, which is precisely why the value error is easy to miss by eye.
    expect(
      score.observationFields.find((field) => field.field === "unit_canonical")?.accuracy,
    ).toBe(1);
  });

  it("separates a wrongful condition closure from a missed one", () => {
    const expected = snapshot({ conditions_to_resolve: [{ condition_id: "cond-b12" }] });
    const actual = snapshot({
      conditions_to_resolve: [{ condition_id: "cond-anemia" }, { condition_id: "cond-nafld" }],
    });
    const score = scoreCase("case", expected, actual);
    expect(score.conditionsToResolve).toMatchObject({ tp: 0, fp: 2, fn: 1 });
    expect(score.conditionsToResolve.falsePositives).toEqual(["cond-anemia", "cond-nafld"]);
    expect(score.conditionsToResolve.falseNegatives).toEqual(["cond-b12"]);
  });

  it("scores a checkup matched on id but suggested for the wrong day", () => {
    const expected = snapshot({
      checkups_to_complete: [{ checkup_item_id: "chk-1", suggested_done_at: "2026-03-06" }],
    });
    const actual = snapshot({
      checkups_to_complete: [{ checkup_item_id: "chk-1", suggested_done_at: "2026-03-11" }],
    });
    const score = scoreCase("case", expected, actual);
    expect(score.checkupsToComplete).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    expect(score.checkupDate).toMatchObject({ correct: 0, total: 1 });
  });
});

describe("aggregate", () => {
  it("surfaces wrongful resolutions as their own headline number", () => {
    const clean = scoreCase("a", snapshot(), snapshot());
    const dirty = scoreCase(
      "b",
      snapshot(),
      snapshot({ conditions_to_resolve: [{ condition_id: "cond-gastritis" }] }),
    );
    const agg = aggregate([clean, dirty]);
    expect(agg.cases).toBe(2);
    expect(agg.wrongfulResolutions).toBe(1);
    expect(agg.conditionsToResolve.falsePositives).toEqual(["cond-gastritis"]);
  });

  it("counts record_date accuracy across cases", () => {
    const good = scoreCase("a", snapshot(), snapshot());
    const bad = scoreCase("b", snapshot(), snapshot({ record_date: "2026-03-07" }));
    expect(aggregate([good, bad]).recordDateAccuracy).toBe(0.5);
  });
});
