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
const AMO_API_URL = "https://addons.mozilla.org/api/v5";

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
 * Signs the built Firefox add-on into `destinationPath`. AMO signs a version once and refuses the
 * same version again ("Version 0.1.26 already exists"), so a release whose publish failed after
 * signing is completed by `downloadSignedFirefoxVersion`, not by this.
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

/** The short-lived token AMO's API takes: HS256 over the issuer, a nonce and a minute of validity. */
export function createAmoJwt(
  env: Record<string, string | undefined>,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: env[AMO_KEY_ENV]?.trim(),
    jti: crypto.randomUUID(),
    iat: nowSeconds,
    exp: nowSeconds + 60,
  })}`;
  const signature = crypto
    .createHmac("sha256", env[AMO_SECRET_ENV]?.trim() ?? "")
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

/**
 * Downloads the add-on AMO already signed for `version` into `destinationPath`, and says whether
 * there was one. Signing and publishing are separate steps, so a publish can fail after AMO has
 * signed -- a Storage that refused the upload, a server not yet migrated -- and the next run, which
 * cannot sign that version again, takes the signed file from AMO instead of needing a version bump.
 * The manifest version is bumped whenever the packaged code changes, so the file AMO holds for a
 * version is the build of that version.
 */
export async function downloadSignedFirefoxVersion(input: {
  geckoId: string;
  version: string;
  destinationPath: string;
  env: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const authorization = () => ({ Authorization: `JWT ${createAmoJwt(input.env)}` });
  const versionUrl = `${AMO_API_URL}/addons/addon/${encodeURIComponent(input.geckoId)}/versions/v${encodeURIComponent(input.version)}/`;
  const response = await fetchImpl(versionUrl, { headers: authorization() });
  // 404: AMO does not know the version, or not the add-on yet -- its first release.
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`AMO answered ${response.status} for ${input.version} of ${input.geckoId}.`);
  }
  const body = (await response.json()) as { file?: { url?: unknown; status?: unknown } };
  const fileUrl = body.file?.url;
  if (typeof fileUrl !== "string" || body.file?.status !== "public") {
    throw new Error(
      `AMO holds ${input.version} of ${input.geckoId} but has not signed it (file status ${String(body.file?.status)}).`,
    );
  }
  const file = await fetchImpl(fileUrl, { headers: authorization() });
  if (!file.ok) {
    throw new Error(`AMO answered ${file.status} for the signed file of ${input.version}.`);
  }
  await fs.mkdir(path.dirname(input.destinationPath), { recursive: true });
  await fs.writeFile(input.destinationPath, Buffer.from(await file.arrayBuffer()));
  return true;
}

export async function sha256OfFile(filePath: string): Promise<string> {
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex");
}
