import { describe, expect, it } from "vitest";
import {
  compareExtensionVersions,
  detectExtensionBrowser,
  extensionReleaseForBrowser,
  serializeExtensionRelease,
  isExtensionOutdated,
  normalizeExtensionRelease,
} from "./extension-release";

describe("extension release helpers", () => {
  it("compares semver-like extension versions", () => {
    expect(compareExtensionVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareExtensionVersions("1.2.3", "1.2.4")).toBeLessThan(0);
    expect(compareExtensionVersions("1.3.0", "1.2.9")).toBeGreaterThan(0);
  });

  it("detects when an installed extension is outdated", () => {
    expect(isExtensionOutdated("1.2.3", "1.2.4")).toBe(true);
    expect(isExtensionOutdated("1.2.4", "1.2.4")).toBe(false);
    expect(isExtensionOutdated(null, "1.2.4")).toBe(false);
  });

  it("normalizes release payloads returned by the latest-release api", () => {
    expect(
      normalizeExtensionRelease({
        version: "1.2.4",
        published_at: "2026-03-14T12:00:00.000Z",
        extension_id: "abc123",
        sha256: "deadbeef",
        download_url: "https://cdn.example.test/releases/1.2.4/orbit-extension-1.2.4.zip",
      }),
    ).toEqual({
      version: "1.2.4",
      publishedAt: "2026-03-14T12:00:00.000Z",
      extensionId: "abc123",
      sha256: "deadbeef",
      downloadUrl: "https://cdn.example.test/releases/1.2.4/orbit-extension-1.2.4.zip",
    });
  });

  const payload = {
    version: "1.2.4",
    published_at: "2026-03-14T12:00:00.000Z",
    extension_id: "abc123",
    sha256: "deadbeef",
    download_url: "https://cdn.example.test/releases/1.2.4/orbit-extension-1.2.4.zip",
    firefox: {
      version: "1.2.4",
      extension_id: "orbit@privateorbit.space",
      sha256: "cafe",
      download_url: "https://cdn.example.test/releases/1.2.4/orbit-extension-1.2.4.xpi",
    },
  };

  it("carries the signed Firefox add-on through normalize and serialize", () => {
    const release = normalizeExtensionRelease(payload);
    expect(release?.firefox).toEqual({
      version: "1.2.4",
      extensionId: "orbit@privateorbit.space",
      sha256: "cafe",
      downloadUrl: "https://cdn.example.test/releases/1.2.4/orbit-extension-1.2.4.xpi",
    });
    expect(serializeExtensionRelease(release!)).toEqual(payload);
  });

  it("keeps the Chrome release when the Firefox block is malformed", () => {
    const release = normalizeExtensionRelease({ ...payload, firefox: { version: "1.2.4" } });
    expect(release?.downloadUrl).toBe(payload.download_url);
    expect(release?.firefox).toBeUndefined();
  });

  it("offers each browser its own build", () => {
    const firefoxUa =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:158.0) Gecko/20100101 Firefox/158.0";
    const chromeUa =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
    expect(detectExtensionBrowser(firefoxUa)).toBe("firefox");
    expect(detectExtensionBrowser(chromeUa)).toBe("chrome");

    const release = normalizeExtensionRelease(payload);
    expect(extensionReleaseForBrowser(release, "firefox")?.downloadUrl).toMatch(/\.xpi$/);
    expect(extensionReleaseForBrowser(release, "chrome")?.downloadUrl).toMatch(/\.zip$/);
    const chromeOnly = normalizeExtensionRelease({ ...payload, firefox: undefined });
    expect(extensionReleaseForBrowser(chromeOnly, "firefox")).toBeNull();
    expect(extensionReleaseForBrowser(null, "chrome")).toBeNull();
  });
});
