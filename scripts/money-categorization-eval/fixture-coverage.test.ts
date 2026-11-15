import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CASES_ROOT } from "./paths";
import { SCORED_FIELDS } from "./score";

describe("money categorization fixture coverage", () => {
  it("only stores expected keys the scorer reads", async () => {
    const dirs = (await readdir(CASES_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(dirs.length).toBeGreaterThan(0);

    const allowed = new Set<string>(SCORED_FIELDS);
    for (const id of dirs) {
      const expected = JSON.parse(
        await readFile(path.join(CASES_ROOT, id, "expected.json"), "utf8"),
      ) as Record<string, unknown>;
      for (const key of Object.keys(expected)) {
        expect(allowed.has(key), `${id}: unexpected expected.json key "${key}"`).toBe(true);
      }
      for (const field of SCORED_FIELDS) {
        expect(field in expected, `${id}: missing scored field "${field}"`).toBe(true);
      }
    }
  });
});
