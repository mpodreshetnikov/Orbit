import { describe, expect, it } from "vitest";
import { aggregate, keyed, matchKey, scoreCase, scoreSet, valuesEqual } from "./score";
import type { ExistingFinding } from "../../supabase/functions/health-structure/types.ts";
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
    const score = scoreCase("case", snapshot(), snapshot(), []);
    expect(score.recordType.correct).toBe(true);
    expect(score.recordDate.correct).toBe(true);
    expect(score.observations).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    expect(score.observationFields.every((field) => field.accuracy === 1)).toBe(true);
  });

  it("flags the wrong date when several are plausible", () => {
    const score = scoreCase("case", snapshot(), snapshot({ record_date: "2026-03-11" }), []);
    expect(score.recordDate).toMatchObject({
      correct: false,
      expected: "2026-03-06",
      actual: "2026-03-11",
    });
  });

  it("reports a missed observation as recall, not as a field error", () => {
    const expected = snapshot({ observations: [observation(), observation({ obs_name: "АЛТ" })] });
    const score = scoreCase("case", expected, snapshot(), []);
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
    const score = scoreCase("case", snapshot(), actual, []);
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
    const score = scoreCase("case", expected, actual, []);
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
    const score = scoreCase("case", expected, actual, []);
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
    const score = scoreCase("case", expected, actual, []);
    expect(score.checkupsToComplete).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    expect(score.checkupDate).toMatchObject({ correct: 0, total: 1 });
  });
});

describe("finding fields", () => {
  const finding = {
    finding_code: null,
    finding_type_text: "Избыточная подвижность правой почки",
    site_code: "kidney_right",
    body_site_text: "правая почка",
    size_mm: null,
    severity: "unknown",
    laterality: "right",
  };

  it("scores the deterministic half of a finding row, not just its presence", () => {
    const score = scoreCase(
      "002",
      snapshot({ findings: [finding] }),
      snapshot({ findings: [{ ...finding, site_code: "kidney_left", laterality: "left" }] }),
      [],
    );
    // The set still matches — same label — so without field scoring this read as a clean hit
    // while the pipeline had put the finding on the wrong kidney.
    expect(score.findings).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    const site = score.findingFields.find((f) => f.field === "site_code");
    expect(site).toMatchObject({ correct: 0, total: 1 });
    expect(site?.mismatches[0]).toMatchObject({ expected: "kidney_right", actual: "kidney_left" });
    expect(score.findingFields.find((f) => f.field === "laterality")?.accuracy).toBe(0);
  });

  it("catches a wrongly resolved finding code", () => {
    // The finding-side twin of Холестерин ЛПВП → cholesterol_total: a null code is correct here
    // and any resolved code is an invention.
    const score = scoreCase(
      "002",
      snapshot({ findings: [finding] }),
      snapshot({ findings: [{ ...finding, finding_code: "prolapse" }] }),
      [],
    );
    const code = score.findingFields.find((f) => f.field === "finding_code");
    expect(code).toMatchObject({ correct: 0, total: 1 });
    expect(code?.mismatches[0]).toMatchObject({ expected: null, actual: "prolapse" });
  });

  it("does not compare finding_type_text, which is the match key", () => {
    expect(score_fields_of()).not.toContain("finding_type_text");
    function score_fields_of() {
      return scoreCase("002", snapshot({ findings: [finding] }), snapshot(), []).findingFields.map(
        (f) => f.field,
      );
    }
  });

  it("leaves an unmatched finding out of the field totals", () => {
    // Already counted as a recall miss; charging it again on six fields would swamp them.
    const score = scoreCase("002", snapshot({ findings: [finding] }), snapshot(), []);
    expect(score.findings).toMatchObject({ tp: 0, fn: 1 });
    expect(score.findingFields.every((f) => f.total === 0)).toBe(true);
  });
});

describe("findings_to_resolve", () => {
  // Case 002's patient state: a right-kidney stone the document should close, and a gallbladder
  // polyp it must not touch.
  const EXISTING: ExistingFinding[] = [
    {
      finding_code: "stone",
      finding_type_text: "конкремент",
      site_code: "kidney_right",
      body_site_text: "правая почка",
      finding_type_id: "ft-1",
      body_site_id: "bs-1",
    },
    {
      finding_code: "polyp",
      finding_type_text: "полип",
      site_code: "gallbladder",
      body_site_text: "желчный пузырь",
      finding_type_id: "ft-2",
      body_site_id: "bs-2",
    },
  ];

  const stone = {
    finding_code: "stone",
    finding_type_text: "конкремент",
    site_code: "kidney_right",
  };

  it("scores a matching resolution as a true positive", () => {
    const score = scoreCase(
      "002",
      snapshot({ findings_to_resolve: [stone] }),
      snapshot({ findings_to_resolve: [stone] }),
      EXISTING,
    );
    expect(score.findingsToResolve).toMatchObject({ tp: 1, fp: 0, fn: 0 });
  });

  it("treats the same finding on a different organ as wrong, not as a match", () => {
    // A document that clears one organ says nothing about the same finding elsewhere.
    const score = scoreCase(
      "002",
      snapshot({ findings_to_resolve: [stone] }),
      snapshot({
        findings_to_resolve: [
          { finding_code: "stone", finding_type_text: "конкремент", site_code: "kidney_left" },
        ],
      }),
      EXISTING,
    );
    expect(score.findingsToResolve).toMatchObject({ tp: 0, fp: 1, fn: 1 });
  });

  it("matches on the row that would close, not on how the finding was worded", () => {
    // Production keys on finding_code + site_code before it ever looks at the text
    // (resolution.ts:matchExistingFinding). A rephrased label closes the same row, so scoring it
    // as a miss *and* an invention would report a defect that does not exist.
    const score = scoreCase(
      "002",
      snapshot({ findings_to_resolve: [stone] }),
      snapshot({
        findings_to_resolve: [
          {
            finding_code: "stone",
            finding_type_text: "конкремент в правой почке, 4 мм",
            site_code: "kidney_right",
          },
        ],
      }),
      EXISTING,
    );
    expect(score.findingsToResolve).toMatchObject({ tp: 1, fp: 0, fn: 0 });
  });

  it("does not let copied text rescue a resolution carrying the wrong code", () => {
    // The mirror image, and the dangerous direction: production would resolve the polyp row or
    // nothing at all. Keying on the text would have scored this a clean hit.
    const score = scoreCase(
      "002",
      snapshot({ findings_to_resolve: [stone] }),
      snapshot({
        findings_to_resolve: [
          { finding_code: "polyp", finding_type_text: "конкремент", site_code: "gallbladder" },
        ],
      }),
      EXISTING,
    );
    expect(score.findingsToResolve).toMatchObject({ tp: 0, fp: 1, fn: 1 });
  });

  it("still matches by text and body site when no code resolved", () => {
    const uncoded = { finding_type_text: "Конкремент", body_site_text: "Правая почка" };
    const score = scoreCase(
      "002",
      snapshot({ findings_to_resolve: [uncoded] }),
      snapshot({
        findings_to_resolve: [{ finding_type_text: "конкремент", body_site_text: "правая почка" }],
      }),
      EXISTING,
    );
    expect(score.findingsToResolve).toMatchObject({ tp: 1, fp: 0, fn: 0 });
  });

  it("labels a resolution that addresses no existing row as closing nothing", () => {
    const score = scoreCase(
      "002",
      snapshot(),
      snapshot({
        findings_to_resolve: [{ finding_type_text: "киста", site_code: "liver" }],
      }),
      EXISTING,
    );
    expect(score.findingsToResolve).toMatchObject({ tp: 0, fp: 1, fn: 0 });
    expect(score.findingsToResolve.falsePositives[0]).toContain("closes nothing");
  });
});

describe("aggregate", () => {
  it("counts a wrongfully closed finding as a wrongful resolution", () => {
    // Case 002's gallbladder polyp: a renal scan is silent on it, so closing it is a real closure
    // of a live row — the same class of harm as closing a condition, and it has to reach the
    // same headline number.
    const existing: ExistingFinding[] = [
      {
        finding_code: "polyp",
        finding_type_text: "полип",
        site_code: "gallbladder",
        body_site_text: "желчный пузырь",
        finding_type_id: "ft-2",
        body_site_id: "bs-2",
      },
    ];
    const score = scoreCase(
      "002",
      snapshot(),
      snapshot({
        findings_to_resolve: [
          { finding_code: "polyp", finding_type_text: "полип", site_code: "gallbladder" },
        ],
      }),
      existing,
    );
    const agg = aggregate([score]);
    expect(agg.wrongfulResolutions).toBe(1);
    expect(agg.findingsToResolve.falsePositives).toEqual(["полип @ gallbladder"]);
  });

  it("surfaces wrongful resolutions as their own headline number", () => {
    const clean = scoreCase("a", snapshot(), snapshot(), []);
    const dirty = scoreCase(
      "b",
      snapshot(),
      snapshot({ conditions_to_resolve: [{ condition_id: "cond-gastritis" }] }),
      [],
    );
    const agg = aggregate([clean, dirty]);
    expect(agg.cases).toBe(2);
    expect(agg.wrongfulResolutions).toBe(1);
    expect(agg.conditionsToResolve.falsePositives).toEqual(["cond-gastritis"]);
  });

  it("counts record_date accuracy across cases", () => {
    const good = scoreCase("a", snapshot(), snapshot(), []);
    const bad = scoreCase("b", snapshot(), snapshot({ record_date: "2026-03-07" }), []);
    expect(aggregate([good, bad]).recordDateAccuracy).toBe(0.5);
  });
});
