import { describe, expect, it } from "vitest";
import {
  evaluateCoveredMutationGate,
  evaluateCoveredMutationGateFromReport,
  summarizeMutantStatuses,
} from "./mutation-summary.cjs";

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

  it("counts Timeout as detected (Stryker v8/v9 covered formula)", () => {
    const summary = summarizeMutantStatuses({
      "a.ts": {
        mutants: [{ status: "Killed" }, { status: "Timeout" }, { status: "Ignored" }],
      },
    });
    expect(summary.timeout).toBe(1);
    expect(summary.ignored).toBe(1);
    expect(summary.totalMutants).toBe(2);
    expect(summary.mutationScore).toBe(100);
    expect(summary.mutationScoreCovered).toBe(100);
  });

  it("returns null scores when there are no valid mutants", () => {
    const summary = summarizeMutantStatuses({
      "a.ts": { mutants: [{ status: "Ignored" }, { status: "RuntimeError" }] },
    });
    expect(summary.mutationScore).toBeNull();
    expect(summary.mutationScoreCovered).toBeNull();
    expect(summary.totalMutants).toBe(0);
  });

  it("ignores unknown mutant statuses via the default branch", () => {
    const summary = summarizeMutantStatuses({
      "a.ts": { mutants: [{ status: "Killed" }, { status: "Pending" }] },
    });
    expect(summary.killed).toBe(1);
    expect(summary.totalMutants).toBe(1);
    expect(summary.mutationScoreCovered).toBe(100);
  });
});

describe("evaluateCoveredMutationGate", () => {
  it("passes null summary, incremental-skip, and empty covered sets", () => {
    expect(evaluateCoveredMutationGate(null).ok).toBe(true);
    expect(evaluateCoveredMutationGate(undefined).ok).toBe(true);
    expect(evaluateCoveredMutationGate({ mode: "incremental-skip" }).ok).toBe(true);
    expect(evaluateCoveredMutationGate({ mode: "incremental" }).ok).toBe(true);
    expect(
      evaluateCoveredMutationGate({
        mode: "incremental",
        survived: 0,
        mutationScoreCovered: null,
        noCoverage: 3,
      }).ok,
    ).toBe(true);
  });

  it("passes incremental-skip even when survivors are present in the payload", () => {
    // Kills mutants that drop the mode === "incremental-skip" check.
    expect(
      evaluateCoveredMutationGate({
        mode: "incremental-skip",
        survived: 5,
        mutationScoreCovered: 40,
      }).ok,
    ).toBe(true);
  });

  it("does not treat a normal incremental summary as a skip", () => {
    expect(
      evaluateCoveredMutationGate({
        mode: "incremental",
        survived: 1,
        mutationScoreCovered: 50,
      }).ok,
    ).toBe(false);
  });

  it("passes when covered score is 100 and nothing survived", () => {
    expect(
      evaluateCoveredMutationGate({
        mode: "incremental",
        survived: 0,
        mutationScoreCovered: 100,
        killed: 10,
      }).ok,
    ).toBe(true);
  });

  it("fails when any mutant survived on covered lines", () => {
    const gate = evaluateCoveredMutationGate({
      mode: "incremental",
      survived: 2,
      mutationScoreCovered: 90,
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("expected failure");
    expect(gate.reason).toMatch(/2 survived/);
  });

  it("fails when covered score is below 100 even if survived count is wrong", () => {
    const gate = evaluateCoveredMutationGate({
      mode: "incremental",
      survived: 0,
      mutationScoreCovered: 99.99,
    });
    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("expected failure");
    expect(gate.reason).toMatch(/99\.99/);
  });

  it("reads a Stryker JSON report from disk", () => {
    const files = {
      "a.ts": {
        mutants: [
          { status: "Killed" },
          { status: "Killed" },
          { status: "NoCoverage" },
          { status: "NoCoverage" },
        ],
      },
    };
    const fs = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ files }),
    };
    const gate = evaluateCoveredMutationGateFromReport("/tmp/mutation.json", fs);
    expect(gate.ok).toBe(true);
    expect(gate.summary?.mutationScoreCovered).toBe(100);
    expect(gate.summary?.mutationScore).toBe(50);
    expect(gate.summary?.noCoverage).toBe(2);
  });

  it("fails the file report when survivors exist despite high overall noise", () => {
    const files = {
      "a.ts": {
        mutants: [{ status: "Killed" }, { status: "Survived" }, { status: "NoCoverage" }],
      },
    };
    const fs = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ files }),
    };
    const gate = evaluateCoveredMutationGateFromReport("/tmp/mutation.json", fs);
    expect(gate.ok).toBe(false);
    expect(gate.summary?.mutationScoreCovered).toBe(50);
  });

  it("fails when the Stryker report file is missing", () => {
    const fs = {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error("should not read missing report");
      },
    };
    const gate = evaluateCoveredMutationGateFromReport("/tmp/missing-mutation.json", fs);
    expect(gate.ok).toBe(false);
    expect(gate.reason).toMatch(/missing Stryker report/);
  });

  it("summarizes an empty files object when the report omits files", () => {
    const fs = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({}),
    };
    const gate = evaluateCoveredMutationGateFromReport("/tmp/mutation.json", fs);
    expect(gate.ok).toBe(true);
    expect(gate.summary?.totalMutants).toBe(0);
    expect(gate.summary?.mutationScoreCovered).toBeNull();
  });
});
