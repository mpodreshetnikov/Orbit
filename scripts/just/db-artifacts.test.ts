import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as dbArtifacts from "./db-artifacts.cjs";

const { assertPgDumpMajorMatches, parsePgDumpMajor, readConfiguredMajorVersion } = dbArtifacts;

const repoRoot = path.resolve(__dirname, "..", "..");

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
    const stubDir = mkdtempSync(path.join(tmpdir(), "db-artifacts-"));
    const stub = path.join(stubDir, "just-stub.sh");
    writeFileSync(stub, "#!/usr/bin/env bash\nexit 3\n");
    chmodSync(stub, 0o755);

    const result = spawnSync(process.execPath, ["scripts/just/db-artifacts.cjs", "--verify"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        JUST_BIN: stub,
        SUPABASE_ALREADY_RUNNING: "1",
      },
    });

    expect(result.status).toBe(3);
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

  it("refuses a client older than the server, naming what to install", () => {
    expect(() => assertPgDumpMajorMatches(16, 17)).toThrow(/postgresql-client-17/);
    expect(() => assertPgDumpMajorMatches(16, 17)).toThrow(/pg_dump is version 16/);
  });

  it("allows a client at or ahead of the server, and says nothing when either is unreadable", () => {
    expect(() => assertPgDumpMajorMatches(17, 17)).not.toThrow();
    expect(() => assertPgDumpMajorMatches(18, 17)).not.toThrow();
    expect(() => assertPgDumpMajorMatches(null, 17)).not.toThrow();
    expect(() => assertPgDumpMajorMatches(16, null)).not.toThrow();
  });
});
