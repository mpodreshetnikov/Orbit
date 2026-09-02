#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ZERO_SHA = "0000000000000000000000000000000000000000";

function normalizePath(filePath) {
  return (filePath || "").replace(/\\/g, "/").trim();
}

function uniq(items) {
  return Array.from(new Set(items)).filter(Boolean);
}

function isDocFile(filePath) {
  const normalized = normalizePath(filePath);
  return (
    normalized.startsWith("docs/") ||
    normalized.startsWith(".agents/skills/") ||
    normalized.toLowerCase().endsWith(".md") ||
    normalized.toLowerCase().endsWith(".mdx")
  );
}

function classifyChangedFiles(changedFiles) {
  const normalizedChangedFiles = uniq(changedFiles.map(normalizePath));
  const hasFiles = normalizedChangedFiles.length > 0;

  // `supabase/config.toml` and the artifact generator belong here alongside the SQL. The config
  // pins the database's major version, which decides which pg_dump can dump it at all; the
  // generator is what writes `schema.snapshot.sql` and `database.types.ts` and what the DB lane
  // runs to verify them. A change to either can only be exercised by running that lane, and
  // leaving them out meant the pull request that repaired the verification could not demonstrate
  // it -- the lane it fixed was skipped on the change that fixed it.
  const dbImpact = normalizedChangedFiles.some(
    (filePath) =>
      /^supabase\/(db|migrations|tests)\//.test(filePath) ||
      filePath === "supabase/config.toml" ||
      /^scripts\/just\/db-artifacts(\.|$)/.test(filePath),
  );
  const webImpact = normalizedChangedFiles.some(
    (filePath) =>
      filePath.startsWith("src/") || filePath.startsWith("shared/") || filePath.startsWith("e2e/"),
  );
  const extensionImpact = normalizedChangedFiles.some(
    (filePath) =>
      filePath.startsWith("browserExtension/") ||
      filePath.startsWith("scripts/extension/") ||
      filePath === "vite.config.extension.ts",
  );
  const functionsImpact = normalizedChangedFiles.some((filePath) =>
    filePath.startsWith("supabase/functions/"),
  );
  // The extraction corpus and the harness that scores it. Neither matched any flag above:
  // `test/fixtures/` is not a source prefix and `isDocFile` does not claim it either, so a change
  // touching only the corpus reported no impact at all. Nothing gates on these flags today, which
  // is why nothing has broken -- but the first gate that does would skip exactly the pull requests
  // that edit the corpus, which is the one change most able to move every score silently.
  const fixturesImpact = normalizedChangedFiles.some(
    (filePath) =>
      filePath.startsWith("test/fixtures/") || filePath.startsWith("scripts/extraction-eval/"),
  );
  const docsOnly = hasFiles && normalizedChangedFiles.every(isDocFile);

  return {
    changedFiles: normalizedChangedFiles,
    dbImpact,
    webImpact,
    extensionImpact,
    functionsImpact,
    fixturesImpact,
    docsOnly,
  };
}

function runGit(args) {
  return spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function parseGitStatusLine(line) {
  const trimmed = (line || "").trim();
  if (!trimmed) {
    return null;
  }

  const payload = trimmed.slice(3);
  if (!payload) {
    return null;
  }

  if (payload.includes(" -> ")) {
    return normalizePath(payload.split(" -> ")[1]);
  }

  return normalizePath(payload);
}

function changedFilesFromWorkingTree() {
  const result = runGit(["status", "--porcelain"]);
  if (result.status !== 0) {
    return null;
  }

  return uniq((result.stdout || "").split(/\r?\n/).map(parseGitStatusLine).filter(Boolean));
}

function changedFilesFromRange(fromRef, toRef) {
  const to = toRef || "HEAD";
  if (!fromRef || fromRef === ZERO_SHA) {
    const showResult = runGit(["show", "--pretty=format:", "--name-only", to]);
    if (showResult.status !== 0) {
      return null;
    }

    return uniq((showResult.stdout || "").split(/\r?\n/).map(normalizePath).filter(Boolean));
  }

  const diffResult = runGit(["diff", "--name-only", `${fromRef}..${to}`]);
  if (diffResult.status !== 0) {
    return null;
  }

  return uniq((diffResult.stdout || "").split(/\r?\n/).map(normalizePath).filter(Boolean));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    from: null,
    to: null,
    format: "json",
    outputFile: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--from") {
      options.from = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--from=")) {
      options.from = arg.slice("--from=".length);
      continue;
    }
    if (arg === "--to") {
      options.to = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--to=")) {
      options.to = arg.slice("--to=".length);
      continue;
    }
    if (arg === "--format") {
      options.format = args[index + 1] ?? "json";
      index += 1;
      continue;
    }
    if (arg.startsWith("--format=")) {
      options.format = arg.slice("--format=".length);
      continue;
    }
    if (arg === "--output-file") {
      options.outputFile = args[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith("--output-file=")) {
      options.outputFile = arg.slice("--output-file=".length);
      continue;
    }
  }

  return options;
}

function boolLines(impact) {
  return [
    `dbImpact=${impact.dbImpact}`,
    `webImpact=${impact.webImpact}`,
    `extensionImpact=${impact.extensionImpact}`,
    `functionsImpact=${impact.functionsImpact}`,
    `fixturesImpact=${impact.fixturesImpact}`,
    `docsOnly=${impact.docsOnly}`,
  ].join("\n");
}

function detectChangeImpact(options = {}) {
  const files =
    options.from || options.to
      ? changedFilesFromRange(options.from, options.to)
      : changedFilesFromWorkingTree();
  if (!files) {
    return null;
  }
  return classifyChangedFiles(files);
}

function main() {
  const options = parseArgs(process.argv);
  const impact = detectChangeImpact(options);
  if (!impact) {
    console.error("[change-impact] unable to determine changed files from git.");
    process.exit(1);
  }

  if (options.format === "env") {
    console.log(boolLines(impact));
    return;
  }

  if (options.format === "github-output") {
    const outputFile = options.outputFile || process.env.GITHUB_OUTPUT;
    if (!outputFile) {
      console.error(
        "[change-impact] --format=github-output requires --output-file or GITHUB_OUTPUT env.",
      );
      process.exit(1);
    }
    fs.appendFileSync(outputFile, `${boolLines(impact)}\n`, "utf8");
    return;
  }

  console.log(JSON.stringify(impact, null, 2));
}

if (require.main === module) {
  main();
}

module.exports = {
  ZERO_SHA,
  classifyChangedFiles,
  changedFilesFromWorkingTree,
  changedFilesFromRange,
  detectChangeImpact,
  isDocFile,
  normalizePath,
  parseArgs,
  parseGitStatusLine,
};
