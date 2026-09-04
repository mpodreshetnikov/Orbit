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
  it("applies migrations, then the SQL entrypoint, and deploys functions last", () => {
    // The schema moves before the code that writes to it: an additive migration paired with a
    // function that uses the new column has no window in which the function runs against the old
    // schema. The reverse order left exactly that window (T-260902-r9c).
    const steps = stepsFor();

    expect(steps).toHaveLength(3);
    expect(steps[0].args.slice(0, 3)).toEqual(["supabase", "db", "push"]);
    expect(steps[1].args).toEqual(["supabase/db/run-deploy.js"]);
    expect(steps[2].args.slice(0, 3)).toEqual(["supabase", "functions", "deploy"]);
  });

  it("names the direction the chosen order leaves unprotected, next to the order", () => {
    // Whoever next edits buildSteps must see that swapping the steps back reopens the additive
    // window, and that a destructive migration is unsafe in both orders without a two-step change.
    const source = readFileSync(join(__dirname, "deploy-supabase.cjs"), "utf8");
    const comment = source.slice(0, source.indexOf("function buildSteps"));

    expect(comment).toMatch(/schema moves before the functions/);
    expect(comment).toMatch(/removes or renames/);
    expect(comment).toMatch(/tolerates both shapes/);
  });

  it("pushes migrations with --include-all so an out-of-order file cannot wedge the deploy", () => {
    const push = stepsFor()[0];

    expect(push.args).toContain("--include-all");
    expect(push.args).toContain("--yes");
    expect(push.args).toEqual(expect.arrayContaining(["--db-url", DATABASE_URL]));
  });

  it("targets the project ref when deploying functions", () => {
    const functionsDeploy = stepsFor()[2];

    expect(functionsDeploy.args).toEqual(expect.arrayContaining(["--project-ref", PROJECT_REF]));
  });

  it("passes the database URL to run-deploy.js through the environment, not argv", () => {
    const sqlDeploy = stepsFor()[1];

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
      expect(mutationStep[0]).toMatch(/if: steps\.tip\.outputs\.deploy_sha != ''/);
    },
  );

  it("checks before it builds, so a superseded run spends no build on nothing", () => {
    const block = jobBlock("deploy-vercel-production");
    const checkAt = block.indexOf("uses: ./.github/actions/production-tip-check");
    const buildAt = block.search(/vercel build --prod/);

    expect(buildAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(buildAt);
  });

  it.each(["deploy-supabase", "deploy-vercel-production"])(
    "grants %s actions:read, which the check needs to read the tip's own run",
    (jobId) => {
      const block = jobBlock(jobId);
      const permissions = /^ {4}permissions:\n((?: {6}.*\n)+)/m.exec(block);

      expect(permissions, `${jobId} declares no permissions`).not.toBeNull();
      expect(permissions![1]).toMatch(/^ {6}actions: read$/m);
    },
  );

  it.each([
    ["deploy-supabase", "Deploy Supabase Production"],
    ["deploy-vercel-production", "Deploy Vercel Production"],
  ])("tells the check %s's own job name, so it inspects the right counterpart", (jobId, name) => {
    const check = steps(jobId).find((step) => step.includes("production-tip-check"));

    expect(check).toBeDefined();
    expect(check!).toMatch(new RegExp(`job: ${name}$`, "m"));
    expect(jobBlock(jobId)).toMatch(new RegExp(`^    name: ${name}$`, "m"));
  });

  it("stands down for a tip its own run deploys, and fails for a tip whose deploy was displaced", () => {
    const action = readFileSync(
      join(__dirname, "..", "..", ".github", "actions", "production-tip-check", "action.yml"),
      { encoding: "utf8" },
    );

    expect(action).toMatch(/git fetch --depth=1 origin/);
    expect(action).toMatch(/superseded=true/);
    expect(action).toMatch(/superseded=false/);
    // Only ever this run's own commit or nothing: the tip is never deployed in this run's place,
    // because a run cancelled by hand looks like a displaced one and the tip may have changed
    // the deploy job itself.
    expect(action).toMatch(/deploy_sha=\$\{RUN_SHA\}/);
    expect(action).toMatch(/echo "deploy_sha=" >>/);
    expect(action).not.toMatch(/deploy_sha=\$\{tip\}/);
    expect(action).not.toMatch(/git checkout/);
    // The tip's own run is read from the API, and this job's counterpart in it decides: a
    // cancelled one was displaced by this run and fails it with the re-run to make.
    expect(action).toMatch(
      /actions\/workflows\/\$\{WORKFLOW\}\/runs\?head_sha=\$\{tip\}&event=push/,
    );
    expect(action).toMatch(/select\(\.name == \$name\)/);
    expect(action).toMatch(/if \[\[ "\$job_state" == "cancelled" \]\]; then/);
    expect(action).toMatch(/Re-run run \$\{run_id\}/);
    expect(action).toMatch(/^\s*exit 1\s*$/m);
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
