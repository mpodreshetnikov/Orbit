import { assertEquals } from "std/assert/assert-equals";
import { gateFindingResolutions } from "./client-parse.ts";

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
