import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
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
 * cannot sign that version again, takes the signed file from AMO instead.
 *
 * Only a file that is this build is taken: it must match the hash AMO gives for it, and apart from
 * the signature in `META-INF/` and the build stamp it must hold exactly the files of `sourceDir`,
 * byte for byte, and the manifest's keys and values. A file
 * built from other code or for another server, or signed by someone else holding the AMO key,
 * fails the release, and a new manifest version is what releases that build.
 */
export async function downloadSignedFirefoxVersion(input: {
  geckoId: string;
  version: string;
  sourceDir: string;
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
  const body = (await response.json()) as {
    file?: { url?: unknown; status?: unknown; hash?: unknown };
  };
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
  const bytes = Buffer.from(await file.arrayBuffer());
  const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  if (body.file?.hash !== digest) {
    throw new Error(
      `The signed file AMO sent for ${input.version} does not match its hash (${String(body.file?.hash)}).`,
    );
  }

  await fs.mkdir(path.dirname(input.destinationPath), { recursive: true });
  const workDir = await fs.mkdtemp(path.join(path.dirname(input.destinationPath), ".amo-signed-"));
  try {
    const xpiPath = path.join(workDir, "signed.xpi");
    await fs.writeFile(xpiPath, bytes);
    const unpacked = path.join(workDir, "unpacked");
    await runCommand("unzip", ["-q", xpiPath, "-d", unpacked]);
    const difference = await firstDifference(input.sourceDir, unpacked);
    if (difference) {
      throw new Error(
        `AMO's signed ${input.version} is not this build (${difference}). Release it under a new manifest version.`,
      );
    }
    await fs.rename(xpiPath, input.destinationPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
  return true;
}

/**
 * The build's own stamp, a new time on every build, which only the development reload watcher reads.
 * Equal code from two builds differs here and nowhere else.
 */
const BUILD_STAMP_FILE = "reload-trigger.json";

/** web-ext leaves dotfiles out of what it submits, and AMO adds its signature under META-INF/. */
function isSubmitted(relativePath: string): boolean {
  return !relativePath.split("/").some((part) => part.startsWith("."));
}

/** The manifest as JSON, not as text: the same keys and values, however they were written out. */
function manifestDifference(built: Buffer, signed: Buffer): string | null {
  let ours: Record<string, unknown>;
  let theirs: Record<string, unknown>;
  try {
    ours = JSON.parse(built.toString("utf8")) as Record<string, unknown>;
    theirs = JSON.parse(signed.toString("utf8")) as Record<string, unknown>;
  } catch {
    return "manifest.json is not JSON";
  }
  const keys = [...new Set([...Object.keys(ours), ...Object.keys(theirs)])].sort();
  const differing = keys.filter((key) => !isDeepStrictEqual(ours[key], theirs[key]));
  return differing.length === 0 ? null : `manifest.json differs in ${differing.join(", ")}`;
}

async function listFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(rootDir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .sort();
}

/** The first file that differs between the build and the unpacked signed add-on, if any. */
async function firstDifference(sourceDir: string, unpackedDir: string): Promise<string | null> {
  const built = (await listFiles(sourceDir)).filter(
    (file) => isSubmitted(file) && file !== BUILD_STAMP_FILE,
  );
  const signed = (await listFiles(unpackedDir)).filter(
    (file) => !file.startsWith("META-INF/") && file !== BUILD_STAMP_FILE,
  );
  const missing = built.find((file) => !signed.includes(file));
  if (missing) return `${missing} is not in it`;
  const extra = signed.find((file) => !built.includes(file));
  if (extra) return `${extra} is not in the build`;
  for (const file of built) {
    const [a, b] = await Promise.all([
      fs.readFile(path.join(sourceDir, file)),
      fs.readFile(path.join(unpackedDir, file)),
    ]);
    if (file === "manifest.json") {
      const difference = manifestDifference(a, b);
      if (difference) return difference;
    } else if (!a.equals(b)) {
      return `${file} differs`;
    }
  }
  return null;
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "null"}`));
    });
  });
}

export async function sha256OfFile(filePath: string): Promise<string> {
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(filePath))
    .digest("hex");
}
