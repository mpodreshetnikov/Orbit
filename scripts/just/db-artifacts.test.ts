import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as dbArtifacts from "./db-artifacts.cjs";

const { assertPgDumpMajorMatches, parsePgDumpMajor, readConfiguredMajorVersion } = dbArtifacts;

const repoRoot = path.resolve(__dirname, "..", "..");

/**
 * A stand-in for `just` that fails with a chosen status.
 *
 * Written per platform because the script resolves `JUST_BIN` to a real executable and spawns it
 * without a shell: Windows runs neither a shebang nor an executable bit, so a `.sh` stub there
 * would fail to launch and the test would pass for the wrong reason.
 */
function failingJustStub(status: number): string {
  const stubDir = mkdtempSync(path.join(tmpdir(), "db-artifacts-"));
  if (process.platform === "win32") {
    const stub = path.join(stubDir, "just-stub.cmd");
    writeFileSync(stub, `@echo off\r\nexit /b ${status}\r\n`);
    return stub;
  }
  const stub = path.join(stubDir, "just-stub.sh");
  writeFileSync(stub, `#!/usr/bin/env bash\nexit ${status}\n`);
  chmodSync(stub, 0o755);
  return stub;
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
    const result = spawnSync(process.execPath, ["scripts/just/db-artifacts.cjs", "--verify"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        JUST_BIN: failingJustStub(3),
        SUPABASE_ALREADY_RUNNING: "1",
      },
    });

    expect(result.status).toBe(3);
  });

  it("lets an unexpected exception end the process rather than reporting success", () => {
    // The exit code is not the only way this can go quiet. An exception nothing catches -- a
    // read-only workspace, a full disk -- must still end the run: converting it into a zero would
    // be the same false green wearing a different hat. Provoked with a docker-preflight stub that
    // throws, since that runs before anything needs a database.
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
