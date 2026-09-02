import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The module under test lives in supabase/db, beside the SQL it applies; this test lives here
// because tsconfig.json and quality-lint-scripts both exclude supabase/, so a test file there
// would be run by vitest but read by neither the typechecker nor eslint.
import * as runDeploy from "../../supabase/db/run-deploy.js";

const {
  MAX_ATTEMPTS,
  PHASES,
  SESSION_SETTINGS,
  buildPsqlArgs,
  getDatabaseUrlFromArgs,
  isRetryableFailure,
  parsePhaseFilesFromDeploySql,
  parseSessionSettingsFromDeploySql,
  readDeploySql,
} = runDeploy as unknown as {
  MAX_ATTEMPTS: number;
  PHASES: { name: string; file: string }[];
  SESSION_SETTINGS: string[];
  buildPsqlArgs: (input: {
    connectionString: string;
    gitSha: string;
    phaseFile: string;
  }) => string[];
  getDatabaseUrlFromArgs: (argv: string[]) => string;
  isRetryableFailure: (stderr: string) => boolean;
  parsePhaseFilesFromDeploySql: (sql: string) => string[];
  parseSessionSettingsFromDeploySql: (sql: string) => string[];
  readDeploySql: () => string;
};

const CONNECTION_STRING = "postgresql://postgres.abc:pw@pooler.example.com:5432/postgres";
const GIT_SHA = "c6bc5ff880fb5904212cda1dd16042dc0675b280";

describe("run-deploy phase plan", () => {
  it("applies the same phases, in the same order, as the single-shot deploy.sql", () => {
    expect(PHASES.map((phase) => phase.file)).toEqual(
      parsePhaseFilesFromDeploySql(readDeploySql()),
    );
  });

  it("sets the same session lock behaviour as the single-shot deploy.sql", () => {
    expect(SESSION_SETTINGS).toEqual(parseSessionSettingsFromDeploySql(readDeploySql()));
  });

  it("keeps lock_timeout below deadlock_timeout so the deploy gives the lock up itself", () => {
    const seconds = (setting: string) => Number(/= '(\d+)s'/.exec(setting)?.[1]);
    const lockTimeout = SESSION_SETTINGS.find((setting) => setting.includes("lock_timeout"));
    const deadlockTimeout = SESSION_SETTINGS.find((setting) =>
      setting.includes("deadlock_timeout"),
    );

    expect(lockTimeout).toBeDefined();
    expect(deadlockTimeout).toBeDefined();
    expect(seconds(lockTimeout!)).toBeGreaterThan(0);
    expect(seconds(lockTimeout!)).toBeLessThan(seconds(deadlockTimeout!));
  });

  it("stamps the version last, so a failed phase cannot leave the log claiming this sha", () => {
    expect(PHASES.at(-1)?.file).toBe("_version.sql");
  });
});

describe("the policy phase the runner retries", () => {
  const policyPhase = readFileSync(
    join(__dirname, "..", "..", "supabase", "db", "03_policies.sql"),
    "utf8",
  );

  it("opens and closes a transaction around every policy file", () => {
    const statements = [...policyPhase.matchAll(/^(BEGIN;|COMMIT;|\\i .+)$/gm)].map(
      (match) => match[1],
    );

    expect(statements.length).toBeGreaterThan(0);
    expect(statements.length % 3).toBe(0);
    for (let index = 0; index < statements.length; index += 3) {
      expect(statements[index]).toBe("BEGIN;");
      expect(statements[index + 1]).toMatch(/^\\i policies\//);
      expect(statements[index + 2]).toBe("COMMIT;");
    }
  });

  it("holds no lock across two files, which is what deadlocked with live traffic", () => {
    // Two \i lines inside one transaction is the shape that held AccessExclusiveLock on persons
    // from the second file to the end of the phase.
    expect(policyPhase).not.toMatch(/^\\i .+\n(?:(?!COMMIT;)[^\n]*\n)*\\i /m);
  });
});

describe("run-deploy psql invocation", () => {
  it("stops on the first error and passes the sha the stamp records", () => {
    const args = buildPsqlArgs({
      connectionString: CONNECTION_STRING,
      gitSha: GIT_SHA,
      phaseFile: "03_policies.sql",
    });

    expect(args[0]).toBe(CONNECTION_STRING);
    expect(args).toEqual(expect.arrayContaining(["-v", "ON_ERROR_STOP=1"]));
    expect(args).toEqual(expect.arrayContaining(["-v", `GIT_SHA=${GIT_SHA}`]));
    expect(args.slice(-2)).toEqual(["-f", "03_policies.sql"]);
  });

  it("sends the lock settings before the phase file, so they are in force while it runs", () => {
    const args = buildPsqlArgs({
      connectionString: CONNECTION_STRING,
      gitSha: GIT_SHA,
      phaseFile: "03_policies.sql",
    });

    for (const setting of SESSION_SETTINGS) {
      expect(args.indexOf(setting)).toBeGreaterThan(-1);
      expect(args.indexOf(setting)).toBeLessThan(args.indexOf("-f"));
      expect(args[args.indexOf(setting) - 1]).toBe("-c");
    }
  });
});

describe("run-deploy failure classification", () => {
  it("retries the deadlock the policy phase loses to live traffic", () => {
    expect(
      isRetryableFailure(
        "psql:policies/notification_routing.sql:3: ERROR:  deadlock detected\n" +
          "DETAIL: Process A waits for AccessExclusiveLock on relation 26580 of database 5;",
      ),
    ).toBe(true);
  });

  it("retries a lock_timeout the deploy imposed on itself", () => {
    expect(
      isRetryableFailure(
        "psql:03_policies.sql:9: ERROR:  55P03: canceling statement due to lock timeout",
      ),
    ).toBe(true);
  });

  it("retries the catalogue race two overlapping deploys produce in Phase 1", () => {
    expect(
      isRetryableFailure(
        "psql:functions/_is_allowed_user.sql:17: ERROR:  tuple concurrently updated",
      ),
    ).toBe(true);
  });

  it("does not retry a broken statement, which no amount of waiting fixes", () => {
    expect(
      isRetryableFailure(
        'psql:policies/persons.sql:3: ERROR:  relation "public.persons" does not exist',
      ),
    ).toBe(false);
    expect(isRetryableFailure("")).toBe(false);
  });

  it("bounds the retries, so a phase that keeps losing fails the run", () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(5);
  });
});

describe("run-deploy argument parsing", () => {
  it("reads --database-url in both spellings", () => {
    expect(getDatabaseUrlFromArgs(["--database-url", CONNECTION_STRING])).toBe(CONNECTION_STRING);
    expect(getDatabaseUrlFromArgs([`--database-url=${CONNECTION_STRING}`])).toBe(CONNECTION_STRING);
    expect(getDatabaseUrlFromArgs(["local"])).toBe("");
  });
});
