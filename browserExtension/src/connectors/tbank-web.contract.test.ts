import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { __test__ } from "./tbank-web.js";
import { createCassettePlayer, type Cassette } from "./cassette-replay";

/**
 * Guards the shape of the bank's responses, which is a contract nobody tells us about when it
 * changes. The connector already counts the operations it had to drop while mapping
 * (`mapping_drop_counts`); the point of this suite is that a changed response makes that
 * counter non-zero and fails loudly, instead of quietly producing fewer rows than the bank
 * actually returned.
 *
 * Recording a cassette needs a signed-in bank session and is therefore a manual step:
 *
 *     just extension-debug-live tbank_web 10
 *
 * then run the recording through scripts/extension/cassette-scrub.ts and commit the result to
 * test/fixtures/tbank/cassettes/<case>/. Until a cassette is committed this suite reports that
 * it has nothing to check rather than passing silently on nothing.
 */
const CASSETTES_ROOT = path.resolve(__dirname, "../../../test/fixtures/tbank/cassettes");

function loadCassettes(): Cassette[] {
  if (!fs.existsSync(CASSETTES_ROOT)) return [];
  return fs
    .readdirSync(CASSETTES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = path.join(CASSETTES_ROOT, entry.name, "cassette.json");
      if (!fs.existsSync(manifestPath)) return null;
      const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Cassette;
      return { ...parsed, name: parsed.name || entry.name };
    })
    .filter((cassette): cassette is Cassette => cassette !== null);
}

const cassettes = loadCassettes();

describe("tbank-web response contract", () => {
  it("knows where cassettes live", () => {
    // Recording is manual, so an empty directory is an expected state — but it must be a
    // visible one, not a suite that reports success having checked nothing.
    if (cassettes.length === 0) {
      console.warn(
        `No cassettes in ${path.relative(process.cwd(), CASSETTES_ROOT)}. ` +
          "Record one with `just extension-debug-live tbank_web 10`, scrub it, and commit it.",
      );
    }
    expect(fs.existsSync(CASSETTES_ROOT)).toBe(true);
  });

  for (const cassette of cassettes) {
    it(`maps every operation in ${cassette.name} without dropping any`, async () => {
      const player = createCassettePlayer(cassette);
      const operationsEntries = cassette.entries.filter((entry) =>
        entry.url.includes("/api/common/v1/operations"),
      );
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
      void player;
    });

    it(`keeps every field the row mapping depends on in ${cassette.name}`, () => {
      const operationsEntries = cassette.entries.filter((entry) =>
        entry.url.includes("/api/common/v1/operations"),
      );

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
