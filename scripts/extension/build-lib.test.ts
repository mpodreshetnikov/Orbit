import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEV_APP_ORIGINS,
  normalizeOrigin,
  originToPattern,
  parseArgs,
  parseDotEnv,
  resolveAppOrigins,
  shouldIgnoreWatchEvent,
  toCsvList,
} from "./build-lib";

describe("build-lib", () => {
  it("parses mode and watch args", () => {
    expect(parseArgs(["node", "build"])).toEqual({ mode: "development", watch: false });
    expect(parseArgs(["node", "build", "--mode=production", "--watch"])).toEqual({
      mode: "production",
      watch: true,
    });
  });

  it("normalizes origins and patterns", () => {
    expect(normalizeOrigin(" http://localhost:3000/ ")).toBe("http://localhost:3000");
    expect(originToPattern("https://example.com:443")).toBe("https://example.com/*");
  });

  it("parses csv env values", () => {
    expect(toCsvList(undefined)).toEqual([]);
    expect(toCsvList("a, b ,, c")).toEqual(["a", "b", "c"]);
  });

  it("resolves app origins from env and fallback", () => {
    expect(resolveAppOrigins({}, "development")).toEqual(DEFAULT_DEV_APP_ORIGINS);
    expect(
      resolveAppOrigins(
        {
          NEXT_PUBLIC_APP_ORIGIN: "https://one.example/,https://two.example/",
        },
        "production",
      ),
    ).toEqual(["https://one.example", "https://two.example"]);
  });

  it("fails on blank origin list", () => {
    expect(() =>
      resolveAppOrigins(
        {
          NEXT_PUBLIC_APP_ORIGIN: ", , ",
        },
        "development",
      ),
    ).toThrowError("NEXT_PUBLIC_APP_ORIGIN has no valid values");
  });

  it("loads dotenv format from file", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "build-lib-test-"));
    const envPath = path.join(tempDir, ".env.test");
    await fs.writeFile(
      envPath,
      [
        "# comment",
        "NEXT_PUBLIC_APP_ORIGIN=https://localhost:3000/",
        'QUOTED="value"',
        "EMPTY=",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(parseDotEnv(envPath)).resolves.toEqual({
      NEXT_PUBLIC_APP_ORIGIN: "https://localhost:3000/",
      QUOTED: "value",
      EMPTY: "",
    });
  });

  it("filters watch events for generated folders", () => {
    expect(shouldIgnoreWatchEvent(null)).toBe(true);
    expect(shouldIgnoreWatchEvent("dist/main.js")).toBe(true);
    expect(shouldIgnoreWatchEvent("src/index.ts")).toBe(true);
    expect(shouldIgnoreWatchEvent("popup-src/main.tsx")).toBe(false);
  });
});
