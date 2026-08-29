import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import rootConfig from "../../capacitor.config.ts";
import {
  buildCapacitorConfig,
  iosBundleIdentifiers,
  resolveIosServerUrl,
  IOS_BUNDLE_ID,
  IOS_PRODUCTION_SERVER_URL,
  IOS_SERVER_URL_ENV,
  IOS_WEB_DIR,
} from "./capacitor-config.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("buildCapacitorConfig", () => {
  it("points a production build at the deployed origin over TLS", () => {
    const config = buildCapacitorConfig({});

    expect(config.appId).toBe("com.podreshetnikov.orbit");
    expect(config.appName).toBe("Orbit");
    expect(config.server?.url).toBe("https://private-orbit.vercel.app");
    expect(config.server?.cleartext).toBe(false);
  });

  it("falls back to the bundled page when the origin cannot be reached", () => {
    const config = buildCapacitorConfig({});

    expect(config.webDir).toBe(IOS_WEB_DIR);
    expect(config.server?.errorPath).toBe("index.html");
  });

  it("ships the index.html `cap sync` refuses to run without", () => {
    // Capacitor rejects a web assets directory with no index.html, and the failure only shows up on
    // the Mac at sync time. Asserting the file exists catches a moved or renamed webDir here.
    expect(existsSync(join(repoRoot, IOS_WEB_DIR, "index.html"))).toBe(true);
  });

  it("allows cleartext only for the LAN override used against a local dev server", () => {
    const config = buildCapacitorConfig({ [IOS_SERVER_URL_ENV]: "http://192.168.1.42:3000" });

    expect(config.server?.url).toBe("http://192.168.1.42:3000");
    expect(config.server?.cleartext).toBe(true);
  });

  it("keeps cleartext off when the override is itself https", () => {
    const config = buildCapacitorConfig({ [IOS_SERVER_URL_ENV]: "https://preview.example" });

    expect(config.server?.url).toBe("https://preview.example");
    expect(config.server?.cleartext).toBe(false);
  });
});

describe("resolveIosServerUrl", () => {
  it("uses the production origin when the override is unset or blank", () => {
    expect(resolveIosServerUrl({})).toBe(IOS_PRODUCTION_SERVER_URL);
    expect(resolveIosServerUrl({ [IOS_SERVER_URL_ENV]: "   " })).toBe(IOS_PRODUCTION_SERVER_URL);
  });

  it("normalizes an override down to its origin", () => {
    expect(resolveIosServerUrl({ [IOS_SERVER_URL_ENV]: "https://preview.example/" })).toBe(
      "https://preview.example",
    );
  });

  it("accepts loopback and every private IPv4 range over http", () => {
    for (const host of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://10.0.0.4:3000",
      "http://172.16.0.9:3000",
      "http://172.31.255.254:3000",
      "http://192.168.1.42:3000",
      "http://mac-mini.local:3000",
    ]) {
      expect(resolveIosServerUrl({ [IOS_SERVER_URL_ENV]: host })).toBe(host);
    }
  });

  it("refuses plaintext http against a public host", () => {
    // The mistake this exists to stop: shipping a signed build whose every request is readable on
    // the wire because someone tested over http and forgot to switch the scheme back.
    expect(() => resolveIosServerUrl({ [IOS_SERVER_URL_ENV]: "http://private-orbit.vercel.app" }))
      .toThrowError(/plaintext http/);
    expect(() => resolveIosServerUrl({ [IOS_SERVER_URL_ENV]: "http://172.32.0.1:3000" })).toThrow();
  });

  it("refuses an override carrying a path, query or fragment", () => {
    // Capacitor drops everything after the origin, so accepting these would load a different page
    // than the one that was configured, with nothing to say so.
    for (const value of [
      "https://preview.example/health",
      "https://preview.example/?locale=ru",
      "https://preview.example/#/health",
    ]) {
      expect(() => resolveIosServerUrl({ [IOS_SERVER_URL_ENV]: value })).toThrowError(
        /bare origin/,
      );
    }
  });

  it("refuses a scheme the web view cannot load", () => {
    expect(() => resolveIosServerUrl({ [IOS_SERVER_URL_ENV]: "capacitor://localhost" })).toThrow(
      /http or https/,
    );
  });

  it("names the environment variable when the override is not a URL", () => {
    expect(() => resolveIosServerUrl({ [IOS_SERVER_URL_ENV]: "private-orbit.vercel.app" })).toThrow(
      new RegExp(IOS_SERVER_URL_ENV),
    );
  });
});

describe("iosBundleIdentifiers", () => {
  it("derives the App Group, keychain group and APNs topic from the bundle id", () => {
    expect(iosBundleIdentifiers()).toEqual({
      bundleId: "com.podreshetnikov.orbit",
      appGroupId: "group.com.podreshetnikov.orbit",
      keychainAccessGroup: "com.podreshetnikov.orbit.shared",
      liveActivityApnsTopic: "com.podreshetnikov.orbit.push-type.liveactivity",
    });
  });

  it("keeps the APNs topic tied to the identifier every push token was issued against", () => {
    // Spelled out rather than derived, so that changing IOS_BUNDLE_ID fails here instead of on a
    // phone that quietly stops receiving Live Activity pushes.
    expect(IOS_BUNDLE_ID).toBe("com.podreshetnikov.orbit");
    expect(iosBundleIdentifiers("com.example.other").liveActivityApnsTopic).toBe(
      "com.example.other.push-type.liveactivity",
    );
  });
});

describe("capacitor.config.ts", () => {
  it("delegates to the tested builder rather than restating the configuration", () => {
    expect(rootConfig).toEqual(buildCapacitorConfig({}));
  });
});
