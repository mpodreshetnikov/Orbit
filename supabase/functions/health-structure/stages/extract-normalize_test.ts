import { assertEquals } from "std/assert/assert-equals";
import { normalizeExtraction } from "./extract-normalize.ts";

// The same checks run whoever produced the extraction, so these call the deterministic half
// directly, with no model in the loop: this is the path an extraction submitted over MCP takes.

const DOCUMENT = [
  "Витамин В12 704 пг/мл (197-771)",
  "Желчный пузырь: полип 4 мм.",
  "Конкременты: нет.",
].join("\n");

function observation(anchor: string) {
  return {
    obs_code: null,
    obs_name_text: "Витамин В12",
    value: "704",
    value_numeric: 704,
    unit_text: "пг/мл",
    ref_range: "197-771",
    ref_range_low: 197,
    ref_range_high: 771,
    status: "normal",
    source_anchor: anchor,
    confidence: 0.9,
  };
}

Deno.test("normalizeExtraction keeps an entity whose anchor is in the document text", () => {
  const result = normalizeExtraction(
    { observations: [observation("Витамин В12 704 пг/мл")] },
    DOCUMENT,
  );
  assertEquals(result.value.observations.length, 1);
  assertEquals(result.value.observations[0].unit, "пг/мл");
  assertEquals(result.rejected, []);
});

Deno.test("normalizeExtraction drops an entity whose anchor is not in the document text", () => {
  const result = normalizeExtraction(
    { observations: [observation("Витамин В12 704 пмоль/л")] },
    DOCUMENT,
  );
  assertEquals(result.value.observations, []);
  assertEquals(result.rejected, [
    { entityKind: "observation", reason: "source anchor not found in document text" },
  ]);
  assertEquals(result.issues[0].resolution, "dropped");
});

Deno.test("normalizeExtraction drops a finding whose own anchor denies it", () => {
  const result = normalizeExtraction(
    {
      findings: [
        {
          finding_type_text: "Конкременты",
          body_site_text: "желчный пузырь",
          source_anchor: "Конкременты: нет",
          confidence: 0.8,
        },
      ],
    },
    DOCUMENT,
  );
  assertEquals(result.value.findings, []);
  assertEquals(result.rejected[0].reason, "source anchor states the finding is absent");
});

Deno.test("normalizeExtraction accepts an absence only when its anchor denies the finding", () => {
  const result = normalizeExtraction(
    {
      asserted_absences: [
        { finding_type_text: "Конкременты", source_anchor: "Конкременты: нет", confidence: 0.8 },
        { finding_type_text: "Полип", source_anchor: "полип 4 мм", confidence: 0.8 },
      ],
    },
    DOCUMENT,
  );
  assertEquals(
    result.value.asserted_absences.map((a) => a.finding_type_text),
    ["Конкременты"],
  );
  assertEquals(result.rejected, [
    { entityKind: "absence", reason: "source anchor does not state an absence" },
  ]);
});

Deno.test("normalizeExtraction treats missing arrays as empty", () => {
  const result = normalizeExtraction({}, DOCUMENT);
  assertEquals(result.value, {
    observations: [],
    findings: [],
    conditions: [],
    asserted_absences: [],
  });
});
