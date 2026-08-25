import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { IOS_APP_NAME, IOS_BUNDLE_ID } from "./capacitor-config.ts";

// `npx cap add ios` regenerates ios/ from a Capacitor template, so anything hand-edited inside it
// is lost on a regenerate unless it is reapplied. These tests are the list of what has to be
// reapplied, and they fail on a Linux CI runner that has never seen Xcode.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readProjectFile(relativePath: string): string {
  return readFileSync(join(repoRoot, "ios", relativePath), "utf8");
}

/** Collapses the whitespace between XML tags so an assertion is not an indentation test. */
function compactXml(source: string): string {
  return source.replace(/>\s+</g, "><");
}

describe("generated Xcode project", () => {
  it("builds under the bundle identifier registered with the Apple team", () => {
    const project = readProjectFile("App/App.xcodeproj/project.pbxproj");
    const identifiers = [...project.matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map(
      (match) => match[1].trim(),
    );

    // Debug and Release both, so a device build and a TestFlight archive cannot diverge.
    expect(identifiers.length).toBeGreaterThanOrEqual(2);
    expect(new Set(identifiers)).toEqual(new Set([IOS_BUNDLE_ID]));
  });

  it("shows the product name under the icon", () => {
    const infoPlist = compactXml(readProjectFile("App/App/Info.plist"));

    expect(infoPlist).toContain(`<key>CFBundleDisplayName</key><string>${IOS_APP_NAME}</string>`);
  });

  it("keeps the App Transport Security exception the LAN override depends on", () => {
    // `server.cleartext` is an Android setting. On iOS it is ATS that refuses plaintext http, so
    // without this exception ORBIT_IOS_SERVER_URL pointed at a dev server on the LAN produces a
    // blank web view and no useful error. NSAllowsLocalNetworking permits it for local addresses
    // only, leaving ATS enforced for everything on the public internet.
    const infoPlist = compactXml(readProjectFile("App/App/Info.plist"));

    expect(infoPlist).toContain(
      "<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>",
    );
    expect(infoPlist).not.toContain("<key>NSAllowsArbitraryLoads</key><true/>");
    expect(infoPlist).toMatch(/<key>NSLocalNetworkUsageDescription<\/key><string>.+?<\/string>/);
  });
});
