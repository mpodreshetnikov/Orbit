import { describe, expect, it } from "vitest";
import { describeModels, parseArgs, resolveMode } from "./run";

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

  it("leaves every stage unpinned by default", () => {
    // An empty map, not three copies of `model`: the stages resolve their own fallback, and
    // pinning them here would hide a stage that stopped reading it.
    expect(parseArgs(args("--model", "openai/gpt-5.2")).stageModels).toEqual({});
  });

  it("reads a model per stage", () => {
    const parsed = parseArgs(
      args(
        "--live",
        "--model",
        "openai/gpt-5.2",
        "--model-classify",
        "google/gemini-2.5-flash",
        "--model-extract",
        "google/gemini-2.5-flash",
        "--model-reconcile",
        "openai/gpt-5.2",
      ),
    );
    expect(parsed.model).toBe("openai/gpt-5.2");
    expect(parsed.stageModels).toEqual({
      classify: "google/gemini-2.5-flash",
      extract: "google/gemini-2.5-flash",
      reconcile: "openai/gpt-5.2",
    });
  });

  it("falls back to --model for the stages left unpinned", () => {
    const parsed = parseArgs(
      args("--live", "--model", "openai/gpt-5.2", "--model-extract", "google/gemini-2.5-flash"),
    );
    expect(parsed.model).toBe("openai/gpt-5.2");
    expect(parsed.stageModels).toEqual({ extract: "google/gemini-2.5-flash" });
  });

  it("refuses a stage flag with no value after it", () => {
    expect(() => parseArgs(args("--live", "--model-extract"))).toThrow(/needs a model id/);
  });

  it("refuses to take the next option as a model id", () => {
    // The failure this prevents is expensive, not cosmetic: taking `--case` as the model would
    // also swallow the token, so the case filter vanishes and a live run pays for the whole
    // corpus against a model id that cannot exist.
    expect(() => parseArgs(args("--live", "--model-extract", "--case", "002"))).toThrow(
      /needs a model id/,
    );
    expect(() => parseArgs(args("--live", "--model-classify", "--live"))).toThrow(
      /needs a model id/,
    );
  });
});

describe("describeModels", () => {
  it("names the model alone when no stage is pinned", () => {
    expect(describeModels("openai/gpt-5.2", {})).toBe("openai/gpt-5.2");
  });

  it("names every pinned stage, so the report cannot claim a run it did not make", () => {
    expect(
      describeModels("openai/gpt-5.2", {
        classify: "google/gemini-2.5-flash",
        extract: "google/gemini-2.5-flash",
      }),
    ).toBe("openai/gpt-5.2 (classify: google/gemini-2.5-flash, extract: google/gemini-2.5-flash)");
  });
});
