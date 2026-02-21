#!/usr/bin/env node

const { spawnSync } = require("child_process");
const path = require("path");

const ZERO_SHA = "0000000000000000000000000000000000000000";
const GITLEAKS_IMAGE = process.env.GITLEAKS_DOCKER_IMAGE || "zricethezav/gitleaks:v8.18.4";
const repoRoot = path.resolve(__dirname, "..", "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    stdio: options.captureOutput ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
  });

  return result;
}

function runGit(args, captureOutput = false) {
  return run("git", args, { captureOutput });
}

function gitStdout(args) {
  const result = runGit(args, true);
  if (result.status !== 0) {
    return null;
  }
  return (result.stdout || "").trim();
}

function resolveLocalRange() {
  const upstream = gitStdout(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);

  if (upstream) {
    const mergeBase = gitStdout(["merge-base", "HEAD", upstream]);
    if (mergeBase) {
      return `${mergeBase}..HEAD`;
    }
  }

  const hasHeadParent = runGit(["rev-parse", "--verify", "HEAD~1"], true).status === 0;
  if (hasHeadParent) {
    return "HEAD~1..HEAD";
  }

  return "HEAD";
}

function resolveExplicitRange(rawFrom, rawTo) {
  const toRef = rawTo && rawTo.length > 0 ? rawTo : "HEAD";

  if (!rawFrom || rawFrom.length === 0 || rawFrom === ZERO_SHA) {
    const parentRef = gitStdout(["rev-parse", "--verify", `${toRef}~1`]);
    if (parentRef) {
      return `${parentRef}..${toRef}`;
    }
    return toRef;
  }

  return `${rawFrom}..${toRef}`;
}

function ensureDockerAvailable() {
  const result = run("docker", ["--version"], { captureOutput: true });
  if (result.status === 0) {
    return true;
  }

  console.error("Docker is required for secrets preflight but is not available.");
  console.error("Install Docker Desktop/Engine and retry.");
  return false;
}

function runGitleaks(rangeSpec) {
  const dockerArgs = [
    "run",
    "--rm",
    "-v",
    `${repoRoot}:/repo`,
    "-w",
    "/repo",
    GITLEAKS_IMAGE,
    "detect",
    "--source=/repo",
    "--redact",
    "--no-banner",
    `--log-opts=${rangeSpec}`,
  ];

  return run("docker", dockerArgs, { captureOutput: false });
}

function main() {
  const args = process.argv.slice(2);
  let rangeSpec;

  if (args[0] === "--range") {
    rangeSpec = resolveExplicitRange(args[1], args[2]);
  } else {
    rangeSpec = resolveLocalRange();
  }

  if (!ensureDockerAvailable()) {
    process.exit(1);
  }

  console.log(`Running Gitleaks preflight on range: ${rangeSpec}`);
  const result = runGitleaks(rangeSpec);
  const code = typeof result.status === "number" ? result.status : 1;

  if (code !== 0) {
    console.error("");
    console.error("Secret preflight failed.");
    console.error(
      "Remove leaked secrets from commits before pushing (rotate tokens if already exposed).",
    );
    process.exit(code);
  }

  console.log("Secret preflight passed.");
}

main();
