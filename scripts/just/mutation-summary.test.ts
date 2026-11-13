import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { summarizeMutantStatuses } = require("./mutation-summary.cjs") as {
  summarizeMutantStatuses: (files: Record<string, { mutants: { status: string }[] }>) => {
    mutationScore: number | null;
    mutationScoreCovered: number | null;
    killed: number;
    survived: number;
    noCoverage: number;
    timeout: number;
    runtimeErrors: number;
    ignored: number;
    totalMutants: number;
  };
};

describe("summarizeMutantStatuses", () => {
  it("excludes invalid mutants from both score denominators", () => {
    const summary = summarizeMutantStatuses({
      "a.ts": {
        mutants: [{ status: "Killed" }, { status: "RuntimeError" }, { status: "CompileError" }],
      },
    });
    expect(summary.killed).toBe(1);
    expect(summary.runtimeErrors).toBe(2);
    expect(summary.totalMutants).toBe(1);
    expect(summary.mutationScore).toBe(100);
    expect(summary.mutationScoreCovered).toBe(100);
  });

  it("keeps NoCoverage in the overall denominator but not covered", () => {
    const summary = summarizeMutantStatuses({
      "a.ts": {
        mutants: [{ status: "Killed" }, { status: "Survived" }, { status: "NoCoverage" }],
      },
    });
    expect(summary.totalMutants).toBe(3);
    expect(summary.mutationScore).toBe(33.33);
    expect(summary.mutationScoreCovered).toBe(50);
  });
});
