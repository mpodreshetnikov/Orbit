import { describe, expect, it } from "vitest";
import config, { sharedTestOptions } from "../../vitest.config";

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

  it("gives every project the shared options rather than relying on the root block", () => {
    // Compared against the shared values rather than against a floor: the point is that each
    // project carries them, whatever they are. A minimum of its own would break a deliberate
    // override -- `VITEST_TEST_TIMEOUT_MS=3000` to hunt slow tests is a legitimate thing to do.
    const shared = sharedTestOptions();
    for (const project of projects ?? []) {
      const name = project.test?.name;
      expect(project.test?.testTimeout, `project ${name} has no testTimeout`).toBe(
        shared.testTimeout,
      );
      expect(project.test?.hookTimeout, `project ${name} has no hookTimeout`).toBe(
        shared.hookTimeout,
      );
      expect(project.test?.retry, `project ${name} has no retry`).toBe(shared.retry);
    }
  });
});
