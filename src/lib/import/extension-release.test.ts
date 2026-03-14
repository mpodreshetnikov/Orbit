import { describe, expect, it } from "vitest";
import {
  compareExtensionVersions,
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
});
