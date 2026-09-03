import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// `supabase/setup-cli` resolves `version: latest` through an anonymous GitHub API call, whose
// per-IP limit is shared by every hosted runner. Run 317 lost its database deploy to
// `rate limit exceeded` in that step, so the version is pinned and downloaded directly instead.
// The pin must be the CLI the repository already runs through `npx supabase`, otherwise CI and a
// developer's `db reset` prove different binaries (T-260903-ut8).

const root = join(__dirname, "..", "..");
const workflow = readFileSync(join(root, ".github", "workflows", "main.yml"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** The `version:` under every `supabase/setup-cli` step, in file order. */
function setupCliVersions(): string[] {
  return [
    ...workflow.matchAll(/^\s*- uses: supabase\/setup-cli@v\d+\n\s*with:\n\s*version: (\S+)$/gm),
  ].map((match) => match[1]);
}

describe("Supabase CLI version in CI", () => {
  it("pins every setup-cli step instead of resolving latest through the GitHub API", () => {
    const versions = setupCliVersions();

    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("pins the same CLI package.json installs, so CI and a developer run one binary", () => {
    const range = packageJson.devDependencies?.supabase ?? packageJson.dependencies?.supabase;
    expect(range, "package.json no longer declares the supabase CLI").toBeDefined();
    const declared = range!.replace(/^[\^~]/, "");

    expect(declared).toMatch(/^\d+\.\d+\.\d+$/);
    for (const version of setupCliVersions()) {
      expect(version).toBe(declared);
    }
  });

  it("covers both jobs that run the CLI, which is where the step count comes from", () => {
    // quality-gates and deploy-supabase; a third job running the CLI should pin too, and a job
    // dropping the step is a change worth noticing here.
    expect(setupCliVersions()).toHaveLength(2);
  });
});
