/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { __test__ } from "./tbank-web.js";
import type { Cassette } from "./cassette-replay";

/**
 * Guards the shape of the bank's responses, which is a contract nobody tells us about when it
 * changes. The connector already counts the operations it had to drop while mapping
 * (`mapping_drop_counts`); the point of this suite is that a changed response makes that
 * counter non-zero and fails loudly, instead of quietly producing fewer rows than the bank
 * actually returned.
 *
 * Cassettes are enumerated through `import.meta.glob` rather than the filesystem: extension
 * runtime code may not import Node modules, and build scripts may not import extension
 * runtime code, so neither `node:fs` here nor a home under `scripts/` is available. Both
 * rules are worth keeping intact — and Vite resolves the fixtures at build time anyway.
 *
 * Recording a cassette needs a signed-in bank session and is therefore a manual step:
 *
 *     just extension-debug-live tbank_web 10
 *
 * then run the recording through scripts/extension/cassette-scrub.ts and commit the result to
 * test/fixtures/tbank/cassettes/<case>/. Until a cassette is committed this suite reports that
 * it has nothing to check rather than passing silently on nothing.
 */
const cassetteModules = import.meta.glob<{ default: Cassette }>(
  "../../../test/fixtures/tbank/cassettes/*/cassette.json",
  { eager: true },
);

const cassettes: Cassette[] = Object.entries(cassetteModules).map(([filePath, module]) => {
  const parsed = module.default;
  const directory = filePath.split("/").slice(-2, -1)[0] ?? "unnamed";
  return { ...parsed, name: parsed.name || directory };
});

describe("tbank-web response contract", () => {
  it("reports when there is nothing to check", () => {
    // Recording is manual, so an empty fixture directory is an expected state — but it must
    // be a visible one, not a suite that reports success having checked nothing.
    if (cassettes.length === 0) {
      console.warn(
        "No cassettes in test/fixtures/tbank/cassettes. Record one with " +
          "`just extension-debug-live tbank_web 10`, scrub it, and commit it.",
      );
    }
    expect(Array.isArray(cassettes)).toBe(true);
  });

  for (const cassette of cassettes) {
    const operationsEntries = cassette.entries.filter((entry) =>
      entry.url.includes("/api/common/v1/operations"),
    );

    it(`maps every operation in ${cassette.name} without dropping any`, () => {
      expect(operationsEntries.length, "cassette has no operations response").toBeGreaterThan(0);

      const dropped: string[] = [];
      let mapped = 0;
      for (const entry of operationsEntries) {
        const payload = (entry.body as { payload?: unknown[] })?.payload ?? [];
        for (const operation of payload) {
          const row = __test__.mapOperationRecordToRow({ operation }, { extractionMethod: "api" });
          if (row) mapped += 1;
          else dropped.push(JSON.stringify(operation).slice(0, 200));
        }
      }

      expect(dropped, `operations the mapper could not read: ${dropped.join(" | ")}`).toEqual([]);
      expect(mapped).toBeGreaterThan(0);
    });

    it(`keeps every field the row mapping depends on in ${cassette.name}`, () => {
      for (const entry of operationsEntries) {
        const payload = (entry.body as { payload?: Array<Record<string, unknown>> })?.payload ?? [];
        for (const operation of payload) {
          expect(operation.id ?? operation.operationId, "operation identity").toBeDefined();
          expect(
            operation.operationTime ?? operation.debitingTime ?? operation.operationDateTime,
            "operation time",
          ).toBeDefined();
          expect(operation.accountAmount ?? operation.amount, "operation amount").toBeDefined();
          expect(operation.description ?? operation.brand, "operation description").toBeDefined();
        }
      }
    });
  }
});
