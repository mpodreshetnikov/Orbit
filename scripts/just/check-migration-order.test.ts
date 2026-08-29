import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as checkMigrationOrder from "./check-migration-order.cjs";

const { evaluateMigrationOrder, parseAllowlist, parseArgs, versionOf } = checkMigrationOrder;

const BASE = ["20260802120000", "20260809120000"];

describe("migration order evaluation", () => {
  it("passes when an added migration sorts after everything on the base branch", () => {
    const result = evaluateMigrationOrder({
      baseVersions: BASE,
      headVersions: [...BASE, "20260810000000"],
    });

    expect(result.offenders).toEqual([]);
    expect(result.added).toEqual(["20260810000000"]);
    expect(result.latestBaseVersion).toBe("20260809120000");
  });

  it("flags the real case: a migration merged below one production already carries", () => {
    const result = evaluateMigrationOrder({
      baseVersions: BASE,
      headVersions: [...BASE, "20260807120000"],
    });

    expect(result.offenders).toEqual(["20260807120000"]);
  });

  it("passes when nothing was added", () => {
    const result = evaluateMigrationOrder({ baseVersions: BASE, headVersions: BASE });

    expect(result.offenders).toEqual([]);
    expect(result.added).toEqual([]);
  });

  it("does not flag a migration the base branch already carries, however old", () => {
    const result = evaluateMigrationOrder({
      baseVersions: ["20250126000000", ...BASE],
      headVersions: ["20250126000000", ...BASE],
    });

    expect(result.offenders).toEqual([]);
  });

  it("exempts an allowlisted version but still reports it as out of order", () => {
    const result = evaluateMigrationOrder({
      baseVersions: BASE,
      headVersions: [...BASE, "20260807120000"],
      allowlist: ["20260807120000"],
    });

    expect(result.offenders).toEqual([]);
    expect(result.allowed).toEqual(["20260807120000"]);
  });

  it("flags every offender, not just the first", () => {
    const result = evaluateMigrationOrder({
      baseVersions: BASE,
      headVersions: [...BASE, "20260807120000", "20260101000000", "20260901000000"],
    });

    expect(result.offenders).toEqual(["20260101000000", "20260807120000"]);
  });

  it("cannot judge order with no base migrations, and says so rather than flagging", () => {
    const result = evaluateMigrationOrder({ baseVersions: [], headVersions: ["20260101000000"] });

    expect(result.offenders).toEqual([]);
    expect(result.latestBaseVersion).toBeNull();
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
  it("reads versions and drops comments and blank lines", () => {
    const parsed = parseAllowlist(
      [
        "# reviewed: touches only catalogue rows",
        "20260807120000",
        "",
        "20260101000000 # older",
      ].join("\n"),
    );

    expect(parsed).toEqual(["20260807120000", "20260101000000"]);
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
