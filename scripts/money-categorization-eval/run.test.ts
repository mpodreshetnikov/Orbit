import { describe, expect, it } from "vitest";
import { parseArgs, resolveMode } from "./run";

function args(...flags: string[]): string[] {
  return ["node", "run.ts", ...flags];
}

describe("parseArgs", () => {
  it("defaults to a single replayed run", () => {
    const parsed = parseArgs(args());
    expect(parsed.live).toBe(false);
    expect(resolveMode(parsed)).toBe("replay");
  });

  it("treats --record as implying --live", () => {
    expect(resolveMode(parseArgs(args("--record")))).toBe("record");
    expect(parseArgs(args("--record")).live).toBe(true);
  });

  it("accepts a case filter and model override", () => {
    const parsed = parseArgs(args("--case", "001", "--model", "google/gemini-2.0-flash-001"));
    expect(parsed.cases).toEqual(["001"]);
    expect(parsed.model).toBe("google/gemini-2.0-flash-001");
  });
});
