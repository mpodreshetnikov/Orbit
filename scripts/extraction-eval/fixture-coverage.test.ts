/**
 * Every key in every `expected.json` must be read by the scorer.
 *
 * This test exists because the same defect has shipped three times and the harness caught it zero
 * times. `findings_to_resolve` was produced by reconcile, normalised in `pipeline.ts`, written into
 * every fixture — and typed `unknown[]` and scored by nothing. Then every finding field
 * (`site_code`, `laterality`, `size_mm`, `body_site_text`, `severity`) was carried into the
 * fixtures and compared against nothing. Then every condition field (`icd_code`, `status`)
 * likewise. All three were found by a human reading the code, not by the corpus.
 *
 * The failure is silent and it flatters: an inert key looks like coverage. A fixture that carefully
 * records `severity: "mild"` reads as a case that tests severity, the report shows no mismatch on
 * it, and the number everyone looks at goes up. Nothing anywhere says the field was never compared.
 *
 * So: read the corpus, read what `score.ts` actually consumes, and require every key to be one or
 * the other — a scored field, or a match key. The lists come from `score.ts` by import rather than
 * being restated here, because a second copy would drift and this test would go quiet exactly when
 * it was needed.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CASES_ROOT } from "./paths";
import { MATCH_KEYS, SCORED_FIELDS } from "./score";
import type { CaseSnapshot } from "./types";

/** The collections inside a snapshot that hold rows with per-row keys. */
const COLLECTIONS = Object.keys(SCORED_FIELDS) as (keyof CaseSnapshot)[];

async function loadFixtures(): Promise<{ caseId: string; snapshot: CaseSnapshot }[]> {
  const entries = await readdir(CASES_ROOT, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  return await Promise.all(
    dirs.sort().map(async (caseId) => ({
      caseId,
      snapshot: JSON.parse(
        await readFile(path.join(CASES_ROOT, caseId, "expected.json"), "utf8"),
      ) as CaseSnapshot,
    })),
  );
}

describe("fixture coverage", () => {
  it("finds at least one case, so an empty corpus cannot pass vacuously", async () => {
    expect((await loadFixtures()).length).toBeGreaterThan(0);
  });

  it("scores or matches on every key the fixtures carry", async () => {
    const fixtures = await loadFixtures();
    const inert: string[] = [];

    for (const { caseId, snapshot } of fixtures) {
      for (const collection of COLLECTIONS) {
        const rows = snapshot[collection];
        if (!Array.isArray(rows)) continue;
        const allowed = new Set([
          ...SCORED_FIELDS[collection as string],
          ...MATCH_KEYS[collection as string],
        ]);
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          for (const key of Object.keys(row)) {
            if (allowed.has(key)) continue;
            const where = `${caseId}/expected.json → ${collection}[].${key}`;
            if (!inert.includes(where)) inert.push(where);
          }
        }
      }
    }

    expect(
      inert,
      inert.length === 0
        ? ""
        : [
            "These keys are written into the corpus and then compared against nothing:",
            ...inert.map((entry) => `  - ${entry}`),
            "",
            "An unread key is worse than a missing one: it reads as coverage that does not exist.",
            "Either score it — add it to the matching array in scripts/extraction-eval/score.ts,",
            "and carry it through pipeline.ts and types.ts so an actual value exists to compare —",
            "or delete it from the fixture. If it is a match key, declare it in MATCH_KEYS.",
          ].join("\n"),
    ).toEqual([]);
  });

  it("declares every collection the snapshot defines, so a new one cannot go unchecked", async () => {
    const [{ snapshot }] = await loadFixtures();
    // A new array added to CaseSnapshot and to the fixtures — the exact shape of all three past
    // regressions — must force a decision here rather than sliding past unnoticed.
    const arrays = Object.entries(snapshot)
      .filter(([, value]) => Array.isArray(value))
      .map(([key]) => key);
    expect(arrays.filter((name) => !(name in SCORED_FIELDS))).toEqual([]);
    expect(arrays.filter((name) => !(name in MATCH_KEYS))).toEqual([]);
  });
});
