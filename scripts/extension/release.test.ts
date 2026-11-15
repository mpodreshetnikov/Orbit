import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildExtensionReleaseMetadata,
  buildSupabaseStoragePublicUrl,
  compareExtensionVersions,
  assertReleaseMayBePublished,
  EXTENSION_RELEASE_ARTIFACT_CACHE_SECONDS,
  EXTENSION_RELEASE_METADATA_CACHE_SECONDS,
  fetchPublishedExtensionVersionFromStorage,
  mayPublishOverPublished,
  EXTENSION_RELEASE_ARTIFACT_CONTENT_TYPE,
  EXTENSION_RELEASE_METADATA_CONTENT_TYPE,
  createZipArchive,
  deriveChromeExtensionIdFromKey,
  detectManifestVersionChange,
  evaluateExtensionVersionPolicy,
  fetchPublishedExtensionVersion,
  getExtensionReleaseArtifactName,
  readExtensionManifestVersion,
  shouldPublishRelease,
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
      manifestVersionChanged: false,
      previousVersion: "1.2.2",
      nextVersion: "1.2.2",
      publishedVersion: undefined,
      requiresVersionBump: true,
    });
  });

  describe("publish decision against the published release", () => {
    const unchangedManifests = {
      previousManifestContent: JSON.stringify({ version: "0.1.3", key: "test-key" }),
      nextManifestContent: JSON.stringify({ version: "0.1.3", key: "test-key" }),
    };

    it("publishes when nothing has been published yet, though the manifest did not change", () => {
      // The failure this fixes: 0.1.3 was bumped in one push and its publish
      // failed, so every later push that left the manifest alone reported
      // "nothing changed" and skipped -- forever.
      const result = evaluateExtensionVersionPolicy({
        changedFiles: ["docs/QUALITY.md"],
        ...unchangedManifests,
        published: { status: "absent" },
      });

      expect(result.versionChanged).toBe(true);
      expect(result.manifestVersionChanged).toBe(false);
      expect(result.publishedVersion).toBeNull();
    });

    it("does NOT publish when the published release is newer than this manifest", () => {
      // Runs for consecutive pushes to main are not serialised, so a docs-only
      // run carrying 0.1.3 can reach this check after a newer run published
      // 0.1.4. "Differs from what is published" is true there, and acting on it
      // would rebuild 0.1.3 and overwrite latest.json through the publish
      // step's upsert -- rolling production back.
      const result = evaluateExtensionVersionPolicy({
        changedFiles: ["docs/QUALITY.md"],
        ...unchangedManifests,
        published: { status: "published", version: "0.1.4" },
      });

      expect(result.versionChanged).toBe(false);
      expect(result.publishedVersion).toBe("0.1.4");
    });

    it("publishes when the published release is behind the manifest", () => {
      const result = evaluateExtensionVersionPolicy({
        changedFiles: ["docs/QUALITY.md"],
        ...unchangedManifests,
        published: { status: "published", version: "0.1.2" },
      });

      expect(result.versionChanged).toBe(true);
      expect(result.publishedVersion).toBe("0.1.2");
    });

    it("skips when the published release already matches the manifest", () => {
      const result = evaluateExtensionVersionPolicy({
        changedFiles: ["browserExtension/src/background.ts"],
        ...unchangedManifests,
        published: { status: "published", version: "0.1.3" },
      });

      expect(result.versionChanged).toBe(false);
      // The bump is still owed: a packaged surface changed with no new version,
      // and production being up to date does not excuse that.
      expect(result.requiresVersionBump).toBe(true);
    });

    it("falls back to the commit range when the lookup failed", () => {
      // A Storage outage must not turn into a publish on every push, so an
      // unknown answer leaves the previous behaviour in place.
      const unknown = { status: "unknown", reason: "network" } as const;

      expect(
        evaluateExtensionVersionPolicy({
          changedFiles: ["docs/QUALITY.md"],
          ...unchangedManifests,
          published: unknown,
        }),
      ).toMatchObject({ versionChanged: false, publishedVersion: undefined });

      expect(
        evaluateExtensionVersionPolicy({
          changedFiles: ["docs/QUALITY.md"],
          previousManifestContent: JSON.stringify({ version: "0.1.2" }),
          nextManifestContent: JSON.stringify({ version: "0.1.3" }),
          published: unknown,
        }),
      ).toMatchObject({ versionChanged: true });
    });

    it("does not let a lagging published version excuse a missing version bump", () => {
      const result = evaluateExtensionVersionPolicy({
        changedFiles: ["browserExtension/src/background.ts"],
        ...unchangedManifests,
        published: { status: "absent" },
      });

      expect(result.versionChanged).toBe(true);
      expect(result.requiresVersionBump).toBe(true);
    });
  });

  describe("reading the published version", () => {
    const supabaseUrl = "https://project.supabase.test";

    it("reads the version from the bucket's latest.json", async () => {
      const requested: string[] = [];
      const fetchImpl = (async (url: string | URL) => {
        requested.push(String(url));
        return new Response(JSON.stringify({ version: "0.1.3" }), { status: 200 });
      }) as unknown as typeof fetch;

      await expect(fetchPublishedExtensionVersion({ supabaseUrl, fetchImpl })).resolves.toEqual({
        status: "published",
        version: "0.1.3",
      });
      expect(requested).toEqual([
        "https://project.supabase.test/storage/v1/object/public/extension-releases/latest.json",
      ]);
    });

    it("reports absent for the answer Storage actually gives when nothing is published", async () => {
      // Recorded from the live project on 2026-09-01: Storage answers HTTP 400
      // and puts the real status in the body. Reading response.status alone
      // reports this as a failed lookup, which is how the missing release stayed
      // invisible.
      const fetchImpl = (async () =>
        new Response(
          JSON.stringify({
            statusCode: "404",
            error: "not_found",
            message: "Object not found",
            code: "NoSuchKey",
          }),
          { status: 400 },
        )) as unknown as typeof fetch;

      await expect(fetchPublishedExtensionVersion({ supabaseUrl, fetchImpl })).resolves.toEqual({
        status: "absent",
      });
    });

    it("reports absent when the bucket itself is not there yet", async () => {
      // A fresh project: deploy-supabase creates the bucket and runs before the
      // publish, so "no bucket" still means "nothing published".
      const fetchImpl = (async () =>
        new Response(
          JSON.stringify({
            statusCode: "404",
            error: "Bucket not found",
            message: "Bucket not found",
            code: "NoSuchBucket",
          }),
          { status: 400 },
        )) as unknown as typeof fetch;

      await expect(fetchPublishedExtensionVersion({ supabaseUrl, fetchImpl })).resolves.toEqual({
        status: "absent",
      });
    });

    it("still honours a plain 404, which a proxy in front of Storage may send", async () => {
      const fetchImpl = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;

      await expect(fetchPublishedExtensionVersion({ supabaseUrl, fetchImpl })).resolves.toEqual({
        status: "absent",
      });
    });

    it("reports unknown on a failed request, a bad status, and unusable metadata", async () => {
      const throwing = (async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch;
      await expect(
        fetchPublishedExtensionVersion({ supabaseUrl, fetchImpl: throwing }),
      ).resolves.toMatchObject({ status: "unknown" });

      const serverError = (async () =>
        new Response("", { status: 503 })) as unknown as typeof fetch;
      await expect(
        fetchPublishedExtensionVersion({ supabaseUrl, fetchImpl: serverError }),
      ).resolves.toMatchObject({ status: "unknown" });

      // An error body that is not a missing-object report stays unknown: a
      // permission failure must not read as "nothing published".
      const denied = (async () =>
        new Response(JSON.stringify({ statusCode: "403", error: "Unauthorized" }), {
          status: 400,
        })) as unknown as typeof fetch;
      await expect(
        fetchPublishedExtensionVersion({ supabaseUrl, fetchImpl: denied }),
      ).resolves.toMatchObject({ status: "unknown" });

      const notJson = (async () =>
        new Response("<html>proxy</html>", { status: 200 })) as unknown as typeof fetch;
      await expect(
        fetchPublishedExtensionVersion({ supabaseUrl, fetchImpl: notJson }),
      ).resolves.toMatchObject({ status: "unknown" });

      const noVersion = (async () =>
        new Response(JSON.stringify({ published_at: "now" }), {
          status: 200,
        })) as unknown as typeof fetch;
      await expect(
        fetchPublishedExtensionVersion({ supabaseUrl, fetchImpl: noVersion }),
      ).resolves.toMatchObject({ status: "unknown" });
    });

    it("reports unknown rather than guessing when no Supabase URL is configured", async () => {
      await expect(fetchPublishedExtensionVersion({ supabaseUrl: "  " })).resolves.toMatchObject({
        status: "unknown",
      });
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

  it("does not require a version bump for test files inside the surfaces", () => {
    // Tests live under the surfaces but are never packaged, so editing one
    // cannot change what users receive. Requiring a bump for them mints a
    // release — and triggers the release bundle job — for a test-only edit.
    for (const changed of [
      "browserExtension/src/connectors/tbank-web.test.ts",
      "browserExtension/src/core/background-router.test.ts",
      "browserExtension/popup-src/helpers.test.ts",
      "scripts/extension/release.test.ts",
      "browserExtension/src/__tests__/anything.ts",
    ]) {
      expect(
        shouldRequireExtensionVersionBump({ changedFiles: [changed], versionChanged: false }),
      ).toBe(false);
    }

    // A packaged file alongside a test still requires the bump.
    expect(
      shouldRequireExtensionVersionBump({
        changedFiles: [
          "browserExtension/src/connectors/tbank-web.test.ts",
          "browserExtension/src/connectors/tbank-web.ts",
        ],
        versionChanged: false,
      }),
    ).toBe(true);
  });

  it("does not require a version bump for the release tooling itself", () => {
    // release.ts zips and uploads browserExtension/dist; it cannot change what
    // goes into that bundle, so it is not a packaged surface. Governing it also
    // makes the version policy circular: changing the policy would need a bump.
    expect(
      shouldRequireExtensionVersionBump({
        changedFiles: ["scripts/extension/release.ts"],
        versionChanged: false,
      }),
    ).toBe(false);

    // The build scripts that do shape the bundle stay governed.
    for (const changed of [
      "scripts/extension/build.ts",
      "scripts/extension/build-lib.ts",
      "scripts/extension/esbuild-widget.ts",
    ]) {
      expect(
        shouldRequireExtensionVersionBump({ changedFiles: [changed], versionChanged: false }),
      ).toBe(true);
    }
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

describe("ordering the published release against the manifest", () => {
  it("compares versions numerically, component by component", () => {
    expect(compareExtensionVersions("0.1.3", "0.1.4")).toBe(-1);
    expect(compareExtensionVersions("0.1.4", "0.1.3")).toBe(1);
    expect(compareExtensionVersions("0.1.3", "0.1.3")).toBe(0);
    // Not lexicographic: "0.1.10" is after "0.1.9", though it sorts before it
    // as a string.
    expect(compareExtensionVersions("0.1.9", "0.1.10")).toBe(-1);
    // A missing component reads as zero, the way Chrome orders them.
    expect(compareExtensionVersions("1", "1.0.0")).toBe(0);
    expect(compareExtensionVersions("1.2", "1.2.1")).toBe(-1);
  });

  it("reports null for anything that is not a version", () => {
    for (const [left, right] of [
      ["1.0.0", "not-a-version"],
      ["", "1.0.0"],
      ["1.0.0-beta", "1.0.0"],
      ["1.2.3.4.5", "1.0.0"],
    ]) {
      expect(compareExtensionVersions(left, right)).toBeNull();
    }
  });

  it("rejects a published version that is padded rather than tidying it up", () => {
    // The published value is the untrusted side. Trimming it before validating
    // would accept " 65535 " as a version Chrome rejects, and order metadata
    // that should have taken the malformed fallback.
    expect(compareExtensionVersions(" 1.0.0 ", "1.0.0")).toBeNull();
    expect(compareExtensionVersions("1.0.0", "1.0 ")).toBeNull();
    expect(compareExtensionVersions(" 65535 ", "2.0.0")).toBeNull();
  });

  it("rejects all-numeric strings Chrome's grammar does not accept", () => {
    // A component above 65535, or one written with leading zeros, is not a
    // version Chrome would take. Ordering it anyway is worse than refusing:
    // published "65536" would read as newer than a 2.0.0 manifest and suppress
    // the publish, leaving the release stuck rather than falling back.
    expect(compareExtensionVersions("65536", "2.0.0")).toBeNull();
    expect(compareExtensionVersions("1.65536", "1.0")).toBeNull();
    expect(compareExtensionVersions("01.0", "1.0")).toBeNull();
    expect(compareExtensionVersions("1.00", "1.0")).toBeNull();
    // The boundary itself is legal.
    expect(compareExtensionVersions("65535", "65535")).toBe(0);
    expect(compareExtensionVersions("0.0.0.0", "0")).toBe(0);
  });

  it("falls back rather than suppressing the publish on metadata Chrome would reject", () => {
    expect(
      shouldPublishRelease({
        publishedVersion: "65536",
        manifestVersion: "2.0.0",
        manifestVersionChanged: true,
      }),
    ).toBe(true);
  });

  it("publishes only for an absent or older release", () => {
    const manifestVersion = "0.1.3";
    const publish = (publishedVersion: string | null | undefined, changed = false) =>
      shouldPublishRelease({ publishedVersion, manifestVersion, manifestVersionChanged: changed });

    expect(publish(null)).toBe(true);
    expect(publish("0.1.2")).toBe(true);
    expect(publish("0.1.3")).toBe(false);
    expect(publish("0.1.4")).toBe(false);
    expect(publish("0.2.0")).toBe(false);
    expect(publish("1.0.0")).toBe(false);
  });

  it("falls back to the commit range when there is no usable answer", () => {
    const fallback = (publishedVersion: string | null | undefined) => [
      shouldPublishRelease({
        publishedVersion,
        manifestVersion: "0.1.3",
        manifestVersionChanged: true,
      }),
      shouldPublishRelease({
        publishedVersion,
        manifestVersion: "0.1.3",
        manifestVersionChanged: false,
      }),
    ];

    // A failed lookup, and published metadata that is not a version: neither is
    // evidence, so neither may decide.
    expect(fallback(undefined)).toEqual([true, false]);
    expect(fallback("garbage")).toEqual([true, false]);
  });
});

describe("the content types the publish sends", () => {
  it("sends no parameters, because the bucket matches the whole header", () => {
    // storage.buckets.allowed_mime_types for extension-releases is the exact
    // list ["application/zip", "application/json"], and Storage compares the
    // header including its parameters. Sending "application/json; charset=utf-8"
    // was rejected with `mime type ... is not supported`, which published 0.1.3
    // as a zip with no latest.json pointing at it. The parameter carried
    // nothing: JSON is UTF-8 by definition.
    expect(EXTENSION_RELEASE_ARTIFACT_CONTENT_TYPE).toBe("application/zip");
    expect(EXTENSION_RELEASE_METADATA_CONTENT_TYPE).toBe("application/json");

    for (const contentType of [
      EXTENSION_RELEASE_ARTIFACT_CONTENT_TYPE,
      EXTENSION_RELEASE_METADATA_CONTENT_TYPE,
    ]) {
      expect(contentType).not.toContain(";");
      expect(contentType.trim()).toBe(contentType);
    }
  });
});

describe("re-reading production at upload time", () => {
  const releaseVersion = "0.1.3";
  const may = (published: Parameters<typeof mayPublishOverPublished>[0]["published"]) =>
    mayPublishOverPublished({ published, releaseVersion });

  it("stands down when a newer release is already published", () => {
    // The decision taken in quality-gates is a sample minutes old. If a 0.1.3 run
    // and a 0.1.4 run both read "published 0.1.2" before either uploaded, both
    // were told to go — so the older one has to be stopped here, at the upload.
    expect(may({ status: "published", version: "0.1.4" })).toBe(false);
    expect(may({ status: "published", version: "0.1.3" })).toBe(false);
  });

  it("proceeds when production is behind, or has nothing", () => {
    expect(may({ status: "published", version: "0.1.2" })).toBe(true);
    expect(may({ status: "absent" })).toBe(true);
  });

  it("fails closed on an answer it cannot use", () => {
    // Deciding whether to overwrite what is already published, there is no second
    // signal to fall back to. Allowing the write would disable the rollback guard
    // at exactly the moment it cannot be checked. A refused job can be re-run; an
    // overwritten release cannot.
    expect(may({ status: "unknown", reason: "network" })).toBe(false);
    expect(may({ status: "published", version: "not-a-version" })).toBe(false);
    expect(may(undefined)).toBe(false);
  });
});

describe("reading the published version authoritatively", () => {
  const clientWith = (input: {
    listing?: { data: { name: string }[] | null; error: unknown };
    download?: { data: Blob | null; error: unknown };
  }) => ({
    storage: {
      from: (bucket: string) => {
        if (bucket !== "extension-releases") throw new Error(`Unexpected bucket: ${bucket}`);
        return {
          list: () =>
            Promise.resolve(input.listing ?? { data: [{ name: "latest.json" }], error: null }),
          download: () => Promise.resolve(input.download ?? { data: null, error: { status: 500 } }),
        };
      },
    },
  });

  it("reads latest.json through the client rather than the public URL", async () => {
    // The public route is a CDN. A guard deciding whether to overwrite
    // production cannot read production through a cache.
    const asked: string[] = [];
    const client = {
      storage: {
        from: () => ({
          list: () => Promise.resolve({ data: [{ name: "latest.json" }], error: null }),
          download: (path: string) => {
            asked.push(path);
            return Promise.resolve({
              data: new Blob([JSON.stringify({ version: "0.1.4" })]),
              error: null,
            });
          },
        }),
      },
    };

    await expect(fetchPublishedExtensionVersionFromStorage(client)).resolves.toEqual({
      status: "published",
      version: "0.1.4",
    });
    expect(asked).toEqual(["latest.json"]);
  });

  it("reports absent from an empty listing, without inspecting any error", async () => {
    // This is the whole point of listing first. Storage reports "not there"
    // differently on every route, and an error object that JSON.stringify
    // renders as {} told nobody anything — it also failed closed and blocked
    // the first real publish. An empty array is not an error to classify.
    await expect(
      fetchPublishedExtensionVersionFromStorage(clientWith({ listing: { data: [], error: null } })),
    ).resolves.toEqual({ status: "absent" });

    await expect(
      fetchPublishedExtensionVersionFromStorage(
        clientWith({ listing: { data: [{ name: "something-else.json" }], error: null } }),
      ),
    ).resolves.toEqual({ status: "absent" });
  });

  it("fails closed when the listing itself fails", async () => {
    await expect(
      fetchPublishedExtensionVersionFromStorage(
        clientWith({ listing: { data: null, error: { status: 503, message: "down" } } }),
      ),
    ).resolves.toMatchObject({ status: "unknown" });
  });

  it("fails closed when the object is listed but cannot be read", async () => {
    // The listing said it is there, so a failed read is a failure rather than an
    // absence — whatever shape the error arrives in.
    await expect(
      fetchPublishedExtensionVersionFromStorage(
        clientWith({ download: { data: null, error: { status: 403, message: "Unauthorized" } } }),
      ),
    ).resolves.toMatchObject({ status: "unknown" });

    // An error with nothing JSON can see, which is what actually happened.
    await expect(
      fetchPublishedExtensionVersionFromStorage(
        clientWith({ download: { data: null, error: new Error("socket hang up") } }),
      ),
    ).resolves.toMatchObject({ status: "unknown" });
  });

  it("reports unknown for a body that is not usable metadata", async () => {
    await expect(
      fetchPublishedExtensionVersionFromStorage(
        clientWith({ download: { data: new Blob(["<html>proxy</html>"]), error: null } }),
      ),
    ).resolves.toMatchObject({ status: "unknown" });

    await expect(
      fetchPublishedExtensionVersionFromStorage(
        clientWith({
          download: { data: new Blob([JSON.stringify({ published_at: "now" })]), error: null },
        }),
      ),
    ).resolves.toMatchObject({ status: "unknown" });
  });

  it("says something useful about an error JSON cannot see", async () => {
    const result = await fetchPublishedExtensionVersionFromStorage(
      clientWith({ listing: { data: null, error: new Error("socket hang up") } }),
    );

    expect(result).toMatchObject({ status: "unknown" });
    // The first version printed "{}" here, which is how a blocked publish
    // reported nothing anyone could act on.
    if (result.status === "unknown") {
      expect(result.reason).toContain("socket hang up");
      expect(result.reason).not.toContain("{}");
    }
  });
});

describe("the publish-time gate", () => {
  const clientPublishing = (version: string | null) => ({
    storage: {
      from: () => ({
        list: () =>
          Promise.resolve({
            data: version === null ? [] : [{ name: "latest.json" }],
            error: null,
          }),
        download: () =>
          Promise.resolve({ data: new Blob([JSON.stringify({ version })]), error: null }),
      }),
    },
  });

  it("refuses to overwrite a release that is not older", async () => {
    await expect(
      assertReleaseMayBePublished({ client: clientPublishing("0.1.4"), releaseVersion: "0.1.3" }),
    ).rejects.toThrow(/Refusing to publish 0\.1\.3: 0\.1\.4 is already published/);

    await expect(
      assertReleaseMayBePublished({ client: clientPublishing("0.1.3"), releaseVersion: "0.1.3" }),
    ).rejects.toThrow(/already published/);
  });

  it("refuses, and says so, when production cannot be read", async () => {
    const failing = {
      storage: {
        from: () => ({
          list: () => Promise.resolve({ data: null, error: { status: 503, message: "down" } }),
          download: () => Promise.resolve({ data: null, error: { status: 503, message: "down" } }),
        }),
      },
    };

    await expect(
      assertReleaseMayBePublished({ client: failing, releaseVersion: "0.1.3" }),
    ).rejects.toThrow(/could not be read[\s\S]*Re-run this job/);
  });

  it("allows an older release to be replaced, and a first publish", async () => {
    await expect(
      assertReleaseMayBePublished({ client: clientPublishing("0.1.2"), releaseVersion: "0.1.3" }),
    ).resolves.toBeUndefined();

    await expect(
      assertReleaseMayBePublished({ client: clientPublishing(null), releaseVersion: "0.1.3" }),
    ).resolves.toBeUndefined();
  });

  it("reads through the client it is given, never a URL", async () => {
    // This is the point of the gate rather than an implementation detail: the
    // public route is a CDN, and a check that decides whether to overwrite
    // production must not read production through a cache.
    let downloads = 0;
    const client = {
      storage: {
        from: () => ({
          list: () => Promise.resolve({ data: [{ name: "latest.json" }], error: null }),
          download: () => {
            downloads += 1;
            return Promise.resolve({
              data: new Blob([JSON.stringify({ version: "0.1.2" })]),
              error: null,
            });
          },
        }),
      },
    };

    await assertReleaseMayBePublished({ client, releaseVersion: "0.1.3" });
    expect(downloads).toBe(1);
  });
});

describe("how long each object may be cached", () => {
  it("passes durations, because the upload API builds the header itself", () => {
    // @supabase/storage-js sets `cache-control: max-age=${cacheControl}`. A full
    // directive here produces `max-age=no-cache`, which no cache can parse —
    // worse than the default it was meant to replace. Both values must be bare
    // second counts.
    for (const value of [
      EXTENSION_RELEASE_METADATA_CACHE_SECONDS,
      EXTENSION_RELEASE_ARTIFACT_CACHE_SECONDS,
    ]) {
      expect(value).toMatch(/^\d+$/);
    }
  });

  it("keeps the pointer uncached and the archive cached for a year", () => {
    // Supabase defaults an upload to 3600. On latest.json that served an
    // hour-old pointer to every reader — the extension checking for an update
    // among them.
    expect(EXTENSION_RELEASE_METADATA_CACHE_SECONDS).toBe("0");
    // An archive is content-addressed by the version in its path, so it never
    // changes once written.
    expect(Number(EXTENSION_RELEASE_ARTIFACT_CACHE_SECONDS)).toBeGreaterThan(86400);
  });
});
