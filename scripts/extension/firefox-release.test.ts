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
    async function destination() {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "firefox-release-test-"));
      return path.join(dir, "releases", "0.1.26", "orbit-extension-0.1.26.xpi");
    }

    it("is downloaded with the token instead of signed again", async () => {
      const destinationPath = await destination();
      const fetchImpl = vi.fn(async (url: string | URL | Request) =>
        String(url).endsWith("/versions/v0.1.26/")
          ? Response.json({ file: { url: "https://amo.example/f.xpi", status: "public" } })
          : new Response("signed bytes"),
      ) as unknown as typeof fetch;

      await expect(
        downloadSignedFirefoxVersion({
          geckoId: "orbit@privateorbit.space",
          version: "0.1.26",
          destinationPath,
          env: AMO_ENV,
          fetchImpl,
        }),
      ).resolves.toBe(true);

      expect(await fs.readFile(destinationPath, "utf8")).toBe("signed bytes");
      const calls = vi.mocked(fetchImpl).mock.calls;
      expect(String(calls[0]![0])).toBe(
        "https://addons.mozilla.org/api/v5/addons/addon/orbit%40privateorbit.space/versions/v0.1.26/",
      );
      expect(String(calls[1]![0])).toBe("https://amo.example/f.xpi");
      for (const [, init] of calls) {
        expect((init?.headers as Record<string, string>).Authorization).toMatch(/^JWT /);
      }
    });

    it("is absent when AMO does not know it, so the build is signed", async () => {
      const fetchImpl = vi.fn(
        async () => new Response("", { status: 404 }),
      ) as unknown as typeof fetch;
      await expect(
        downloadSignedFirefoxVersion({
          geckoId: "orbit@privateorbit.space",
          version: "0.1.27",
          destinationPath: await destination(),
          env: AMO_ENV,
          fetchImpl,
        }),
      ).resolves.toBe(false);
    });

    it("fails the release while AMO has not signed it, or refuses the token", async () => {
      for (const answer of [
        Response.json({ file: { url: "https://amo.example/f.xpi", status: "unreviewed" } }),
        new Response("", { status: 401 }),
      ]) {
        const fetchImpl = vi.fn(async () => answer) as unknown as typeof fetch;
        await expect(
          downloadSignedFirefoxVersion({
            geckoId: "orbit@privateorbit.space",
            version: "0.1.26",
            destinationPath: await destination(),
            env: AMO_ENV,
            fetchImpl,
          }),
        ).rejects.toThrow();
      }
    });
  });
});
