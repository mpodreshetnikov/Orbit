import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildFirefoxUpdatesManifest,
  createAmoJwt,
  downloadSignedFirefoxVersion,
  getFirefoxReleaseObjectPath,
  hasAmoCredentials,
} from "./firefox-release";

const AMO_ENV = { WEB_EXT_API_KEY: "user:1:2", WEB_EXT_API_SECRET: "secret" };

describe("firefox release", () => {
  it("puts the signed add-on next to the Chrome archive of the same version", () => {
    expect(getFirefoxReleaseObjectPath("0.1.24")).toBe(
      "releases/0.1.24/orbit-extension-0.1.24.xpi",
    );
  });

  it("writes the update manifest Firefox polls, keyed by the add-on id", () => {
    expect(
      buildFirefoxUpdatesManifest({
        version: "0.1.24",
        extension_id: "orbit@privateorbit.space",
        sha256: "abc",
        download_url: "https://orbit.example/x.xpi",
      }),
    ).toEqual({
      addons: {
        "orbit@privateorbit.space": {
          updates: [
            {
              version: "0.1.24",
              update_link: "https://orbit.example/x.xpi",
              update_hash: "sha256:abc",
            },
          ],
        },
      },
    });
  });

  it("signs only with both AMO credentials", () => {
    expect(hasAmoCredentials({ WEB_EXT_API_KEY: "user:1", WEB_EXT_API_SECRET: "s" })).toBe(true);
    expect(hasAmoCredentials({ WEB_EXT_API_KEY: "user:1", WEB_EXT_API_SECRET: " " })).toBe(false);
    expect(hasAmoCredentials({})).toBe(false);
  });

  it("signs the AMO token with the secret, for a minute", () => {
    const [header, payload, signature] = createAmoJwt(AMO_ENV, 1000).split(".");
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toMatchObject({
      iss: "user:1:2",
      iat: 1000,
      exp: 1060,
    });
    expect(signature).toBe(
      crypto.createHmac("sha256", "secret").update(`${header}.${payload}`).digest("base64url"),
    );
  });

  describe("a version AMO already signed", () => {
    /** A build, its signed add-on as AMO would serve it, and where the release puts the file. */
    async function fixture(changeSigned?: (unpacked: string) => Promise<void>) {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "firefox-release-test-"));
      const sourceDir = path.join(dir, "dist-firefox");
      await fs.mkdir(path.join(sourceDir, "src"), { recursive: true });
      await fs.writeFile(path.join(sourceDir, "manifest.json"), '{"version":"0.1.26"}');
      await fs.writeFile(path.join(sourceDir, "src", "env.js"), "export const ORIGIN = 'a';");
      await fs.writeFile(path.join(sourceDir, "reload-trigger.json"), '{"buildId":"11:20"}');

      const unpacked = path.join(dir, "signed");
      await fs.cp(sourceDir, unpacked, { recursive: true });
      await fs.mkdir(path.join(unpacked, "META-INF"));
      await fs.writeFile(path.join(unpacked, "META-INF", "mozilla.rsa"), "signature");
      await changeSigned?.(unpacked);
      const xpi = path.join(dir, "signed.xpi");
      execFileSync("zip", ["-rq", xpi, "."], { cwd: unpacked });
      const bytes = await fs.readFile(xpi);

      const fetchImpl = vi.fn(async (url: string | URL | Request) =>
        String(url).endsWith("/versions/v0.1.26/")
          ? Response.json({
              file: {
                url: "https://amo.example/f.xpi",
                status: "public",
                hash: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
              },
            })
          : new Response(bytes),
      ) as unknown as typeof fetch;
      return {
        bytes,
        fetchImpl,
        input: {
          geckoId: "orbit@privateorbit.space",
          version: "0.1.26",
          sourceDir,
          destinationPath: path.join(dir, "out", "orbit-extension-0.1.26.xpi"),
          env: AMO_ENV,
          fetchImpl,
        },
      };
    }

    it("is downloaded with the token instead of signed again when it is this build", async () => {
      const { bytes, fetchImpl, input } = await fixture();

      await expect(downloadSignedFirefoxVersion(input)).resolves.toBe(true);

      expect((await fs.readFile(input.destinationPath)).equals(bytes)).toBe(true);
      const calls = vi.mocked(fetchImpl).mock.calls;
      expect(String(calls[0]![0])).toBe(
        "https://addons.mozilla.org/api/v5/addons/addon/orbit%40privateorbit.space/versions/v0.1.26/",
      );
      expect(String(calls[1]![0])).toBe("https://amo.example/f.xpi");
      for (const [, init] of calls) {
        expect((init?.headers as Record<string, string>).Authorization).toMatch(/^JWT /);
      }
    });

    it("is this build when only the build stamp and the manifest's layout differ", async () => {
      const { input } = await fixture(async (unpacked) => {
        await fs.writeFile(path.join(unpacked, "reload-trigger.json"), '{"buildId":"11:26"}');
        await fs.writeFile(path.join(unpacked, "manifest.json"), '{\n  "version": "0.1.26"\n}\n');
      });
      await expect(downloadSignedFirefoxVersion(input)).resolves.toBe(true);
    });

    it("names the manifest keys that differ", async () => {
      const { input } = await fixture((unpacked) =>
        fs.writeFile(
          path.join(unpacked, "manifest.json"),
          '{"version":"0.1.26","permissions":["tabs"]}',
        ),
      );
      await expect(downloadSignedFirefoxVersion(input)).rejects.toThrow(
        /manifest\.json differs in permissions/,
      );
    });

    it("is absent when AMO does not know it, so the build is signed", async () => {
      const { input } = await fixture();
      const fetchImpl = vi.fn(
        async () => new Response("", { status: 404 }),
      ) as unknown as typeof fetch;
      await expect(downloadSignedFirefoxVersion({ ...input, fetchImpl })).resolves.toBe(false);
    });

    it("fails the release when it is another build, and keeps nothing", async () => {
      for (const change of [
        (unpacked: string) => fs.writeFile(path.join(unpacked, "src", "env.js"), "other server"),
        (unpacked: string) => fs.writeFile(path.join(unpacked, "extra.js"), "planted"),
        (unpacked: string) => fs.rm(path.join(unpacked, "src", "env.js")),
      ]) {
        const { input } = await fixture(change);
        await expect(downloadSignedFirefoxVersion(input)).rejects.toThrow(/not this build/);
        await expect(fs.access(input.destinationPath)).rejects.toThrow();
      }
    });

    it("fails the release on a file that does not match AMO's hash", async () => {
      const { input } = await fixture();
      const fetchImpl = vi.fn(async (url: string | URL | Request) =>
        String(url).endsWith("/versions/v0.1.26/")
          ? Response.json({
              file: { url: "https://amo.example/f.xpi", status: "public", hash: "sha256:00" },
            })
          : new Response("truncated"),
      ) as unknown as typeof fetch;
      await expect(downloadSignedFirefoxVersion({ ...input, fetchImpl })).rejects.toThrow(
        /does not match its hash/,
      );
    });

    it("fails the release while AMO has not signed it, or refuses the token", async () => {
      const { input } = await fixture();
      for (const answer of [
        Response.json({ file: { url: "https://amo.example/f.xpi", status: "unreviewed" } }),
        new Response("", { status: 401 }),
      ]) {
        const fetchImpl = vi.fn(async () => answer) as unknown as typeof fetch;
        await expect(downloadSignedFirefoxVersion({ ...input, fetchImpl })).rejects.toThrow();
      }
    });
  });
});
