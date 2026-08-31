import { describe, expect, it } from "vitest";
import * as retry from "./supabase-cli-retry.cjs";

const { runWithRetry, isRetryable, MAX_ATTEMPTS } = retry as {
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

describe("supabase CLI retry", () => {
  it("recognises the readiness failure and nothing that looks like our own", () => {
    expect(isRetryable(READINESS_502)).toBe(true);
    // The failures that must never be retried: retrying a broken migration would turn a clear
    // error into a slow one, three times over, which is how a real defect gets read as flake.
    expect(isRetryable('ERROR: syntax error at or near "creat"')).toBe(false);
    expect(isRetryable("failed to bind host port 54322: address already in use")).toBe(false);
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
});
