import { describe, expect, it } from "vitest";
import * as buildLocalAll from "./build-local-all.cjs";

const { resolveDbExecutionPlan } = buildLocalAll;

describe("build-local-all db mode resolution", () => {
  it("always mode forces DB checks", () => {
    const plan = resolveDbExecutionPlan({
      dbMode: "always",
      impact: { dbImpact: false, changedFiles: [] },
    });

    expect(plan.runDbChecks).toBe(true);
  });

  it("skip mode disables DB checks", () => {
    const plan = resolveDbExecutionPlan({
      dbMode: "skip",
      impact: { dbImpact: true, changedFiles: ["supabase/db/functions/a.sql"] },
    });

    expect(plan.runDbChecks).toBe(false);
  });

  it("auto mode runs DB checks when dbImpact is true", () => {
    const plan = resolveDbExecutionPlan({
      dbMode: "auto",
      impact: { dbImpact: true, changedFiles: ["supabase/migrations/001.sql"] },
    });

    expect(plan.runDbChecks).toBe(true);
  });

  it("auto mode skips DB checks when non-db files changed", () => {
    const plan = resolveDbExecutionPlan({
      dbMode: "auto",
      impact: { dbImpact: false, changedFiles: ["src/components/a.tsx"] },
    });

    expect(plan.runDbChecks).toBe(false);
  });

  it("auto mode falls back to safe behavior when impact is unavailable", () => {
    const plan = resolveDbExecutionPlan({
      dbMode: "auto",
      impact: null,
    });

    expect(plan.runDbChecks).toBe(true);
  });
});
