import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const generator = require("./generate-rule-filter-conformance-sql.cjs") as {
  render: (cases: unknown[]) => string;
  casesPath: string;
  outputPath: string;
};

describe("rule filter conformance fixture", () => {
  it("keeps the generated pgTAP suite in step with the shared corpus", () => {
    // The two halves of the conformance suite only prove anything if they run the same
    // cases. pgTAP cannot read the JSON at run time, so the SQL is generated and committed —
    // and this is what stops the committed copy from drifting away from the corpus.
    const cases = JSON.parse(fs.readFileSync(generator.casesPath, "utf8"));
    expect(fs.readFileSync(generator.outputPath, "utf8")).toBe(generator.render(cases));
  });

  it("covers every operator at least three times", () => {
    const cases = JSON.parse(fs.readFileSync(generator.casesPath, "utf8")) as Array<{
      filter: { operator: string };
    }>;

    const counts = new Map<string, number>();
    for (const entry of cases) {
      counts.set(entry.filter.operator, (counts.get(entry.filter.operator) ?? 0) + 1);
    }

    for (const operator of [
      "contains",
      "not_contains",
      "equals",
      "starts_with",
      "regex",
      "contains_any_in_set",
      "equals_any_in_set",
      "in_set",
      "range",
      "is_empty",
      "is_not_empty",
    ]) {
      expect(counts.get(operator) ?? 0, operator).toBeGreaterThanOrEqual(3);
    }

    expect(cases.length).toBeGreaterThanOrEqual(40);
  });
});
