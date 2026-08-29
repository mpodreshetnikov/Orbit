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

/**
 * The reconciliation totals a recorder writes into a cassette.
 *
 * Declared here rather than imported: the type lives in `scripts/extension/`, and extension
 * runtime code may not import build scripts any more than the reverse. The same split already
 * applies to the dedupe formula, and the shape is small enough that a mismatch shows up as a
 * failing assertion rather than a silent skip — `summary` is optional, so a cassette recorded
 * before this existed simply does not get the check.
 */
interface RecordedSummary {
  months: Array<{
    month: string;
    currency: string;
    operations: number;
    income: string;
    expense: string;
    complete?: boolean;
  }>;
}

/** Moscow is a fixed UTC+03:00, which is the clock the bank prints and totals in. */
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

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

    const summary = (cassette as { summary?: RecordedSummary }).summary;
    if (summary && summary.months.length > 0) {
      it(`reproduces the recorded totals for ${cassette.name}`, () => {
        // The recorder wrote these totals, and whoever recorded the cassette compared them with
        // the bank's own screen before committing it. That comparison happened once; this is
        // what makes it permanent. A mapper that starts reading fewer operations, or reads an
        // amount or a date differently, shows up here as a number that no longer matches —
        // which a count of successfully mapped rows cannot express.
        const totals = new Map<string, { operations: number; income: number; expense: number }>();

        for (const entry of operationsEntries) {
          const payload =
            (entry.body as { payload?: Array<Record<string, unknown>> })?.payload ?? [];
          for (const operation of payload) {
            const row = __test__.mapOperationRecordToRow(
              { operation },
              { extractionMethod: "api" },
            );
            if (!row) continue;

            const postedAt = typeof row.posted_at === "string" ? row.posted_at : null;
            const amount = typeof row.amount === "number" ? row.amount : null;
            const currency = typeof row.currency === "string" ? row.currency : "RUB";
            if (postedAt === null || amount === null) continue;

            // `posted_at` is UTC; the summary buckets by Moscow month, because that is what
            // the bank's screen groups by and therefore what a person compares against. An
            // operation just after midnight in Moscow falls in the previous UTC month, so
            // slicing the UTC string here would move it and the totals would never agree.
            const month = new Date(Date.parse(postedAt) + MOSCOW_OFFSET_MS)
              .toISOString()
              .slice(0, 7);
            const key = `${month}|${currency}`;
            const bucket = totals.get(key) ?? { operations: 0, income: 0, expense: 0 };
            bucket.operations += 1;
            if (amount >= 0) bucket.income += amount;
            else bucket.expense += Math.abs(amount);
            totals.set(key, bucket);
          }
        }

        for (const month of summary.months) {
          const bucket = totals.get(`${month.month}|${month.currency}`);
          expect(bucket, `no mapped rows for ${month.month} ${month.currency}`).toBeDefined();
          expect(bucket?.operations, `${month.month} operation count`).toBe(month.operations);
          expect(bucket?.income.toFixed(2), `${month.month} income`).toBe(month.income);
          expect(bucket?.expense.toFixed(2), `${month.month} expense`).toBe(month.expense);
        }
      });
    }

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
