import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as dbArtifacts from "./db-artifacts.cjs";

const {
  assertPgDumpMajorMatches,
  parsePgDumpMajor,
  readConfiguredMajorVersion,
  sanitizeCommonSql,
} = dbArtifacts;

const repoRoot = path.resolve(__dirname, "..", "..");

/**
 * A stand-in for `just` that fails with a chosen status, on every platform.
 *
 * The script spawns `JUST_BIN` directly, with no shell, so the stub has to be something the OS can
 * execute on its own. That rules out a shell script on Windows (no shebang, no executable bit) and
 * a `.cmd` too, which Node cannot spawn without a shell. What is left, and is genuinely executable
 * everywhere, is the Node binary already running this test.
 *
 * It is pointed at a preload that exits with the chosen status. The preload has to tell the two
 * processes apart, because `NODE_OPTIONS` is inherited: the script under test is Node as well, and
 * a preload that exited unconditionally would kill it before it ran a line.
 */
function failingJustStub(status: number): { bin: string; nodeOptions: string } {
  const stubDir = mkdtempSync(path.join(tmpdir(), "db-artifacts-"));
  const preload = path.join(stubDir, "exit-stub.cjs");
  writeFileSync(
    preload,
    [
      "const entry = process.argv[1] || '';",
      "if (!entry.endsWith('db-artifacts.cjs')) {",
      `  process.exit(${status});`,
      "}",
    ].join("\n"),
  );
  return { bin: process.execPath, nodeOptions: `--require ${JSON.stringify(preload)}` };
}

describe("db-artifacts exit propagation", () => {
  /**
   * The defect this covers is not a wrong answer, it is a right answer nobody hears. Every failure
   * path in the script sets an exit code and returns; an exit placed after the `try/finally` is
   * skipped by those returns and the process ends with status 0. The check then reports success
   * while having regenerated nothing, which is how the committed artifacts drifted for weeks with
   * CI green over them.
   *
   * Spawned rather than unit-tested: the exit code is the whole subject, and only a real process
   * has one. The `just` recipe is stubbed so nothing here needs Docker or a database.
   */
  it("exits non-zero when the step it shells out to fails", () => {
    const stub = failingJustStub(3);
    const result = spawnSync(process.execPath, ["scripts/just/db-artifacts.cjs", "--verify"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        JUST_BIN: stub.bin,
        NODE_OPTIONS: stub.nodeOptions,
        SUPABASE_ALREADY_RUNNING: "1",
      },
    });

    expect(result.status).toBe(3);
  });

  it("lets an unexpected exception end the process rather than reporting success", () => {
    // The exit code is not the only way this can go quiet. An exception nothing catches -- a
    // read-only workspace, a full disk -- must still end the run: converting it into a zero would
    // be the same false green wearing a different hat.
    //
    // The throw has to happen *inside* the block the cleanup wraps, or the test proves nothing:
    // an exception raised before it propagates however the cleanup is written. So `spawnSync` is
    // what throws — the first thing the run reaches once it is past the preflight.
    //
    // Preloaded with --require so the script still runs as the main module: it only calls `main()`
    // when it is, and requiring it from a wrapper would test nothing.
    const stubDir = mkdtempSync(path.join(tmpdir(), "db-artifacts-throw-"));
    const preload = path.join(stubDir, "preload.cjs");
    writeFileSync(
      preload,
      [
        "const Module = require('node:module');",
        "const original = Module._load;",
        "Module._load = function (request, ...rest) {",
        "  const loaded = original.call(this, request, ...rest);",
        "  if (request === 'child_process' || request === 'node:child_process') {",
        "    return { ...loaded, spawnSync: () => { throw new Error('boom'); } };",
        "  }",
        "  if (request.endsWith('docker-preflight.cjs')) {",
        "    return { ensureDockerReady: () => 0 };",
        "  }",
        "  return loaded;",
        "};",
      ].join("\n"),
    );

    const result = spawnSync(process.execPath, ["scripts/just/db-artifacts.cjs", "--verify"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        SUPABASE_ALREADY_RUNNING: "1",
        NODE_OPTIONS: `--require ${JSON.stringify(preload)}`,
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("boom");
  });
});

describe("pg_dump version preflight", () => {
  it("reads the major version out of a pg_dump banner", () => {
    expect(parsePgDumpMajor("pg_dump (PostgreSQL) 17.6\n")).toBe(17);
    expect(parsePgDumpMajor("pg_dump (PostgreSQL) 16.15 (Ubuntu 16.15-1.pgdg24.04+2)\n")).toBe(16);
    expect(parsePgDumpMajor("")).toBeNull();
  });

  it("reads the database major version this repository pins", () => {
    // Not a fixture: the point is that the check follows the repository's own pin.
    expect(readConfiguredMajorVersion()).toBe(17);
  });

  it("refuses a client that cannot run the snapshot's own flags", () => {
    // 17 clears the server but not `--no-policies`, which is a pg_dump 18 option. This is the case
    // that failed in CI once the check could fail at all: matching the server is not sufficient.
    expect(() => assertPgDumpMajorMatches(17, 17)).toThrow(/postgresql-client-18/);
    expect(() => assertPgDumpMajorMatches(17, 17)).toThrow(/--no-policies/);
  });

  it("names the server when the server is the higher bar", () => {
    expect(() => assertPgDumpMajorMatches(18, 19)).toThrow(/pins the database to 19/);
    expect(() => assertPgDumpMajorMatches(18, 19)).toThrow(/postgresql-client-19/);
  });

  it("allows a client that clears both bars, and says nothing when it cannot be read", () => {
    expect(() => assertPgDumpMajorMatches(18, 17)).not.toThrow();
    expect(() => assertPgDumpMajorMatches(19, 17)).not.toThrow();
    expect(() => assertPgDumpMajorMatches(null, 17)).not.toThrow();
    // No server to compare against still leaves the flag floor, which is the bar that matters.
    expect(() => assertPgDumpMajorMatches(18, null)).not.toThrow();
    expect(() => assertPgDumpMajorMatches(16, null)).toThrow(/--no-policies/);
  });
});

describe("snapshot sanitisation", () => {
  it("drops the version banners, which describe the tools rather than the schema", () => {
    // Left in, the snapshot becomes a function of whichever pg_dump patch release the runner
    // installed that morning: the next PGDG minor would report drift on an untouched schema and
    // block every DB-impacting pull request. Pinning the patch instead does not survive contact --
    // the previous snapshot was made with 18.1, which PGDG no longer publishes.
    const dumped = [
      "--",
      "-- PostgreSQL database dump",
      "--",
      "",
      "-- Dumped from database version 17.6",
      "-- Dumped by pg_dump version 18.6 (Ubuntu 18.6-1.pgdg24.04+2)",
      "",
      `SET client_encoding = 'UTF8';`,
      'CREATE TABLE "public"."x" ("id" "uuid" NOT NULL);',
    ].join("\n");

    const sanitized = sanitizeCommonSql(dumped);

    expect(sanitized).not.toContain("Dumped by pg_dump version");
    expect(sanitized).not.toContain("Dumped from database version");
    // The schema itself, and the header that is not a version, both survive.
    expect(sanitized).toContain("-- PostgreSQL database dump");
    expect(sanitized).toContain('CREATE TABLE "public"."x"');
  });
});
