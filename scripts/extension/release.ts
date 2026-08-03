#!/usr/bin/env node

import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ZERO_SHA = "0000000000000000000000000000000000000000";
const CHROME_EXTENSION_ID_ALPHABET = "abcdefghijklmnop";
const EXTENSION_RELEASE_BUCKET = "extension-releases";
const EXTENSION_RELEASE_LATEST_PATH = "latest.json";
const EXTENSION_RELEASE_MANIFEST_PATH = "browserExtension/manifest.json";
const EXTENSION_RELEASE_DIST_DIR = "browserExtension/dist";
const DEFAULT_ARTIFACT_DIR = ".artifacts/extension-release";

const EXTENSION_VERSIONED_SURFACE_PATTERNS = [
  /^browserExtension\//,
  /^scripts\/extension\//,
  /^vite\.config\.extension\.ts$/,
] as const;

/**
 * Test and spec files live inside the surfaces above but are never packaged
 * into the extension bundle, so changing one cannot alter what users receive.
 * Requiring a release version bump for them mints a new extension release for
 * a test-only edit — and, because a version change also triggers the release
 * bundle job, turns a test fix into a publish.
 */
const EXTENSION_NON_PACKAGED_PATTERNS = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)__tests__\//,
  // This file is the release tooling itself: it reads the manifest, zips
  // browserExtension/dist and uploads the result. It cannot change what goes
  // into that bundle — only build.ts, build-lib.ts and esbuild-widget.ts can —
  // so a change here does not alter what users receive. Without this, editing
  // the version policy would require a version bump to land the change, which
  // is circular. The rest of scripts/extension/ stays governed.
  /^scripts\/extension\/release\.ts$/,
] as const;

export interface ExtensionReleaseMetadata {
  version: string;
  published_at: string;
  extension_id: string;
  sha256: string;
  download_url: string;
}

export interface ExtensionReleaseManifest {
  version: string;
  key: string;
}

export interface ExtensionVersionPolicyResult {
  changedFiles: string[];
  versionChanged: boolean;
  previousVersion: string;
  nextVersion: string;
  requiresVersionBump: boolean;
}

export interface PreparedExtensionRelease {
  artifactDir: string;
  artifactPath: string;
  artifactRelativePath: string;
  metadataPath: string;
  metadata: ExtensionReleaseMetadata;
}

type ReleaseCommandName = "build-artifact" | "publish" | "check-version-bump";

type ParsedCliArgs = {
  command: ReleaseCommandName;
  options: Record<string, string>;
};

export function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").trim();
}

export function isExtensionVersionedSurface(filePath: string): boolean {
  const normalized = normalizeRepoPath(filePath);
  if (EXTENSION_NON_PACKAGED_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return EXTENSION_VERSIONED_SURFACE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function normalizeChangedFiles(filePaths: string[]): string[] {
  return Array.from(new Set(filePaths.map(normalizeRepoPath).filter(Boolean)));
}

function parseManifestFromContent(content: string): ExtensionReleaseManifest {
  const parsed = JSON.parse(content) as { version?: unknown; key?: unknown };

  if (typeof parsed.version !== "string" || !parsed.version.trim()) {
    throw new Error("Extension manifest version is missing or invalid.");
  }

  if (typeof parsed.key !== "string" || !parsed.key.trim()) {
    throw new Error("Extension manifest key is missing or invalid.");
  }

  return {
    version: parsed.version.trim(),
    key: parsed.key.trim(),
  };
}

function parseManifestVersionFromContent(content: string): string {
  const parsed = JSON.parse(content) as { version?: unknown };
  if (typeof parsed.version !== "string" || !parsed.version.trim()) {
    throw new Error("Extension manifest version is missing or invalid.");
  }
  return parsed.version.trim();
}

export async function readExtensionManifest(
  manifestPath: string,
): Promise<ExtensionReleaseManifest> {
  const content = await fs.readFile(manifestPath, "utf8");
  return parseManifestFromContent(content);
}

export async function readExtensionManifestVersion(manifestPath: string): Promise<string> {
  const manifest = await readExtensionManifest(manifestPath);
  return manifest.version;
}

export function getExtensionReleaseArtifactName(version: string): string {
  return `orbit-extension-${version}.zip`;
}

export function getExtensionReleaseObjectPath(version: string): string {
  return `releases/${version}/${getExtensionReleaseArtifactName(version)}`;
}

export function deriveChromeExtensionIdFromKey(key: string): string {
  const derBytes = Buffer.from(key.trim(), "base64");
  const digest = crypto.createHash("sha256").update(derBytes).digest();

  let extensionId = "";
  for (let index = 0; index < 16; index += 1) {
    const byte = digest[index] ?? 0;
    extensionId += CHROME_EXTENSION_ID_ALPHABET[(byte >> 4) & 0x0f];
    extensionId += CHROME_EXTENSION_ID_ALPHABET[byte & 0x0f];
  }

  return extensionId;
}

export function buildExtensionReleaseMetadata(input: {
  version: string;
  publishedAt: string;
  extensionId: string;
  sha256: string;
  downloadUrl: string;
}): ExtensionReleaseMetadata {
  return {
    version: input.version,
    published_at: input.publishedAt,
    extension_id: input.extensionId,
    sha256: input.sha256,
    download_url: input.downloadUrl,
  };
}

export function detectManifestVersionChange(
  previousContent: string,
  nextContent: string,
): {
  changed: boolean;
  previousVersion: string;
  nextVersion: string;
} {
  const previousVersion = parseManifestVersionFromContent(previousContent);
  const nextVersion = parseManifestVersionFromContent(nextContent);

  return {
    changed: previousVersion !== nextVersion,
    previousVersion,
    nextVersion,
  };
}

export function shouldRequireExtensionVersionBump(input: {
  changedFiles: string[];
  versionChanged: boolean;
}): boolean {
  if (input.versionChanged) return false;
  return input.changedFiles.some((filePath) => isExtensionVersionedSurface(filePath));
}

export function evaluateExtensionVersionPolicy(input: {
  changedFiles: string[];
  previousManifestContent: string;
  nextManifestContent: string;
}): ExtensionVersionPolicyResult {
  const normalizedChangedFiles = normalizeChangedFiles(input.changedFiles);
  const versionDelta = detectManifestVersionChange(
    input.previousManifestContent,
    input.nextManifestContent,
  );

  return {
    changedFiles: normalizedChangedFiles,
    versionChanged: versionDelta.changed,
    previousVersion: versionDelta.previousVersion,
    nextVersion: versionDelta.nextVersion,
    requiresVersionBump: shouldRequireExtensionVersionBump({
      changedFiles: normalizedChangedFiles,
      versionChanged: versionDelta.changed,
    }),
  };
}

export function buildSupabaseStoragePublicUrl(input: {
  supabaseUrl: string;
  bucketName?: string;
  objectPath: string;
}): string {
  const normalizedBase = input.supabaseUrl.trim().replace(/\/+$/, "");
  const bucketName = (input.bucketName ?? EXTENSION_RELEASE_BUCKET).trim();
  const encodedPath = normalizeRepoPath(input.objectPath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${normalizedBase}/storage/v1/object/public/${encodeURIComponent(bucketName)}/${encodedPath}`;
}

function boolLines(result: ExtensionVersionPolicyResult): string {
  return [
    `versionChanged=${result.versionChanged}`,
    `requiresVersionBump=${result.requiresVersionBump}`,
    `previousVersion=${result.previousVersion}`,
    `nextVersion=${result.nextVersion}`,
  ].join("\n");
}

function parseCliArgs(argv: string[]): ParsedCliArgs {
  const args = argv.slice(2);
  const [commandName, ...optionArgs] = args;

  if (
    commandName !== "build-artifact" &&
    commandName !== "publish" &&
    commandName !== "check-version-bump"
  ) {
    throw new Error("Expected one of: build-artifact, publish, check-version-bump.");
  }

  const options: Record<string, string> = {};
  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    if (arg.includes("=")) {
      const [rawKey, ...rawValue] = arg.slice(2).split("=");
      options[rawKey] = rawValue.join("=");
      continue;
    }

    const key = arg.slice(2);
    const nextArg = optionArgs[index + 1];
    if (!nextArg || nextArg.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = nextArg;
    index += 1;
  }

  return {
    command: commandName,
    options,
  };
}

function requiredOption(options: Record<string, string>, name: string): string {
  const value = options[name]?.trim();
  if (!value) {
    throw new Error(`Missing required option --${name}`);
  }
  return value;
}

function optionalOption(
  options: Record<string, string>,
  name: string,
  fallback?: string,
): string | undefined {
  const value = options[name]?.trim();
  if (value) return value;
  return fallback;
}

function resolveNpxBin(): string {
  const nodeDir = path.dirname(process.execPath);
  if (process.platform === "win32") {
    return path.join(nodeDir, "npx.cmd");
  }
  return path.join(nodeDir, "npx");
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed: ${command} ${args.join(" ")} (exit ${code ?? "null"})`));
    });
  });
}

async function createZipArchive(sourceDir: string, destinationPath: string): Promise<void> {
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.rm(destinationPath, { force: true });

  if (process.platform === "win32") {
    await runCommand(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        [
          "$ErrorActionPreference = 'Stop'",
          "Get-ChildItem -LiteralPath $env:ZIP_SOURCE_DIR -Force | Compress-Archive -DestinationPath $env:ZIP_DESTINATION_PATH -Force",
        ].join("; "),
      ],
      {
        env: {
          ...process.env,
          ZIP_SOURCE_DIR: sourceDir,
          ZIP_DESTINATION_PATH: destinationPath,
        },
      },
    );
    return;
  }

  await runCommand("zip", ["-rq", destinationPath, "."], {
    cwd: sourceDir,
    env: process.env,
  });
}

async function sha256File(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function ensureProductionReleaseBuildEnv(env: NodeJS.ProcessEnv): {
  appOrigin: string;
  supabaseUrl: string;
} {
  const appOrigin = (env.NEXT_PUBLIC_APP_ORIGIN || env.NEXT_PUBLIC_APP_ORIGINS || "").trim();
  if (!appOrigin) {
    throw new Error(
      "NEXT_PUBLIC_APP_ORIGIN or NEXT_PUBLIC_APP_ORIGINS is required for production extension releases.",
    );
  }

  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!supabaseUrl) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for production extension releases.");
  }

  return { appOrigin, supabaseUrl };
}

async function buildExtensionProduction(rootDir: string): Promise<void> {
  const npxBin = resolveNpxBin();

  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe";
    await runCommand(
      comspec,
      ["/d", "/s", "/c", npxBin, "tsx", "scripts/extension/build.ts", "--mode=production"],
      {
        cwd: rootDir,
        env: process.env,
      },
    );
    return;
  }

  await runCommand(npxBin, ["tsx", "scripts/extension/build.ts", "--mode=production"], {
    cwd: rootDir,
    env: process.env,
  });
}

export async function prepareExtensionRelease(
  options: {
    rootDir?: string;
    artifactDir?: string;
    publishedAt?: string;
    supabaseUrl?: string;
  } = {},
): Promise<PreparedExtensionRelease> {
  const rootDir = options.rootDir ?? REPO_ROOT;
  const artifactDir = path.resolve(rootDir, options.artifactDir ?? DEFAULT_ARTIFACT_DIR);
  const buildEnv = ensureProductionReleaseBuildEnv(process.env);
  const supabaseUrl = options.supabaseUrl ?? buildEnv.supabaseUrl;

  await buildExtensionProduction(rootDir);

  const sourceManifestPath = path.join(rootDir, EXTENSION_RELEASE_MANIFEST_PATH);
  const distManifestPath = path.join(rootDir, EXTENSION_RELEASE_DIST_DIR, "manifest.json");
  const distDir = path.join(rootDir, EXTENSION_RELEASE_DIST_DIR);

  const sourceManifest = await readExtensionManifest(sourceManifestPath);
  const distManifest = await readExtensionManifest(distManifestPath);
  if (distManifest.version !== sourceManifest.version) {
    throw new Error(
      `Built extension version ${distManifest.version} does not match source manifest version ${sourceManifest.version}.`,
    );
  }

  const version = sourceManifest.version;
  const artifactRelativePath = getExtensionReleaseObjectPath(version);
  const artifactPath = path.join(artifactDir, ...artifactRelativePath.split("/"));

  await createZipArchive(distDir, artifactPath);

  const sha256 = await sha256File(artifactPath);
  const extensionId = deriveChromeExtensionIdFromKey(distManifest.key);
  const metadata = buildExtensionReleaseMetadata({
    version,
    publishedAt: options.publishedAt ?? new Date().toISOString(),
    extensionId,
    sha256,
    downloadUrl: buildSupabaseStoragePublicUrl({
      supabaseUrl,
      objectPath: artifactRelativePath,
    }),
  });

  const metadataPath = path.join(artifactDir, EXTENSION_RELEASE_LATEST_PATH);
  await fs.mkdir(path.dirname(metadataPath), { recursive: true });
  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  return {
    artifactDir,
    artifactPath,
    artifactRelativePath,
    metadataPath,
    metadata,
  };
}

async function createSupabaseAdminClient(input: { supabaseUrl: string; serviceRoleKey: string }) {
  return createClient(input.supabaseUrl, input.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function publishPreparedExtensionRelease(
  options: {
    artifactDir?: string;
    rootDir?: string;
    supabaseUrl?: string;
    serviceRoleKey?: string;
  } = {},
): Promise<PreparedExtensionRelease> {
  const rootDir = options.rootDir ?? REPO_ROOT;
  const artifactDir = path.resolve(rootDir, options.artifactDir ?? DEFAULT_ARTIFACT_DIR);
  const buildEnv = ensureProductionReleaseBuildEnv(process.env);
  const supabaseUrl = options.supabaseUrl ?? buildEnv.supabaseUrl;
  const serviceRoleKey = (
    options.serviceRoleKey ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    ""
  ).trim();

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required to publish extension releases.");
  }

  const metadataPath = path.join(artifactDir, EXTENSION_RELEASE_LATEST_PATH);
  const metadata = JSON.parse(await fs.readFile(metadataPath, "utf8")) as ExtensionReleaseMetadata;
  const artifactRelativePath = getExtensionReleaseObjectPath(metadata.version);
  const artifactPath = path.join(artifactDir, ...artifactRelativePath.split("/"));
  const expectedDownloadUrl = buildSupabaseStoragePublicUrl({
    supabaseUrl,
    objectPath: artifactRelativePath,
  });

  if (metadata.download_url !== expectedDownloadUrl) {
    throw new Error(
      `Prepared metadata download URL ${metadata.download_url} does not match ${expectedDownloadUrl}.`,
    );
  }

  const supabase = await createSupabaseAdminClient({
    supabaseUrl,
    serviceRoleKey,
  });

  const artifactContent = await fs.readFile(artifactPath);
  const latestMetadataContent = await fs.readFile(metadataPath);

  const artifactUpload = await supabase.storage
    .from(EXTENSION_RELEASE_BUCKET)
    .upload(artifactRelativePath, artifactContent, {
      upsert: true,
      contentType: "application/zip",
    });
  if (artifactUpload.error) {
    throw new Error(`Failed to upload extension artifact: ${artifactUpload.error.message}`);
  }

  const latestUpload = await supabase.storage
    .from(EXTENSION_RELEASE_BUCKET)
    .upload(EXTENSION_RELEASE_LATEST_PATH, latestMetadataContent, {
      upsert: true,
      contentType: "application/json; charset=utf-8",
    });
  if (latestUpload.error) {
    throw new Error(`Failed to upload extension release metadata: ${latestUpload.error.message}`);
  }

  return {
    artifactDir,
    artifactPath,
    artifactRelativePath,
    metadataPath,
    metadata,
  };
}

function runGit(rootDir: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: rootDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(
        new Error(stderr.trim() || `git ${args.join(" ")} failed with exit ${code ?? "null"}`),
      );
    });
  });
}

async function listChangedFilesFromRange(
  rootDir: string,
  fromRef: string,
  toRef: string,
): Promise<string[]> {
  const to = toRef || "HEAD";

  if (!fromRef || fromRef === ZERO_SHA) {
    const stdout = await runGit(rootDir, ["show", "--pretty=format:", "--name-only", to]);
    return normalizeChangedFiles(stdout.split(/\r?\n/));
  }

  const stdout = await runGit(rootDir, ["diff", "--name-only", `${fromRef}..${to}`]);
  return normalizeChangedFiles(stdout.split(/\r?\n/));
}

async function readGitFileAtRef(rootDir: string, ref: string, filePath: string): Promise<string> {
  return await runGit(rootDir, ["show", `${ref}:${normalizeRepoPath(filePath)}`]);
}

export async function evaluateExtensionVersionPolicyFromGit(input: {
  rootDir?: string;
  fromRef: string;
  toRef: string;
}): Promise<ExtensionVersionPolicyResult> {
  const rootDir = input.rootDir ?? REPO_ROOT;
  const previousRef = input.fromRef || ZERO_SHA;
  const nextRef = input.toRef || "HEAD";

  const [changedFiles, previousManifestContent, nextManifestContent] = await Promise.all([
    listChangedFilesFromRange(rootDir, previousRef, nextRef),
    readGitFileAtRef(
      rootDir,
      previousRef === ZERO_SHA ? nextRef : previousRef,
      EXTENSION_RELEASE_MANIFEST_PATH,
    ),
    readGitFileAtRef(rootDir, nextRef, EXTENSION_RELEASE_MANIFEST_PATH),
  ]);

  return evaluateExtensionVersionPolicy({
    changedFiles,
    previousManifestContent,
    nextManifestContent,
  });
}

async function writeGithubOutput(outputFile: string, content: string): Promise<void> {
  await fs.appendFile(outputFile, `${content}\n`, "utf8");
}

async function runCli(): Promise<void> {
  const parsed = parseCliArgs(process.argv);

  if (parsed.command === "build-artifact") {
    const result = await prepareExtensionRelease({
      artifactDir: optionalOption(parsed.options, "output-dir"),
      publishedAt: optionalOption(parsed.options, "published-at"),
      supabaseUrl: optionalOption(parsed.options, "supabase-url"),
    });
    process.stdout.write(`${JSON.stringify(result.metadata, null, 2)}\n`);
    return;
  }

  if (parsed.command === "publish") {
    const result = await publishPreparedExtensionRelease({
      artifactDir: optionalOption(parsed.options, "artifact-dir"),
      supabaseUrl: optionalOption(parsed.options, "supabase-url"),
      serviceRoleKey: optionalOption(parsed.options, "service-role-key"),
    });
    process.stdout.write(`${JSON.stringify(result.metadata, null, 2)}\n`);
    return;
  }

  const result = await evaluateExtensionVersionPolicyFromGit({
    fromRef: requiredOption(parsed.options, "from"),
    toRef: requiredOption(parsed.options, "to"),
  });
  const format = optionalOption(parsed.options, "format", "json");

  if (format === "env") {
    process.stdout.write(`${boolLines(result)}\n`);
    return;
  }

  if (format === "github-output") {
    const outputFile =
      optionalOption(parsed.options, "output-file") ?? process.env.GITHUB_OUTPUT?.trim();
    if (!outputFile) {
      throw new Error("--format=github-output requires --output-file or GITHUB_OUTPUT.");
    }
    await writeGithubOutput(outputFile, boolLines(result));
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const invokedScript = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (invokedScript === import.meta.url) {
  runCli().catch((error) => {
    console.error("[extension-release]", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

export {
  DEFAULT_ARTIFACT_DIR,
  EXTENSION_RELEASE_BUCKET,
  EXTENSION_RELEASE_LATEST_PATH,
  ZERO_SHA,
  createZipArchive,
};
