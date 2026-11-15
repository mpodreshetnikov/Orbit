import { describe, expect, it } from "vitest";
import { DEFAULT_EVAL_MODEL } from "./pipeline";
import { parseArgs, resolveMode } from "./run";

function args(...flags: string[]): string[] {
  return ["node", "run.ts", ...flags];
}

describe("parseArgs", () => {
  it("defaults to a single replayed run", () => {
    const parsed = parseArgs(args());
    expect(parsed.live).toBe(false);
    expect(parsed.record).toBe(false);
    expect(parsed.cases).toEqual([]);
    expect(parsed.model).toBe(DEFAULT_EVAL_MODEL);
    expect(parsed.failUnder).toBeNull();
    expect(resolveMode(parsed)).toBe("replay");
  });

  it("honours an explicit --live without --record", () => {
    const parsed = parseArgs(args("--live"));
    expect(parsed.live).toBe(true);
    expect(parsed.record).toBe(false);
    expect(resolveMode(parsed)).toBe("live");
  });

  it("treats --record as implying --live", () => {
    expect(resolveMode(parseArgs(args("--record")))).toBe("record");
    expect(parseArgs(args("--record")).live).toBe(true);
  });

  it("accepts a case filter and model override in either order", () => {
    const a = parseArgs(args("--case", "001", "--model", "google/gemini-2.0-flash-001"));
    expect(a.cases).toEqual(["001"]);
    expect(a.model).toBe("google/gemini-2.0-flash-001");

    const b = parseArgs(args("--model", "openai/gpt-5.2", "--case", "010"));
    expect(b.cases).toEqual(["010"]);
    expect(b.model).toBe("openai/gpt-5.2");
  });

  it("accepts multiple --case filters and numeric --fail-under", () => {
    const parsed = parseArgs(args("--case", "001", "--case", "009", "--fail-under", "0.75"));
    expect(parsed.cases).toEqual(["001", "009"]);
    expect(parsed.failUnder).toBe(0.75);
  });

  it("resolves --out to an absolute path", () => {
    const parsed = parseArgs(args("--out", "tmp-out"));
    expect(parsed.outDir.endsWith("tmp-out")).toBe(true);
    expect(parsed.outDir.startsWith("/")).toBe(true);
  });

  it("ignores a trailing flag that is missing its value", () => {
    expect(parseArgs(args("--case")).cases).toEqual([]);
    expect(parseArgs(args("--model")).model).toBe(DEFAULT_EVAL_MODEL);
    expect(parseArgs(args("--fail-under")).failUnder).toBeNull();
    expect(parseArgs(args("--out")).outDir).toContain("money-categorization-eval");
  });

  it("skips unknown flags without changing defaults", () => {
    const parsed = parseArgs(args("--unknown", "value", "--live"));
    expect(parsed.live).toBe(true);
    expect(parsed.cases).toEqual([]);
    expect(parsed.model).toBe(DEFAULT_EVAL_MODEL);
    expect(parsed.failUnder).toBeNull();
    expect(parsed.outDir).toContain("money-categorization-eval");
    expect(parsed.outDir.endsWith("value")).toBe(false);
  });
});

describe("resolveMode", () => {
  it("prefers record over live", () => {
    expect(resolveMode({ live: true, record: true })).toBe("record");
    expect(resolveMode({ live: false, record: true })).toBe("record");
    expect(resolveMode({ live: true, record: false })).toBe("live");
    expect(resolveMode({ live: false, record: false })).toBe("replay");
  });
});
