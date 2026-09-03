import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Which Supabase CLI runs in CI, and where it comes from.
//
// Every CLI invocation in the workflow goes through `npx supabase` (the just recipes and
// scripts/just/deploy-supabase.cjs), so the binary that runs is the one `npm ci` installs from
// package-lock.json -- or, in a job with no local install, whatever npm serves that day.
// `supabase/setup-cli` never supplied the binary that ran, and its `version: latest` lookup is
// an anonymous GitHub API call that cost run 317 its database deploy with `rate limit exceeded`.
// The npm package ships the binary as a platform optionalDependency from the registry, so with
// the action gone and `npm ci` in every job that runs the CLI, provisioning touches GitHub for
// nothing and every job runs the lockfile's version (T-260903-ut8).

const root = join(__dirname, "..", "..");
const workflow = readFileSync(join(root, ".github", "workflows", "main.yml"), "utf8");

/** The body of one top-level job, from its key down to the next job key at the same indent. */
function jobBlock(jobId: string): string {
  const match = new RegExp(`^  ${jobId}:\\n(?:(?! {2}\\S).*\\n)*`, "m").exec(workflow);
  expect(match, `job ${jobId} not found in main.yml`).not.toBeNull();
  return match![0];
}

/** Jobs whose steps invoke the Supabase CLI, through a just recipe or directly. */
const CLI_JOBS = ["quality-gates", "deploy-supabase"];

describe("Supabase CLI provisioning in CI", () => {
  it("does not resolve the CLI through supabase/setup-cli, whose latest lookup hits the API limit", () => {
    expect(workflow).not.toMatch(/uses:\s*supabase\/setup-cli/);
  });

  it.each(CLI_JOBS)("installs the lockfile's CLI with npm ci before %s runs it", (jobId) => {
    const block = jobBlock(jobId);
    const install = block.search(/^\s*(?:- )?run: npm ci$/m);
    const firstUse = block.search(
      /^\s*(?:- )?run: (just (ci-deploy-supabase|supabase-local-\w+)|npx supabase)/m,
    );

    expect(install, `${jobId} has no npm ci step`).toBeGreaterThan(-1);
    expect(firstUse, `${jobId} does not appear to run the CLI`).toBeGreaterThan(-1);
    expect(install).toBeLessThan(firstUse);
  });

  it("locks the CLI to one exact version, so npm ci cannot drift from what developers run", () => {
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
      packages: Record<string, { version?: string }>;
    };

    expect(lock.packages["node_modules/supabase"]?.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
