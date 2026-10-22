import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * The Firefox half of an extension release. Release Firefox installs an add-on for good only when
 * Mozilla has signed it, so the Firefox build is signed on addons.mozilla.org as an unlisted
 * add-on (never shown in the catalogue) and published next to the Chrome archive. The signed
 * manifest names `firefox/updates.json` on the same Storage as its `update_url`, and Firefox polls
 * that file and updates itself; nothing on the Chrome side is involved. T-261021-phi.
 */

export const FIREFOX_UPDATES_PATH = "firefox/updates.json";
/**
 * What Firefox wants for an add-on it should offer to install when a page links to it. Served as
 * anything else, the click downloads the file instead. The bucket allows it since
 * `20261021140000_extension_release_bucket_xpi.sql`.
 */
export const FIREFOX_XPI_CONTENT_TYPE = "application/x-xpinstall";
export const FIREFOX_DIST_DIR = "browserExtension/dist-firefox";

/** web-ext reads its options from WEB_EXT_* variables, so the AMO credentials never reach argv. */
const AMO_KEY_ENV = "WEB_EXT_API_KEY";
const AMO_SECRET_ENV = "WEB_EXT_API_SECRET";

export interface FirefoxReleaseMetadata {
  version: string;
  extension_id: string;
  sha256: string;
  download_url: string;
}

export function getFirefoxReleaseObjectPath(version: string): string {
  return `releases/${version}/orbit-extension-${version}.xpi`;
}

/** The update manifest Firefox reads from `update_url`, in the shape Firefox documents. */
export function buildFirefoxUpdatesManifest(release: FirefoxReleaseMetadata): unknown {
  return {
    addons: {
      [release.extension_id]: {
        updates: [
          {
            version: release.version,
            update_link: release.download_url,
            update_hash: `sha256:${release.sha256}`,
          },
        ],
      },
    },
  };
}

export function hasAmoCredentials(env: Record<string, string | undefined>): boolean {
  return Boolean(env[AMO_KEY_ENV]?.trim() && env[AMO_SECRET_ENV]?.trim());
}

function webExtBin(rootDir: string): string {
  return path.join(rootDir, "node_modules", "web-ext", "bin", "web-ext.js");
}

function runWebExt(rootDir: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [webExtBin(rootDir), ...args], {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`web-ext ${args[0]} exited with code ${code ?? "null"}`));
    });
  });
}

/** AMO's own validator, run locally: an error here is one AMO would refuse to sign. */
export async function lintFirefoxBuild(rootDir: string): Promise<void> {
  await runWebExt(rootDir, [
    "lint",
    "--source-dir",
    path.join(rootDir, FIREFOX_DIST_DIR),
    "--self-hosted",
    "--no-config-discovery",
  ]);
}

/**
 * Signs the built Firefox add-on into `destinationPath`. AMO signs a version once: signing a
 * version it already holds fails, so a publish that failed after signing is retried with a new
 * manifest version, not by re-running the job.
 */
export async function signFirefoxBuild(rootDir: string, destinationPath: string): Promise<void> {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  const signDir = await fs.mkdtemp(path.join(path.dirname(destinationPath), ".web-ext-sign-"));
  try {
    await runWebExt(rootDir, [
      "sign",
      "--source-dir",
      path.join(rootDir, FIREFOX_DIST_DIR),
      "--artifacts-dir",
      signDir,
      "--channel",
      "unlisted",
      "--no-config-discovery",
    ]);
    const signed = (await fs.readdir(signDir)).filter((name) => name.endsWith(".xpi"));
    if (signed.length !== 1) {
      throw new Error(`web-ext sign left ${signed.length} .xpi files, expected one.`);
    }
    await fs.rename(path.join(signDir, signed[0]!), destinationPath);
  } finally {
    await fs.rm(signDir, { recursive: true, force: true });
  }
}

export async function sha256OfFile(filePath: string): Promise<string> {
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex");
}
