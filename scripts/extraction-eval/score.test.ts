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

  it("catches a resolution on the right condition citing the wrong analyte", () => {
    // The set score cannot see this: the condition matches, so it reads as a clean true positive
    // while production discards the row -- `checkLabResolution` refuses a citation the table does
    // not tie to this condition. Before `supporting_obs_code` was scored, that was invisible.
    const expected = snapshot({
      conditions_to_resolve: [{ condition_id: "cond-b12", supporting_obs_code: "vitamin_b12" }],
    });
    const actual = snapshot({
      conditions_to_resolve: [{ condition_id: "cond-b12", supporting_obs_code: "ferritin" }],
    });
    const score = scoreCase("case", expected, actual, []);
    expect(score.conditionsToResolve).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    const cited = score.conditionResolutionFields.find((f) => f.field === "supporting_obs_code");
    expect(cited).toMatchObject({ correct: 0, total: 1 });
    expect(cited?.mismatches[0]).toMatchObject({
      key: "cond-b12",
      expected: "vitamin_b12",
      actual: "ferritin",
    });
  });

  it("catches a resolution that cites nothing at all", () => {
    // The gate's first rejection is `noCitation`, so an uncited resolution closes nothing. It has
    // to score as a field miss rather than as a match, or a run of them reads as a clean sweep.
    const score = scoreCase(
      "case",
      snapshot({
        conditions_to_resolve: [{ condition_id: "cond-b12", supporting_obs_code: "vitamin_b12" }],
      }),
      snapshot({
        conditions_to_resolve: [{ condition_id: "cond-b12", supporting_obs_code: null }],
      }),
      [],
    );
    expect(
      score.conditionResolutionFields.find((f) => f.field === "supporting_obs_code"),
    ).toMatchObject({ correct: 0, total: 1 });
  });

  it("does not charge the citation against a resolution the model never proposed", () => {
    // Matched rows only. A missing resolution is already a recall miss; counting it again here
    // would let one absent row read as a citation defect it never had the chance to commit.
    const score = scoreCase(
      "case",
      snapshot({
        conditions_to_resolve: [{ condition_id: "cond-b12", supporting_obs_code: "vitamin_b12" }],
      }),
      snapshot({ conditions_to_resolve: [] }),
      [],
    );
    expect(score.conditionsToResolve).toMatchObject({ tp: 0, fn: 1 });
    expect(
      score.conditionResolutionFields.find((f) => f.field === "supporting_obs_code"),
    ).toMatchObject({ correct: 0, total: 0 });
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

describe("condition fields", () => {
  const condition = {
    name: "Доброкачественное новообразование восходящей ободочной кишки",
    icd_code: "D12.2",
    status: "active",
  };

  it("catches a matched condition carrying the wrong ICD code", () => {
    // Conditions were keyed on the name alone, so this scored as a clean true positive and case
    // 003's D12.2 was advertised coverage that did not exist.
    const score = scoreCase(
      "003",
      snapshot({ conditions: [condition] }),
      snapshot({ conditions: [{ ...condition, icd_code: null }] }),
      [],
    );
    expect(score.conditions).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    const icd = score.conditionFields.find((f) => f.field === "icd_code");
    expect(icd).toMatchObject({ correct: 0, total: 1 });
    expect(icd?.mismatches[0]).toMatchObject({ expected: "D12.2", actual: null });
  });

  it("catches a condition filed under the wrong status", () => {
    const score = scoreCase(
      "003",
      snapshot({ conditions: [condition] }),
      snapshot({ conditions: [{ ...condition, status: "resolved" }] }),
      [],
    );
    expect(score.conditionFields.find((f) => f.field === "status")?.accuracy).toBe(0);
  });

  it("does not compare the name, which is the match key", () => {
    const fields = scoreCase(
      "003",
      snapshot({ conditions: [condition] }),
      snapshot(),
      [],
    ).conditionFields.map((f) => f.field);
    expect(fields).not.toContain("name");
    expect(fields).toEqual(["icd_code", "status"]);
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

  it("matches a finding the model named differently", () => {
    // The reason the key is position and not prose. The document prints this finding twice —
    // "избыточно подвижна правая" in the body, "Избыточная подвижность правой почки" in the
    // ЗАКЛЮЧЕНИЕ — so keying on the label scored a correctly-found finding as a miss plus an
    // invention. Same organ, same side: same finding.
    const score = scoreCase(
      "002",
      snapshot({ findings: [finding] }),
      snapshot({ findings: [{ ...finding, finding_type_text: "избыточно подвижна" }] }),
      [],
    );
    expect(score.findings).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    // The disagreement is not lost — it reports as a field mismatch, which is what it is.
    const label = score.findingFields.find((f) => f.field === "finding_type_text");
    expect(label).toMatchObject({ correct: 0, total: 1 });
  });

  it("catches a wrongly resolved finding code", () => {
    // The finding-side twin of Холестерин ЛПВП → cholesterol_total: a null code is correct here
    // and any resolved code is an invention. Visible only because the code is a field, not the key.
    const score = scoreCase(
      "002",
      snapshot({ findings: [finding] }),
      snapshot({ findings: [{ ...finding, finding_code: "prolapse" }] }),
      [],
    );
    expect(score.findings).toMatchObject({ tp: 1, fp: 0, fn: 0 });
    const code = score.findingFields.find((f) => f.field === "finding_code");
    expect(code).toMatchObject({ correct: 0, total: 1 });
    expect(code?.mismatches[0]).toMatchObject({ expected: null, actual: "prolapse" });
  });

  it("treats a finding put on the wrong organ as a different finding", () => {
    const score = scoreCase(
      "002",
      snapshot({ findings: [finding] }),
      snapshot({ findings: [{ ...finding, site_code: "kidney_left", laterality: "left" }] }),
      [],
    );
    expect(score.findings).toMatchObject({ tp: 0, fp: 1, fn: 1 });
  });

  it("compares what a finding is, never where it is", () => {
    const fields = scoreCase(
      "002",
      snapshot({ findings: [finding] }),
      snapshot(),
      [],
    ).findingFields.map((f) => f.field);
    // Site and laterality are the key; comparing them would score every matched row correct
    // by construction.
    expect(fields).not.toContain("site_code");
    expect(fields).not.toContain("laterality");
    expect(fields).toContain("finding_code");
    expect(fields).toContain("finding_type_text");
  });

  it("leaves an unmatched finding out of the field totals", () => {
    // Already counted as a recall miss; charging it again on every field would swamp them.
    const score = scoreCase("002", snapshot({ findings: [finding] }), snapshot(), []);
    expect(score.findings).toMatchObject({ tp: 0, fn: 1 });
    expect(score.findingFields.every((f) => f.total === 0)).toBe(true);
  });

  it("reports two findings sharing an organ and side as ambiguous rather than pairing them", () => {
    const other = { ...finding, finding_type_text: "киста", finding_code: "cyst" };
    const score = scoreCase(
      "002",
      snapshot({ findings: [finding, other] }),
      snapshot({ findings: [finding, other] }),
      [],
    );
    expect(score.findingKeyCollisions).toEqual(["kidney_right@right"]);
  });

  it("keeps uncoded sites apart by their free text instead of collapsing them", () => {
    const a = { ...finding, site_code: null, body_site_text: "правой почки" };
    const b = { ...finding, site_code: null, body_site_text: "левой почки" };
    const score = scoreCase(
      "002",
      snapshot({ findings: [a, b] }),
      snapshot({ findings: [a, b] }),
      [],
    );
    expect(score.findingKeyCollisions).toEqual([]);
    expect(score.findings).toMatchObject({ tp: 2, fp: 0, fn: 0 });
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
