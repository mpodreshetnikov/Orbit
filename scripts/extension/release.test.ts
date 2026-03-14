import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExtensionReleaseMetadata,
  buildSupabaseStoragePublicUrl,
  createZipArchive,
  deriveChromeExtensionIdFromKey,
  detectManifestVersionChange,
  evaluateExtensionVersionPolicy,
  getExtensionReleaseArtifactName,
  readExtensionManifestVersion,
  shouldRequireExtensionVersionBump,
} from "./release";

describe("extension release", () => {
  it("reads manifest version from the manifest file", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "extension-release-test-"));
    const manifestPath = path.join(tempDir, "manifest.json");
    await fs.writeFile(
      manifestPath,
      JSON.stringify({ version: "1.2.3", key: "test-key" }, null, 2),
      "utf8",
    );

    await expect(readExtensionManifestVersion(manifestPath)).resolves.toBe("1.2.3");
  });

  it("builds deterministic artifact names and release metadata", () => {
    expect(getExtensionReleaseArtifactName("1.2.3")).toBe("orbit-extension-1.2.3.zip");
    expect(
      deriveChromeExtensionIdFromKey(
        "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz84ynCFIwpvsQIcklAzf+8sVWXeZZocN8LTt6iEmtA8ZwHV0klI115PyOy4LlaEFEIp7YpwrfT5MaU+m9rbuCnhmOsK46omDGqM2eUnP4v3YGU3pMmyGcXvU6FGAIlelUlzkqKl5OzCnLdZKpJnVZSG2dcfCRINyp9MMI3209vgrqeqpmnCEMbr8JpMZ/+aAQLlMfOIIyYMcdP9Kr2DKbAZrm41lepCJOYdSGfy+HpO9Q1UB+XhSOq386hyhkK5LC3cfTGjlNApTHr3fzrMS/s04R/ACAR1BElRu8e32J2nOOtGm0LVW0XD9o53p1bok6nMtLawS4FUmWOPU7MdgrwIDAQAB",
      ),
    ).toBe("nodfdadmgohfcnbgkfcmhhidboffkdac");

    expect(
      buildExtensionReleaseMetadata({
        version: "1.2.3",
        publishedAt: "2026-03-14T12:00:00.000Z",
        extensionId: "abc123",
        sha256: "deadbeef",
        downloadUrl: "https://cdn.example.test/releases/1.2.3/orbit-extension-1.2.3.zip",
      }),
    ).toEqual({
      version: "1.2.3",
      published_at: "2026-03-14T12:00:00.000Z",
      extension_id: "abc123",
      sha256: "deadbeef",
      download_url: "https://cdn.example.test/releases/1.2.3/orbit-extension-1.2.3.zip",
    });
  });

  it("detects manifest version changes across file contents", () => {
    expect(
      detectManifestVersionChange(
        JSON.stringify({ version: "1.2.2" }),
        JSON.stringify({ version: "1.2.3" }),
      ),
    ).toEqual({
      changed: true,
      previousVersion: "1.2.2",
      nextVersion: "1.2.3",
    });
  });

  it("evaluates extension version policy from changed files and manifest contents", () => {
    expect(
      evaluateExtensionVersionPolicy({
        changedFiles: ["browserExtension/src/content-script.ts", "docs/QUALITY.md"],
        previousManifestContent: JSON.stringify({ version: "1.2.2", key: "test-key" }),
        nextManifestContent: JSON.stringify({ version: "1.2.2", key: "test-key" }),
      }),
    ).toEqual({
      changedFiles: ["browserExtension/src/content-script.ts", "docs/QUALITY.md"],
      versionChanged: false,
      previousVersion: "1.2.2",
      nextVersion: "1.2.2",
      requiresVersionBump: true,
    });
  });

  it("requires a manifest version bump when packaged extension surfaces change", () => {
    expect(
      shouldRequireExtensionVersionBump({
        changedFiles: ["browserExtension/src/background.ts"],
        versionChanged: false,
      }),
    ).toBe(true);
    expect(
      shouldRequireExtensionVersionBump({
        changedFiles: ["docs/design/domains/money/import-framework-file-and-extension.md"],
        versionChanged: false,
      }),
    ).toBe(false);
    expect(
      shouldRequireExtensionVersionBump({
        changedFiles: ["scripts/extension/build.ts"],
        versionChanged: true,
      }),
    ).toBe(false);
  });

  it("builds public download URLs and zip archives for release artifacts", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "extension-release-archive-test-"));
    const sourceDir = path.join(tempDir, "source");
    const archivePath = path.join(tempDir, "release.zip");

    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, "manifest.json"), '{"version":"1.2.3"}', "utf8");
    await fs.writeFile(path.join(sourceDir, "background.js"), "console.log('ok');", "utf8");

    await createZipArchive(sourceDir, archivePath);

    const archiveContent = await fs.readFile(archivePath);
    expect(archiveContent.subarray(0, 2).toString("utf8")).toBe("PK");
    expect(
      buildSupabaseStoragePublicUrl({
        supabaseUrl: "https://project.supabase.co/",
        objectPath: "releases/1.2.3/orbit extension.zip",
      }),
    ).toBe(
      "https://project.supabase.co/storage/v1/object/public/extension-releases/releases/1.2.3/orbit%20extension.zip",
    );
  }, 15_000);
});
