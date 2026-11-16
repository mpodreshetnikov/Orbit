/**
 * Spec / second-approve gate with owner waive (CLI for pre-push and CI).
 * Delegates core checks to spec-approve.cjs; waive lives in spec-owner-waive.cjs
 * so spec-approve.cjs can stay identical to main under incremental mutation.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  checkClaimedTask,
  evaluateCodeGate,
  loadTaskFile,
  locateRegistry,
  parseApprovalsFromTask,
  parseFrontMatter,
  readMarker,
} = require("./spec-approve.cjs");
const { applyOwnerSpecWaive, evaluateCodeGateWithOwnerWaive } = require("./spec-owner-waive.cjs");

const REPO_ROOT = path.resolve(__dirname, "../..");

function parseSpecApprovalsEnv(env) {
  if (!env.SPEC_APPROVALS) return [];
  return String(env.SPEC_APPROVALS)
    .split(",")
    .map((s) => s.trim())
    .filter((login) => login.length > 0)
    .map((login) => ({ login }));
}

function checkClaimedTaskWithWaive({ repoRoot = REPO_ROOT, env = process.env } = {}) {
  const taskId = readMarker(repoRoot);
  if (!taskId) {
    return checkClaimedTask({ repoRoot, env });
  }
  const registry = locateRegistry(repoRoot, env);
  if (!registry) {
    return {
      ok: false,
      code: "no-registry",
      message:
        "spec-approve: REFUSED. Claimed task present but registry not reachable " +
        "(link docs/tasks or set ORBIT_TASKS_ROOT).",
    };
  }
  const loaded = loadTaskFile(taskId, registry);
  if (!loaded) {
    return {
      ok: false,
      code: "unknown-task",
      message: `spec-approve: REFUSED. Task ${taskId} not found under ${registry}/docs/tasks.`,
    };
  }
  const fm = parseFrontMatter(loaded.text);
  return evaluateCodeGateWithOwnerWaive(evaluateCodeGate, {
    taskText: loaded.text,
    ownerEmail: fm.owner,
    actorEmail: fm.owner,
    isAgentExecutor: false,
    approvals: parseApprovalsFromTask(loaded.text),
  });
}

function checkTaskFileWithWaive(filePath, { env = process.env } = {}) {
  const text = fs.readFileSync(filePath, "utf8");
  const fm = parseFrontMatter(text);
  return evaluateCodeGateWithOwnerWaive(evaluateCodeGate, {
    taskText: text,
    ownerEmail: fm.owner,
    actorEmail: fm.owner,
    isAgentExecutor: false,
    approvals: [...parseApprovalsFromTask(text), ...parseSpecApprovalsEnv(env)],
  });
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] === "--check-claimed") {
    const result = checkClaimedTaskWithWaive();
    (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
    process.exit(result.ok ? 0 : 1);
  }
  if (argv[0] === "--check-task-file") {
    const file = argv[1];
    if (!file) {
      process.stderr.write("Usage: spec-approve-gate.cjs --check-task-file <path>\n");
      process.exit(2);
    }
    const result = checkTaskFileWithWaive(file);
    (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
    process.exit(result.ok ? 0 : 1);
  }
  process.stderr.write(
    "Usage: spec-approve-gate.cjs --check-claimed | --check-task-file <path>\n",
  );
  process.exit(2);
}

module.exports = {
  checkClaimedTaskWithWaive,
  checkTaskFileWithWaive,
  evaluateCodeGateWithOwnerWaive,
  applyOwnerSpecWaive,
  parseSpecApprovalsEnv,
};

// Stryker disable next-line all: CLI entry — unreachable when the module is imported by tests
if (require.main === module) {
  main();
}
