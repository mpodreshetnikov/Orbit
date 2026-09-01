import { describe, expect, it } from "vitest";
import config from "../../vitest.config";

/**
 * The root `test` block is not inherited by entries in `projects`.
 *
 * Vitest resolves each project's config on its own, so a `testTimeout` set only at the root is
 * read by nothing and every test runs on the built-in 5-second default. That failure is silent
 * and it does not look like a configuration bug: it surfaces as whichever tests happen to be
 * slowest timing out on a loaded CI runner, in files unrelated to the change under test.
 */
describe("vitest project configuration", () => {
  const projects = (config as { test?: { projects?: Array<{ test?: Record<string, unknown> }> } })
    .test?.projects;

  it("defines projects", () => {
    expect(projects?.length).toBeGreaterThan(0);
  });

  it("gives every project its own timeouts rather than relying on the root block", () => {
    for (const project of projects ?? []) {
      const name = project.test?.name;
      expect(project.test?.testTimeout, `project ${name} has no testTimeout`).toBeGreaterThan(5000);
      expect(project.test?.hookTimeout, `project ${name} has no hookTimeout`).toBeGreaterThan(5000);
    }
  });
});
