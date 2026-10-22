import { describe, expect, it } from "vitest";
import {
  buildFirefoxUpdatesManifest,
  getFirefoxReleaseObjectPath,
  hasAmoCredentials,
} from "./firefox-release";

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
});
