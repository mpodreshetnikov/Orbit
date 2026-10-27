import { assertEquals } from "std/assert/assert-equals";
import { gateFindingResolutions, parseClientSubmission } from "./client-parse.ts";

// A finding whose site the catalogue never resolved can still be closed by a document that denies
// it at the same printed site; the site hierarchy needs codes, so it does not apply there.

const CATALOGS = {
  existingFindings: [
    {
      finding_code: null,
      finding_type_text: "Киста",
      site_code: null,
      body_site_text: "Левый яичник",
      finding_type_id: null,
      body_site_id: null,
    },
  ],
  findingTypeCatalog: [],
  bodySiteCatalog: [],
};

const DOCUMENT = "Левый яичник: киста не выявлена.";

function closure() {
  return {
    finding_code: null,
    finding_type_text: "Киста",
    site_code: null,
    body_site_text: "Левый яичник",
    reason: "не выявлена",
    source_anchor: "киста не выявлена",
    confidence: 0.9,
  };
}

function absence(site: string) {
  return {
    finding_code: null,
    finding_type_text: "Киста",
    site_code: null,
    body_site_text: site,
    source_anchor: "киста не выявлена",
    confidence: 0.9,
  };
}

Deno.test("an uncoded finding closes on an absence at the same printed site", () => {
  const result = gateFindingResolutions(
    [closure()],
    [absence("левый  яичник")],
    DOCUMENT,
    CATALOGS,
  );
  assertEquals(result.rejected, []);
  assertEquals(result.accepted.length, 1);
});

Deno.test("an uncoded finding does not close on an absence at another printed site", () => {
  const result = gateFindingResolutions(
    [closure()],
    [absence("правый яичник")],
    DOCUMENT,
    CATALOGS,
  );
  assertEquals(result.accepted, []);
  assertEquals(
    result.rejected[0].reason,
    "no asserted absence in this document covers the finding",
  );
});

Deno.test("a value whose unit its analyte cannot take is reported, not filed", () => {
  const outcome = parseClientSubmission(
    {
      classification: { record_type: "lab", title: "ОАК", record_date: "2026-03-06" },
      extraction: {
        observations: [
          {
            obs_name: "Альбумин",
            value: "5.1",
            value_numeric: 5.1,
            unit: "г/дл",
            source_anchor: "Альбумин 5.1 г/дл",
            confidence: 0.9,
          },
        ],
        findings: [],
        conditions: [],
        asserted_absences: [],
      },
    },
    "Альбумин 5.1 г/дл",
    {
      observationCatalog: [
        {
          id: "albumin",
          obs_code: "albumin",
          name_ru: "Альбумин",
          name_en: "Albumin",
          canonical_unit: "g/L",
          synonyms_ru: [],
          synonyms_en: [],
          accepted_units: {},
        },
      ],
      findingTypeCatalog: [],
      bodySiteCatalog: [],
      existingConditions: [],
      existingFindings: [],
      checkupItems: [],
    },
  );
  assertEquals(outcome.structured.observations[0].obs_code, null);
  const rejection = outcome.rejected?.find((item) => item.entityKind === "observation");
  assertEquals(
    rejection?.reason.startsWith('"Альбумин" 5.1 г/дл: the label names albumin (Альбумин)'),
    true,
  );
});
