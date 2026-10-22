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
  toFirefoxManifest,
  toFirefoxMatchPattern,
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

  describe("toFirefoxManifest", () => {
    const chromeManifest = {
      manifest_version: 3,
      name: "Orbit",
      version: "1.2.3",
      key: "MIIB...",
      permissions: ["storage"],
      host_permissions: [
        "http://localhost:3000/*",
        "http://localhost/*",
        "https://orbit.example/*",
      ],
      content_scripts: [{ matches: ["http://127.0.0.1:3000/*"], js: ["content-script.js"] }],
      background: { service_worker: "background.js", type: "module" },
    };

    it("drops the port Firefox's match patterns cannot carry", () => {
      expect(toFirefoxMatchPattern("http://localhost:3000/*")).toBe("http://localhost/*");
      expect(toFirefoxMatchPattern("https://*.tbank.ru/*")).toBe("https://*.tbank.ru/*");
      const manifest = toFirefoxManifest(chromeManifest, { geckoId: "orbit@example.com" });
      expect(manifest.host_permissions).toEqual(["http://localhost/*", "https://orbit.example/*"]);
      expect(manifest.content_scripts).toEqual([
        { matches: ["http://127.0.0.1/*"], js: ["content-script.js"] },
      ]);
    });

    it("runs the service worker as a background script and drops the Chrome key", () => {
      const manifest = toFirefoxManifest(chromeManifest, { geckoId: "orbit@example.com" });
      expect(manifest.key).toBeUndefined();
      expect(manifest.background).toEqual({ scripts: ["background.js"], type: "module" });
      expect(manifest.permissions).toEqual(["storage"]);
      expect(manifest.version).toBe("1.2.3");
      expect(manifest.browser_specific_settings).toEqual({
        gecko: {
          id: "orbit@example.com",
          strict_min_version: "128.0",
          data_collection_permissions: { required: ["financialAndPaymentInfo", "websiteContent"] },
        },
      });
    });

    it("leaves the Chrome self-updater's permission out", () => {
      const manifest = toFirefoxManifest(
        { ...chromeManifest, permissions: ["storage", "nativeMessaging"] },
        { geckoId: "orbit@example.com" },
      );
      expect(manifest.permissions).toEqual(["storage"]);
    });

    it("names the update URL only when there is one", () => {
      const manifest = toFirefoxManifest(chromeManifest, {
        geckoId: "orbit@example.com",
        updateUrl: "https://orbit.example/updates.json",
      });
      expect(
        (manifest.browser_specific_settings as { gecko: Record<string, unknown> }).gecko.update_url,
      ).toBe("https://orbit.example/updates.json");
    });

    it("refuses a manifest with no service worker", () => {
      expect(() =>
        toFirefoxManifest({ ...chromeManifest, background: {} }, { geckoId: "x@y" }),
      ).toThrow(/service_worker/);
    });
  });
});
