import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// The module under test lives in supabase/db, beside the SQL it applies; this test lives here
// because tsconfig.json and quality-lint-scripts both exclude supabase/, so a test file there
// would be run by vitest but read by neither the typechecker nor eslint.
import * as runDeploy from "../../supabase/db/run-deploy.js";

type Phase = { name: string; file: string; unit: "transaction" | "file" | "statement" };

const {
  MAX_ATTEMPTS,
  PHASES,
  SESSION_SETTINGS,
  buildPsqlArgs,
  failureReport,
  getDatabaseUrlFromArgs,
  isRetryableFailure,
  parsePhaseFilesFromDeploySql,
  parseSessionSettingsFromDeploySql,
  phaseUnits,
  readDeploySql,
} = runDeploy as unknown as {
  MAX_ATTEMPTS: number;
  PHASES: Phase[];
  SESSION_SETTINGS: string[];
  buildPsqlArgs: (input: {
    connectionString: string;
    gitSha: string;
    phaseFile: string;
    singleTransaction?: boolean;
  }) => string[];
  failureReport: (input: {
    phase: Phase;
    phaseIndex: number;
    attempts: number;
    stderr: string;
    gitSha: string;
    applied?: string[];
    failedUnit?: string | null;
  }) => string[];
  phaseUnits: (phase: Phase) => string[];
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

  it("keeps lock_timeout under the 1s deadlock_timeout default, so the deploy loses first", () => {
    // The deploy has to give a contended lock up before any deadlock detector runs, or it goes on
    // being chosen as the victim at an arbitrary point in the phase. It cannot get there by
    // raising deadlock_timeout -- see the next test -- so it ducks under the default instead.
    const POSTGRES_DEADLOCK_TIMEOUT_MS = 1000;
    const lockTimeout = SESSION_SETTINGS.find((setting) => setting.includes("lock_timeout"));

    expect(lockTimeout).toBeDefined();
    const ms = /= '(\d+)(ms|s)'/.exec(lockTimeout!);
    expect(ms, `unparseable lock_timeout: ${lockTimeout}`).not.toBeNull();
    const value = Number(ms![1]) * (ms![2] === "s" ? 1000 : 1);

    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(POSTGRES_DEADLOCK_TIMEOUT_MS);
  });

  it("sets no parameter the deploy role is not allowed to set", () => {
    // The deploy connects as `postgres`, which is not a superuser on Supabase (rolsuper = false),
    // and psql runs with ON_ERROR_STOP, so a SET the role may not perform does not degrade: it
    // fails the phase outright and the deploy stops there. deadlock_timeout is the one that bit --
    // it reads as the natural partner to lock_timeout and is `context = 'superuser'` in
    // pg_settings, so every deploy would have died on the first phase.
    const SUPERUSER_ONLY = [
      "deadlock_timeout",
      "log_min_duration_statement",
      "log_statement",
      "session_replication_role",
      "zero_damaged_pages",
    ];

    for (const setting of SESSION_SETTINGS) {
      for (const parameter of SUPERUSER_ONLY) {
        expect(setting, `${parameter} cannot be set by the deploy role`).not.toContain(parameter);
      }
    }
  });

  it("stamps the version last, so a failed phase cannot leave the log claiming this sha", () => {
    expect(PHASES.at(-1)?.file).toBe("_version.sql");
  });

  it("knows what each phase leaves behind on failure, from the file's own shape", () => {
    const sql = (file: string) =>
      readFileSync(join(__dirname, "..", "..", "supabase", "db", file), "utf8");

    for (const phase of PHASES) {
      const wrapped = /^BEGIN;$/m.test(sql(phase.file)) && /^COMMIT;$/m.test(sql(phase.file));
      const includes = parsePhaseFilesFromDeploySql(sql(phase.file)).length;
      if (phase.unit === "file") {
        expect(includes, `${phase.file} should be a list of \\i files`).toBeGreaterThan(1);
      } else if (phase.unit === "transaction") {
        expect(wrapped, `${phase.file} should be one BEGIN/COMMIT`).toBe(true);
      } else {
        expect(wrapped, `${phase.file} should be autocommit`).toBe(false);
      }
    }
  });

  it("applies the policy phase one file at a time, in the phase file's own order", () => {
    const policies = PHASES.find((phase) => phase.unit === "file")!;
    const units = phaseUnits(policies);

    expect(units).toEqual(
      parsePhaseFilesFromDeploySql(
        readFileSync(join(__dirname, "..", "..", "supabase", "db", policies.file), "utf8"),
      ),
    );
    expect(units.length).toBeGreaterThan(1);
    for (const unit of units) {
      expect(unit).toMatch(/^policies\//);
    }
    // Every other phase is applied as its one file.
    for (const phase of PHASES.filter((entry) => entry.unit !== "file")) {
      expect(phaseUnits(phase)).toEqual([phase.file]);
    }
  });
});

describe("run-deploy failure report", () => {
  const policies = PHASES.findIndex((phase) => phase.unit === "file");
  const report = (input: Partial<Parameters<typeof failureReport>[0]>) =>
    failureReport({
      phase: PHASES[policies],
      phaseIndex: policies,
      attempts: 3,
      stderr: "",
      gitSha: GIT_SHA,
      ...input,
    }).join("\n");

  it("counts the policy files that committed before the failing one, instead of 'not applied'", () => {
    const units = phaseUnits(PHASES[policies]);
    const text = report({ applied: units.slice(0, 2), failedUnit: units[2] });

    expect(text).toMatch(new RegExp(`Partially applied: ${PHASES[policies].name}`));
    expect(text).toContain(`2 of ${units.length} files committed, up to ${units[1]}`);
    expect(text).toContain(`${units[2]} failed`);
    expect(text).toContain(`the ${units.length - 3} files after it are not applied`);
    expect(text).toContain(`(on ${units[2]})`);
    // The phase itself is no longer listed as wholly not applied; the later phases are.
    expect(text).toMatch(/^Not applied: Phase 4: Cron Jobs, Phase 5: Version stamp$/m);
  });

  it("says a failed transaction phase was rolled back, which is what one transaction leaves", () => {
    const text = report({
      phase: PHASES[0],
      phaseIndex: 0,
      applied: [],
      failedUnit: PHASES[0].file,
    });

    expect(text).toMatch(/^Rolled back: +Phase 1: Types \+ Functions -- one transaction/m);
    expect(text).not.toMatch(/Partially applied/);
    expect(text).toMatch(/^Applied: +none$/m);
  });

  it("says an autocommit phase keeps the statements before the failing one", () => {
    const cron = PHASES.findIndex((phase) => phase.file === "04_cron.sql");
    const text = report({
      phase: PHASES[cron],
      phaseIndex: cron,
      applied: [],
      failedUnit: PHASES[cron].file,
    });

    expect(text).toMatch(/Partially applied: Phase 4: Cron Jobs -- it runs in autocommit/);
    expect(text).toMatch(/^Not applied: Phase 5: Version stamp$/m);
  });

  it("always says the database is not at this sha, whatever the phase", () => {
    for (const [phaseIndex, phase] of PHASES.entries()) {
      expect(report({ phase, phaseIndex, applied: [], failedUnit: phase.file })).toContain(
        `The database is NOT at ${GIT_SHA}`,
      );
    }
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

  it("wraps a policy file in one transaction when it is applied on its own", () => {
    const args = buildPsqlArgs({
      connectionString: CONNECTION_STRING,
      gitSha: GIT_SHA,
      phaseFile: "policies/persons.sql",
      singleTransaction: true,
    });

    expect(args.indexOf("--single-transaction")).toBeGreaterThan(-1);
    expect(args.indexOf("--single-transaction")).toBeLessThan(args.indexOf("-f"));
    expect(
      buildPsqlArgs({ connectionString: CONNECTION_STRING, gitSha: GIT_SHA, phaseFile: "x.sql" }),
    ).not.toContain("--single-transaction");
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
