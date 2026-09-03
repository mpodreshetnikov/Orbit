import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as deploySupabase from "./deploy-supabase.cjs";

const { buildSteps, parseArgs } = deploySupabase;

const PROJECT_REF = "abcdefghijklmnopqrst";
const DATABASE_URL =
  "postgresql://postgres.abcdefghijklmnopqrst:pw@pooler.example.com:5432/postgres";

function stepsFor() {
  return buildSteps({ projectRef: PROJECT_REF, databaseUrl: DATABASE_URL });
}

describe("deploy-supabase step composition", () => {
  it("deploys functions, then migrations, then the SQL entrypoint", () => {
    const steps = stepsFor();

    expect(steps).toHaveLength(3);
    expect(steps[0].args.slice(0, 3)).toEqual(["supabase", "functions", "deploy"]);
    expect(steps[1].args.slice(0, 3)).toEqual(["supabase", "db", "push"]);
    expect(steps[2].args).toEqual(["supabase/db/run-deploy.js"]);
  });

  it("pushes migrations with --include-all so an out-of-order file cannot wedge the deploy", () => {
    const push = stepsFor()[1];

    expect(push.args).toContain("--include-all");
    expect(push.args).toContain("--yes");
    expect(push.args).toEqual(expect.arrayContaining(["--db-url", DATABASE_URL]));
  });

  it("targets the project ref when deploying functions", () => {
    const functionsDeploy = stepsFor()[0];

    expect(functionsDeploy.args).toEqual(expect.arrayContaining(["--project-ref", PROJECT_REF]));
  });

  it("passes the database URL to run-deploy.js through the environment, not argv", () => {
    const sqlDeploy = stepsFor()[2];

    expect(sqlDeploy.env).toEqual({ DATABASE_URL });
    expect(sqlDeploy.args).not.toContain(DATABASE_URL);
  });
});

describe("production deploy serialisation", () => {
  const workflow = readFileSync(join(__dirname, "..", "..", ".github", "workflows", "main.yml"), {
    encoding: "utf8",
  });

  /** The body of one top-level job, from its key down to the next job key at the same indent. */
  function jobBlock(jobId: string): string {
    const match = new RegExp(`^  ${jobId}:\\n(?:(?! {2}\\S).*\\n)*`, "m").exec(workflow);
    expect(match, `job ${jobId} not found in main.yml`).not.toBeNull();
    return match![0];
  }

  it.each(["deploy-supabase", "deploy-vercel-production"])(
    "queues %s instead of letting two pushes to main race",
    (jobId) => {
      const block = jobBlock(jobId);

      expect(block).toMatch(/^ {4}concurrency:$/m);
      expect(block).toMatch(/^ {6}cancel-in-progress: false$/m);
    },
  );

  it("gives each production deploy its own group", () => {
    // A group shared between the two jobs would let a newer run's pending job displace this run's
    // other deploy, so one of the two would never run for that commit at all.
    const groupOf = (jobId: string) => /^ {6}group: (.+)$/m.exec(jobBlock(jobId))?.[1];

    expect(groupOf("deploy-supabase")).toBeDefined();
    expect(groupOf("deploy-vercel-production")).toBeDefined();
    expect(groupOf("deploy-supabase")).not.toBe(groupOf("deploy-vercel-production"));
  });

  // A concurrency group excludes but does not order: a job joins its group when `needs` finish,
  // and quality-gates is minutes slower for a DB-impacting commit than for a docs-only one, so an
  // older push can arrive second and deploy last. Serialisation alone therefore still leaves
  // production behind main, which is the failure the groups were added for.
  const PRODUCTION_MUTATIONS: [job: string, mutation: RegExp][] = [
    ["deploy-supabase", /just ci-deploy-supabase/],
    ["deploy-vercel-production", /vercel deploy --prebuilt --prod/],
  ];

  it.each(PRODUCTION_MUTATIONS)(
    "makes %s check it is still the tip of main before it mutates production",
    (jobId, mutation) => {
      const block = jobBlock(jobId);
      const checkAt = block.indexOf("uses: ./.github/actions/production-tip-check");
      const mutationAt = block.search(mutation);

      expect(checkAt, "the tip check is missing").toBeGreaterThan(-1);
      expect(mutationAt).toBeGreaterThan(-1);
      expect(checkAt, "the tip check runs after the mutation it guards").toBeLessThan(mutationAt);
    },
  );

  /** One job's steps, split on the `- ` that opens each entry of the `steps:` list. */
  function steps(jobId: string): string[] {
    const block = jobBlock(jobId);
    return block
      .slice(block.indexOf("\n    steps:"))
      .split(/^ {6}- /m)
      .slice(1);
  }

  it.each(PRODUCTION_MUTATIONS)(
    "skips %s's production mutation when the check says the commit is superseded",
    (jobId, mutation) => {
      const mutationStep = steps(jobId).filter((step) => mutation.test(step));

      // The condition has to sit on the step that mutates production, not merely somewhere in the
      // job: a guard on a neighbouring step leaves the deploy itself unconditional.
      expect(mutationStep).toHaveLength(1);
      expect(mutationStep[0]).toMatch(/if: steps\.tip\.outputs\.superseded != 'true'/);
    },
  );

  it("decides superseded by comparing against this run's own commit", () => {
    const action = readFileSync(
      join(__dirname, "..", "..", ".github", "actions", "production-tip-check", "action.yml"),
      { encoding: "utf8" },
    );

    expect(action).toMatch(/git fetch --depth=1 origin/);
    expect(action).toMatch(/\$\{\{ github\.sha \}\}/);
    expect(action).toMatch(/superseded=true/);
    expect(action).toMatch(/superseded=false/);
    // Standing down is a success: a superseded commit has nothing to deploy that the commit
    // replacing it will not deploy, so failing here would be noise on every burst of merges.
    expect(action).not.toMatch(/^\s*exit 1\s*$/m);
  });

  it("keys the groups on nothing that varies per run, so two runs actually collide", () => {
    // A group interpolating github.sha or github.run_id is one group per run, which serialises
    // nothing while looking like it does.
    for (const jobId of ["deploy-supabase", "deploy-vercel-production"]) {
      const group = /^ {6}group: (.+)$/m.exec(jobBlock(jobId))?.[1] ?? "";
      expect(group).not.toMatch(/github\.(sha|run_id|run_number|ref|event)/);
    }
  });
});

describe("deploy-supabase argument parsing", () => {
  it("reads the flags the just recipes pass", () => {
    expect(
      parseArgs(["--target", "ci", "--project-ref", PROJECT_REF, "--database-url", DATABASE_URL]),
    ).toEqual({
      target: "ci",
      "project-ref": PROJECT_REF,
      "database-url": DATABASE_URL,
    });
  });

  it("rejects a flag whose value is missing rather than swallowing the next flag", () => {
    expect(() => parseArgs(["--project-ref", "--database-url", DATABASE_URL])).toThrow(
      "Missing value for argument --project-ref",
    );
  });
});
