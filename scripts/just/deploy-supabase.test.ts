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
