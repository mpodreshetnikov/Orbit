import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as checkMigrationOrder from "./check-migration-order.cjs";

const {
  evaluateMigrationOrder,
  misorderedInTree,
  parseAllowlist,
  parseArgs,
  parseLandingOrder,
  versionOf,
} = checkMigrationOrder;

const BASE = ["20260802120000_a.sql", "20260809120000_b.sql"];
const ALLOWED_FILE = "20260807120000_late.sql";
const RATIONALE = "catalogue rows only; disjoint from every later migration";

/** @param entries offenders or standing entries, which carry the version they land after */
const names = (entries: { file: string }[]) => entries.map((entry) => entry.file);

describe("migration order evaluation", () => {
  it("passes when an added migration sorts after everything on the base branch", () => {
    const result = evaluateMigrationOrder({
      baseFiles: BASE,
      headFiles: [...BASE, "20260810000000_new.sql"],
    });

    expect(result.offenders).toEqual([]);
    expect(result.added).toEqual(["20260810000000_new.sql"]);
    expect(result.latestBaseVersion).toBe("20260809120000");
  });

  it("flags the real case: a migration merged below one production already carries", () => {
    const result = evaluateMigrationOrder({
      baseFiles: BASE,
      headFiles: [...BASE, ALLOWED_FILE],
    });

    expect(names(result.offenders)).toEqual([ALLOWED_FILE]);
    expect(result.offenders[0].landsAfter).toBe("20260809120000");
  });

  it("flags a new file that reuses a timestamp the base already carries", () => {
    const result = evaluateMigrationOrder({
      baseFiles: BASE,
      headFiles: [...BASE, "20260809120000_different_name.sql"],
    });

    expect(result.added).toEqual(["20260809120000_different_name.sql"]);
    expect(result.duplicates).toEqual(["20260809120000_different_name.sql"]);
  });

  it("flags two added files sharing a timestamp even when both sort after the base", () => {
    const result = evaluateMigrationOrder({
      baseFiles: BASE,
      headFiles: [...BASE, "20260901000000_x.sql", "20260901000000_y.sql"],
    });

    expect(result.duplicates).toEqual(["20260901000000_x.sql", "20260901000000_y.sql"]);
    expect(result.offenders).toEqual([]);
  });

  it("does not let the allowlist excuse a duplicate version", () => {
    const result = evaluateMigrationOrder({
      baseFiles: BASE,
      headFiles: [...BASE, "20260809120000_duplicate.sql"],
      allowlist: [{ file: "20260809120000_duplicate.sql", rationale: RATIONALE }],
    });

    expect(result.duplicates).toEqual(["20260809120000_duplicate.sql"]);
    expect(result.allowed).toEqual([]);
  });

  it("leaves a duplicate already on the base branch to the change that introduced it", () => {
    const withDuplicate = [...BASE, "20260802120000_a_twin.sql"];
    const result = evaluateMigrationOrder({
      baseFiles: withDuplicate,
      headFiles: [...withDuplicate, "20260810000000_new.sql"],
    });

    expect(result.duplicates).toEqual([]);
    expect(result.offenders).toEqual([]);
  });

  it("passes when nothing was added", () => {
    const result = evaluateMigrationOrder({ baseFiles: BASE, headFiles: BASE });

    expect(result.offenders).toEqual([]);
    expect(result.added).toEqual([]);
  });

  it("does not flag a migration the base branch already carries, however old", () => {
    const files = ["20250126000000_old.sql", ...BASE];
    const result = evaluateMigrationOrder({ baseFiles: files, headFiles: files });

    expect(result.offenders).toEqual([]);
  });

  it("ignores files in the directory that are not timestamped migrations", () => {
    const result = evaluateMigrationOrder({
      baseFiles: BASE,
      headFiles: [...BASE, "README.md", ".out-of-order-allowlist"],
    });

    expect(result.added).toEqual([]);
    expect(result.offenders).toEqual([]);
  });

  it("exempts an allowlisted file but still reports it as out of order", () => {
    const result = evaluateMigrationOrder({
      baseFiles: BASE,
      headFiles: [...BASE, ALLOWED_FILE],
      allowlist: [{ file: ALLOWED_FILE, rationale: RATIONALE }],
    });

    expect(result.offenders).toEqual([]);
    expect(result.allowed).toEqual([ALLOWED_FILE]);
  });

  it("does not let an exemption cover a different file that reuses the version", () => {
    const replacement = "20260807120000_something_else.sql";
    const result = evaluateMigrationOrder({
      baseFiles: BASE,
      headFiles: [...BASE, replacement],
      allowlist: [{ file: ALLOWED_FILE, rationale: RATIONALE }],
    });

    expect(names(result.offenders)).toEqual([replacement]);
    expect(result.allowed).toEqual([]);
  });

  it("flags every offender, not just the first", () => {
    const result = evaluateMigrationOrder({
      baseFiles: BASE,
      headFiles: [...BASE, ALLOWED_FILE, "20260101000000_older.sql", "20260901000000_fine.sql"],
    });

    expect(names(result.offenders)).toEqual(["20260101000000_older.sql", ALLOWED_FILE]);
  });

  it("cannot judge order with no base migrations, and says so rather than flagging", () => {
    const result = evaluateMigrationOrder({ baseFiles: [], headFiles: ["20260101000000_a.sql"] });

    expect(result.offenders).toEqual([]);
    expect(result.latestBaseVersion).toBeNull();
  });

  it("still catches a duplicate with no base migrations to order against", () => {
    const result = evaluateMigrationOrder({
      baseFiles: [],
      headFiles: ["20260101000000_a.sql", "20260101000000_b.sql"],
    });

    expect(result.duplicates).toEqual(["20260101000000_a.sql", "20260101000000_b.sql"]);
  });

  it("says whether the whole tree was judged or only the additions", () => {
    const added = evaluateMigrationOrder({ baseFiles: BASE, headFiles: BASE });
    const whole = evaluateMigrationOrder({
      baseFiles: BASE,
      headFiles: BASE,
      landingOrder: [BASE],
    });

    expect(added.treeChecked).toBe(false);
    expect(whole.treeChecked).toBe(true);
  });
});

describe("the whole tree, not only what the branch adds", () => {
  // The 2026-09-02 shape: a misordered file lands, and every push after it is no longer an
  // addition. An added-only check goes quiet, the deploy proceeds, and production applies the
  // migration out of order. See T-260902-1ui.
  const LANDED_OUT_OF_ORDER = [
    ["20260802120000_a.sql"],
    ["20260902060000_newer.sql"],
    ["20260901150000_landed_late.sql"],
  ];
  const TREE = LANDED_OUT_OF_ORDER.flat();

  it("fails a branch that leaves a misordered migration untouched", () => {
    const result = evaluateMigrationOrder({
      baseFiles: TREE,
      headFiles: [...TREE, "20260903000000_unrelated.sql"],
      landingOrder: LANDED_OUT_OF_ORDER,
    });

    expect(result.added).toEqual(["20260903000000_unrelated.sql"]);
    expect(result.offenders).toEqual([]);
    expect(names(result.standing)).toEqual(["20260901150000_landed_late.sql"]);
    expect(result.standing[0].landsAfter).toBe("20260902060000");
  });

  it("passes that same branch once the misordered file is recorded", () => {
    const result = evaluateMigrationOrder({
      baseFiles: TREE,
      headFiles: [...TREE, "20260903000000_unrelated.sql"],
      landingOrder: LANDED_OUT_OF_ORDER,
      allowlist: [{ file: "20260901150000_landed_late.sql", rationale: RATIONALE }],
    });

    expect(result.standing).toEqual([]);
    expect(result.allowed).toEqual(["20260901150000_landed_late.sql"]);
  });

  it("passes that same branch once the misordered file is renamed away", () => {
    const renamed = TREE.filter((file) => !file.startsWith("20260901150000")).concat(
      "20260903010000_landed_late.sql",
    );
    const result = evaluateMigrationOrder({
      baseFiles: TREE,
      headFiles: renamed,
      landingOrder: LANDED_OUT_OF_ORDER,
    });

    expect(result.standing).toEqual([]);
    expect(result.offenders).toEqual([]);
  });

  it("reports a migration the branch adds as its own, not as one standing in the tree", () => {
    const result = evaluateMigrationOrder({
      baseFiles: ["20260802120000_a.sql", "20260902060000_newer.sql"],
      headFiles: ["20260802120000_a.sql", "20260902060000_newer.sql", "20260901150000_mine.sql"],
      landingOrder: [["20260802120000_a.sql"], ["20260902060000_newer.sql"]],
    });

    expect(names(result.offenders)).toEqual(["20260901150000_mine.sql"]);
    expect(result.standing).toEqual([]);
  });
});

describe("landing order", () => {
  it("does not order migrations that landed in the same commit against each other", () => {
    expect(
      misorderedInTree({
        headFiles: ["20260902000000_b.sql", "20260901000000_a.sql"],
        landingOrder: [["20260902000000_b.sql", "20260901000000_a.sql"]],
      }),
    ).toEqual([]);
  });

  it("flags a version that lands after a later one already did", () => {
    expect(
      misorderedInTree({
        headFiles: ["20260902000000_b.sql", "20260901000000_a.sql"],
        landingOrder: [["20260902000000_b.sql"], ["20260901000000_a.sql"]],
      }),
    ).toEqual([{ file: "20260901000000_a.sql", landsAfter: "20260902000000" }]);
  });

  it("ignores a migration that has since been renamed or deleted out of the tree", () => {
    expect(
      misorderedInTree({
        headFiles: ["20260902000000_b.sql"],
        landingOrder: [["20260902000000_b.sql"], ["20260901000000_a.sql"]],
      }),
    ).toEqual([]);
  });

  it("puts a file that has not landed yet last, where merging would put it", () => {
    expect(
      misorderedInTree({
        headFiles: ["20260902000000_b.sql", "20260901000000_uncommitted.sql"],
        landingOrder: [["20260902000000_b.sql"]],
      }),
    ).toEqual([{ file: "20260901000000_uncommitted.sql", landsAfter: "20260902000000" }]);
  });

  it("reads one batch per commit out of the git log output", () => {
    const output = [
      "commit aaa",
      "",
      "supabase/migrations/20260101000000_a.sql",
      "supabase/migrations/20260102000000_b.sql",
      "",
      "commit bbb",
      "",
      "supabase/migrations/20260103000000_c.sql",
      "",
    ].join("\n");

    expect(parseLandingOrder(output)).toEqual([
      ["20260101000000_a.sql", "20260102000000_b.sql"],
      ["20260103000000_c.sql"],
    ]);
  });

  it("drops commits that touched the directory without adding a migration", () => {
    const output = [
      "commit aaa",
      "",
      "supabase/migrations/.out-of-order-allowlist",
      "",
      "commit bbb",
      "",
      "supabase/migrations/20260103000000_c.sql",
    ].join("\n");

    expect(parseLandingOrder(output)).toEqual([["20260103000000_c.sql"]]);
  });

  it("reads no batches out of empty output", () => {
    expect(parseLandingOrder("")).toEqual([]);
    expect(parseLandingOrder(undefined)).toEqual([]);
  });
});

describe("landing order read from this repository", () => {
  // A rename to a later timestamp is the remedy this gate recommends, and under git's rename
  // detection it lands as an `R` rather than an `A`. If detection is ever left on, every renamed
  // migration disappears from the landing order, is treated as arriving today, and is reported as
  // out of order -- which is what the gate tells people to do to fix the problem. That regression
  // is invisible in a fixture, so it is checked against real history.
  const shallow = fs.existsSync(path.join(__dirname, "..", "..", ".git", "shallow"));

  it.skipIf(shallow)("accounts for every migration in the tree, renamed ones included", () => {
    const landed = new Set((checkMigrationOrder.readLandingOrder() ?? []).flat());
    const missing = checkMigrationOrder
      .readHeadMigrations()
      .filter((file: string) => versionOf(file))
      .filter((file: string) => !landed.has(file));

    expect(missing).toEqual([]);
  });
});

describe("migration filename parsing", () => {
  it("reads the timestamp out of a migration filename", () => {
    expect(versionOf("20260809120000_add_mcp_oauth_tables.sql")).toBe("20260809120000");
  });

  it("ignores files that are not timestamped migrations", () => {
    expect(versionOf("README.md")).toBeNull();
    expect(versionOf("2026_short.sql")).toBeNull();
    expect(versionOf("20260809120000.sql")).toBeNull();
  });
});

describe("allowlist parsing", () => {
  it("reads a filename and the rationale that justifies it", () => {
    expect(parseAllowlist(`${ALLOWED_FILE} # ${RATIONALE}`)).toEqual([
      { file: ALLOWED_FILE, version: "20260807120000", rationale: RATIONALE },
    ]);
  });

  it("rejects a bare version, which would also exempt a file that reuses it", () => {
    expect(() => parseAllowlist(`20260807120000 # ${RATIONALE}`)).toThrow(
      "Malformed allowlist entry",
    );
  });

  it("rejects a filename that is not a timestamped migration", () => {
    expect(() => parseAllowlist(`notes.sql # ${RATIONALE}`)).toThrow("Malformed allowlist entry");
  });

  it("rejects an entry with no rationale", () => {
    expect(() => parseAllowlist(ALLOWED_FILE)).toThrow("Malformed allowlist entry");
  });

  it("rejects an entry whose rationale is empty", () => {
    expect(() => parseAllowlist(`${ALLOWED_FILE} #   `)).toThrow("Malformed allowlist entry");
  });

  it("keeps whole-line comments and blank lines out of the entries", () => {
    expect(
      parseAllowlist(["# how to use this file", "", `${ALLOWED_FILE} # ${RATIONALE}`].join("\n")),
    ).toEqual([{ file: ALLOWED_FILE, version: "20260807120000", rationale: RATIONALE }]);
  });

  it("treats a missing or empty file as no exemptions", () => {
    expect(parseAllowlist("")).toEqual([]);
    expect(parseAllowlist(undefined)).toEqual([]);
  });
});

describe("base ref resolution", () => {
  const script = path.join(__dirname, "check-migration-order.cjs");

  function runScript(args: string[], env: Record<string, string> = {}) {
    return spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, MIGRATION_ORDER_BASE: "", ...env },
    });
  }

  it("fails rather than skipping when an explicitly requested base cannot be resolved", () => {
    const result = runScript(["--base", "no/such/ref"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot resolve base ref 'no/such/ref'");
  });

  it("fails on an unresolvable base supplied through the environment, as CI supplies it", () => {
    const result = runScript([], { MIGRATION_ORDER_BASE: "no/such/ref" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot resolve base ref");
  });

  it("checks against the base it was given", () => {
    const result = runScript([], { MIGRATION_ORDER_BASE: "origin/main" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("origin/main");
  });

  it("treats the zero sha as no baseline rather than an unresolvable ref", () => {
    const result = runScript([], { MIGRATION_ORDER_BASE: checkMigrationOrder.ZERO_SHA });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("origin/main");
  });

  it("falls back to the default base when none is requested", () => {
    const result = runScript([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Migration order OK");
  });
});

describe("argument parsing", () => {
  it("reads an explicit base ref", () => {
    expect(parseArgs(["--base", "origin/release"])).toEqual({ base: "origin/release" });
  });

  it("defaults to no explicit base", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("rejects --base with no value", () => {
    expect(() => parseArgs(["--base"])).toThrow("Missing value for argument --base");
  });
});
