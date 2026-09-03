#!/usr/bin/env node

/**
 * The editor-time end of the registry gate: a Claude Code `PostToolUse` hook that says, after an
 * edit outside `docs/tasks/`, whether a claimed task stands behind it.
 *
 * The gate -- nothing changes in this repository until a task covering it exists and is
 * `in-progress` -- lived only in prose until T-260902-jxe, and T-260902-vva is the record of an agent
 * walking past it with the text loaded the whole time. Text informs; it does not stop. This hook is
 * the mechanism: it reads the claim marker `just tasks-claim <id>` writes to `.git/current-task`,
 * confirms on the registry's `origin/main` that the task it names is still `in-progress`, and reports
 * the edit as unclaimed otherwise.
 *
 * It reads the marker, not the branch name and not the diff (ADR-260902-i6t): a cloud session cannot
 * choose its branch name, and a correctly behaved feature branch contains no registry change at all,
 * because `task-status-sync` publishes every claim straight to `main`.
 *
 * It never blocks. Like `pr-size-hook.cjs` it emits `additionalContext`, which reaches the model as
 * information rather than as a refusal: the answer to work without a task is a decision the agent
 * makes -- claim one, or create one after the duplicate search and the user's confirmation -- not
 * a refused edit. Whether it earns teeth later is decided on whether these warnings are ignored.
 *
 * Reported once per verdict per REPORT_INTERVAL_MS, tracked in .git/task-claim-hook-state, so a
 * fresh session hears it on its first code edit and then is left alone until the situation changes.
 * The registry is fetched at most once per FETCH_INTERVAL_MS, with a short timeout, so the check
 * reads a snapshot that is minutes old at worst without making every edit wait on the network.
 *
 * Any failure here is silent and exits 0. This runs on every edit; a hook that breaks the session
 * would be worse than the problem it reports.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = process.env.TASK_CLAIM_HOOK_REPO_ROOT
  ? path.resolve(process.env.TASK_CLAIM_HOOK_REPO_ROOT)
  : path.resolve(__dirname, "..", "..");
const MARKER_PATH = path.join(REPO_ROOT, ".git", "current-task");
const STATE_PATH = path.join(REPO_ROOT, ".git", "task-claim-hook-state");
const FETCH_STAMP_PATH = path.join(REPO_ROOT, ".git", "task-claim-hook-fetched");
const REPORT_INTERVAL_MS = 10 * 60 * 1000;
const FETCH_INTERVAL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const TASK_ID_RE = /^T-(?:\d{6}-[0-9a-z]{3}|\d{4})$/;

/** Registry files are the one place an edit needs no claim: recording is how a claim is made. */
function isRegistryPath(filePath, repoRoot = REPO_ROOT) {
  if (!filePath) return false;
  const relative = path.relative(repoRoot, path.resolve(repoRoot, filePath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) return true;
  const parts = relative.split(path.sep);
  return parts[0] === "docs" && parts[1] === "tasks";
}

function readMarker(markerPath = MARKER_PATH) {
  try {
    const id = fs.readFileSync(markerPath, "utf8").trim();
    return id === "" ? null : id;
  } catch {
    return null;
  }
}

/**
 * Where the registry checkout is: the `docs/tasks` link target when the registry is installed, the
 * environment when a cloud session was told, and a sibling `orbit-tasks` clone otherwise.
 */
function locateRegistry(repoRoot = REPO_ROOT, env = process.env) {
  const candidates = [];
  try {
    const linked = fs.realpathSync(path.join(repoRoot, "docs", "tasks"));
    candidates.push(path.resolve(linked, "..", ".."));
  } catch {
    // Not linked here.
  }
  if (env.ORBIT_TASKS_REGISTRY) candidates.push(path.resolve(env.ORBIT_TASKS_REGISTRY));
  candidates.push(path.resolve(repoRoot, "..", "orbit-tasks"));

  return (
    candidates.find(
      (root) =>
        root !== repoRoot &&
        fs.existsSync(path.join(root, "docs", "tasks", "README.md")) &&
        fs.existsSync(path.join(root, ".git")),
    ) ?? null
  );
}

function git(root, args, options = {}) {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8", ...options });
}

/** Fetch the registry's main at most once per interval; a failure leaves the last snapshot in use. */
function refreshRegistry(registryRoot, stampPath = FETCH_STAMP_PATH, now = Date.now()) {
  try {
    const last = Number(fs.readFileSync(stampPath, "utf8"));
    if (Number.isFinite(last) && now - last < FETCH_INTERVAL_MS) return false;
  } catch {
    // Never fetched from this checkout.
  }
  try {
    fs.writeFileSync(stampPath, String(now));
  } catch {
    // A read-only .git only costs a fetch per edit.
  }
  git(registryRoot, ["fetch", "--quiet", "origin", "main"], { timeout: FETCH_TIMEOUT_MS });
  return true;
}

/** The task's status on the registry's origin/main, or null when no such task is there. */
function taskStatusOnMain(registryRoot, id) {
  const listed = git(registryRoot, ["ls-tree", "--name-only", "origin/main", "docs/tasks/"]);
  if (listed.status !== 0) return null;
  const file = listed.stdout
    .split("\n")
    .find((name) => path.basename(name).startsWith(`${id}-`) && name.endsWith(".md"));
  if (!file) return null;
  const shown = git(registryRoot, ["show", `origin/main:${file}`]);
  if (shown.status !== 0) return null;
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(shown.stdout);
  const status = match && /^status:\s*(\S+)/m.exec(match[1]);
  return status ? status[1] : null;
}

/**
 * The verdict on one edit, given the marker and a way to ask the board. Pure so the cases can be
 * tested without a registry: `unlinked` (no registry to ask), `unclaimed` (no marker), `unknown`
 * (marker names a task the board does not have), `closed` (the task is no longer in-progress) and
 * `claimed`, the one that stays silent.
 */
function evaluate({ marker, registryRoot, statusOf }) {
  if (!registryRoot) return { verdict: "unlinked" };
  if (!marker) return { verdict: "unclaimed" };
  if (!TASK_ID_RE.test(marker)) return { verdict: "unknown", id: marker };
  const status = statusOf(marker);
  if (status === null) return { verdict: "unknown", id: marker };
  if (status !== "in-progress") return { verdict: "closed", id: marker, status };
  return { verdict: "claimed", id: marker };
}

function message(result, filePath) {
  const edited = filePath ? `\`${filePath}\`` : "this file";
  switch (result.verdict) {
    case "unlinked":
      return (
        `The task registry is not reachable from this checkout, so the gate "nothing changes here ` +
        `until a task covering it is in-progress" cannot be satisfied for the edit to ${edited}. ` +
        `Link the registry (orbit-tasks: \`just install-into <orbit>\`), or point ORBIT_TASKS_REGISTRY ` +
        `at a clone of it, then \`just tasks-claim <id>\`. See AGENTS.md, "No Work Without A Task".`
      );
    case "unclaimed":
      return (
        `No claimed task stands behind the edit to ${edited}: \`.git/current-task\` is not armed. ` +
        `Nothing changes in this repository until a task covering it is in-progress on the registry's ` +
        `main. Claim one with \`just tasks-claim <id>\`; if none covers this work, the task-registry ` +
        `skill's duplicate search and the user's confirmation come before \`just tasks-new\`. A trivial ` +
        `change the policy allows without a task needs no claim -- decide, do not ignore.`
      );
    case "unknown":
      return (
        `\`.git/current-task\` names ${result.id}, which is not on the registry's main. The edit to ` +
        `${edited} has no claim the board can see. Re-run \`just tasks-claim <id>\` with a real task.`
      );
    case "closed":
      return (
        `\`.git/current-task\` names ${result.id}, which is ${result.status} on the registry's main, ` +
        `not in-progress. The edit to ${edited} is not covered by it: claim the task that covers this ` +
        `work with \`just tasks-claim <id>\`, or record why this is a trivial change.`
      );
    default:
      return "";
  }
}

/** Once per verdict per interval, keyed the way pr-size-hook keys its state under .git. */
function shouldReport(key, statePath = STATE_PATH, now = Date.now()) {
  try {
    const stored = fs.readFileSync(statePath, "utf8").trim();
    const separator = stored.lastIndexOf("\t");
    const lastKey = stored.slice(0, separator);
    const lastAt = Number(stored.slice(separator + 1));
    if (lastKey === key && Number.isFinite(lastAt) && now - lastAt < REPORT_INTERVAL_MS) {
      return false;
    }
  } catch {
    // Nothing recorded yet.
  }
  try {
    fs.writeFileSync(statePath, `${key}\t${now}`);
  } catch {
    // A read-only .git is not a reason to withhold the warning; it only costs a repeat.
  }
  return true;
}

function readInput() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function main() {
  const input = readInput();
  if (input.tool_name && !EDIT_TOOLS.has(input.tool_name)) return;
  const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? "";
  if (isRegistryPath(filePath)) return;

  const registryRoot = locateRegistry();
  if (registryRoot) refreshRegistry(registryRoot);

  const result = evaluate({
    marker: readMarker(),
    registryRoot,
    statusOf: (id) => taskStatusOnMain(registryRoot, id),
  });
  if (result.verdict === "claimed") return;

  const key = [result.verdict, result.id ?? "", result.status ?? ""].join(":");
  if (!shouldReport(key)) return;

  const relative = filePath ? path.relative(REPO_ROOT, path.resolve(REPO_ROOT, filePath)) : "";
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: message(result, relative),
      },
    })}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch {
    // Deliberately silent: see the header.
  }
}

module.exports = {
  EDIT_TOOLS,
  REPORT_INTERVAL_MS,
  evaluate,
  isRegistryPath,
  locateRegistry,
  message,
  readMarker,
  shouldReport,
  taskStatusOnMain,
};
