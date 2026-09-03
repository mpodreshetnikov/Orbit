import { describe, expect, it } from "vitest";
import * as retry from "./supabase-cli-retry.cjs";

const { runWithRetry, isRetryable, launchSpec, MAX_ATTEMPTS } = retry as {
  launchSpec: (
    args: string[],
    options: { platform: string; env: Record<string, string>; npxBin?: string },
  ) => { command: string; args: string[] };
  runWithRetry: (input: {
    args: string[];
    run: (args: string[], attempt: number) => Promise<{ status: number; combined: string }>;
    sleep?: (ms: number) => Promise<void>;
    log?: (message: string) => void;
  }) => Promise<{ status: number; attempts: number }>;
  isRetryable: (output: string) => boolean;
  MAX_ATTEMPTS: number;
};

const noSleep = async () => {};
const noLog = () => {};

const READINESS_502 = [
  "Applying migration 20260814094000_add_money_import_grants.sql...",
  "Seeding data from supabase/seed.sql...",
  "supabase_edge_runtime_orbit container logs:",
  "Stopping containers...",
  "Error status 502: An invalid response was received from the upstream server",
].join("\n");

// Deploy run 33750939385, attempt 1, 2026-09-03: the restart after the seed loses its own port.
const RESTART_PORT_COLLISION = [
  "Applying migration 20260902060000_default_grant_issuer_to_auth_uid.sql...",
  "Seeding data from supabase/seed.sql...",
  "Starting containers...",
  "Stopping containers...",
  'failed to start docker container "supabase_inbucket_orbit": Error response from daemon: ' +
    "failed to set up container networking: driver failed programming external connectivity on " +
    "endpoint supabase_inbucket_orbit (63734ad5): failed to bind host port for " +
    "0.0.0.0:54324:172.18.0.7:8025/tcp: address already in use",
  "Error: failed to start containers: 7c7a4f47",
].join("\n");

describe("supabase CLI retry", () => {
  it("recognises the restart failures and nothing that looks like our own", () => {
    expect(isRetryable(READINESS_502)).toBe(true);
    expect(isRetryable(RESTART_PORT_COLLISION)).toBe(true);
    // The failures that must never be retried: retrying a broken migration would turn a clear
    // error into a slow one, three times over, which is how a real defect gets read as flake.
    expect(isRetryable('ERROR: syntax error at or near "creat"')).toBe(false);
    // A port collision before any migration ran is a developer's own stack still up.
    expect(isRetryable("failed to bind host port 54322: address already in use")).toBe(false);
    expect(
      isRetryable(
        "Starting containers...\nfailed to bind host port for 0.0.0.0:54322:172.18.0.2:5432/tcp: " +
          "address already in use\nSeeding data from supabase/seed.sql...",
      ),
    ).toBe(false);
    expect(isRetryable("Error status 500: internal error")).toBe(false);
    expect(isRetryable('relation "money_transactions" already exists')).toBe(false);
  });

  it("retries the readiness failure until it clears", async () => {
    const attempts: number[] = [];
    const result = await runWithRetry({
      args: ["start"],
      sleep: noSleep,
      log: noLog,
      run: async (_args, attempt) => {
        attempts.push(attempt);
        return attempt < 3 ? { status: 1, combined: READINESS_502 } : { status: 0, combined: "" };
      },
    });

    expect(result).toEqual({ status: 0, attempts: 3 });
    expect(attempts).toEqual([1, 2, 3]);
  });

  it("gives up after the bounded number of attempts", async () => {
    let calls = 0;
    const result = await runWithRetry({
      args: ["db", "reset", "--yes"],
      sleep: noSleep,
      log: noLog,
      run: async () => {
        calls += 1;
        return { status: 1, combined: READINESS_502 };
      },
    });

    // Bounded on purpose: a 502 that survives three clean attempts is not a race any more, and
    // a CI lane that retries forever is worse than one that fails.
    expect(calls).toBe(MAX_ATTEMPTS);
    expect(result.status).toBe(1);
  });

  it("does not retry anything else, and keeps the CLI's exit status", async () => {
    let calls = 0;
    const result = await runWithRetry({
      args: ["db", "reset", "--yes"],
      sleep: noSleep,
      log: noLog,
      run: async () => {
        calls += 1;
        return { status: 3, combined: 'ERROR: syntax error at or near "creat"' };
      },
    });

    expect(calls).toBe(1);
    expect(result).toEqual({ status: 3, attempts: 1 });
  });

  it("passes a first-attempt success straight through", async () => {
    let calls = 0;
    const result = await runWithRetry({
      args: ["start"],
      sleep: noSleep,
      log: noLog,
      run: async () => {
        calls += 1;
        return { status: 0, combined: "Started supabase local development setup." };
      },
    });

    expect(calls).toBe(1);
    expect(result).toEqual({ status: 0, attempts: 1 });
  });

  it("launches npx through the command interpreter on Windows, where Node cannot spawn a .cmd", () => {
    const args = ["supabase", "start"];

    expect(launchSpec(args, { platform: "linux", env: {}, npxBin: "/usr/bin/npx" })).toEqual({
      command: "/usr/bin/npx",
      args,
    });
    expect(
      launchSpec(args, {
        platform: "win32",
        env: { ComSpec: "C:\\W\\cmd.exe" },
        npxBin: "npx.cmd",
      }),
    ).toEqual({ command: "C:\\W\\cmd.exe", args: ["/d", "/s", "/c", "npx.cmd", ...args] });
    expect(launchSpec(args, { platform: "win32", env: {}, npxBin: "npx.cmd" }).command).toBe(
      "cmd.exe",
    );
  });
});
