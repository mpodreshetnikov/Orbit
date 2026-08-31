import { describe, expect, it } from "vitest";
import { parseArgs, resolveMode } from "./run";

/** `parseArgs` reads from index 2, mirroring `process.argv`. */
function args(...flags: string[]): string[] {
  return ["node", "run.ts", ...flags];
}

describe("parseArgs", () => {
  it("defaults to a single replayed run", () => {
    const parsed = parseArgs(args());
    expect(parsed.repeat).toBe(1);
    expect(parsed.live).toBe(false);
    expect(resolveMode(parsed)).toBe("replay");
  });

  it("treats --record as implying --live", () => {
    expect(resolveMode(parseArgs(args("--record")))).toBe("record");
    expect(parseArgs(args("--record")).live).toBe(true);
  });

  it("accepts a repeat count alongside --live", () => {
    const parsed = parseArgs(args("--live", "--repeat", "3", "--case", "002"));
    expect(parsed.repeat).toBe(3);
    expect(parsed.cases).toEqual(["002"]);
  });

  it("refuses to repeat a replay run", () => {
    // N replays of one cassette return one answer N times. The table would show a spread of zero
    // and read as stability, which is the opposite of what the flag is for.
    expect(() => parseArgs(args("--repeat", "3"))).toThrow(/only means something with --live/);
  });

  it("refuses to repeat while recording", () => {
    expect(() => parseArgs(args("--record", "--repeat", "3"))).toThrow(/cannot be combined/);
  });

  it("rejects a repeat count that is not a whole run", () => {
    expect(() => parseArgs(args("--live", "--repeat", "0"))).toThrow(/whole number/);
    expect(() => parseArgs(args("--live", "--repeat", "2.5"))).toThrow(/whole number/);
    expect(() => parseArgs(args("--live", "--repeat", "many"))).toThrow(/whole number/);
  });
});
