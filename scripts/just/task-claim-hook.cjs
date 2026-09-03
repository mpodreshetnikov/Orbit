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
 * It also runs around `Bash`, which is the other way a file changes. Before the command it
 * snapshots HEAD and the working tree's status (`--pre`); after it, the paths that differ from that
 * snapshot -- files the tree now carries changed, and files any commit made meanwhile touched -- are
 * what it judges, so a command that writes, stages and commits in one go is seen as the edit it
 * is. A file that was already dirty is compared by content, not by status code, and a file put
 * back to HEAD counts as changed too. The snapshot is keyed by the session that took it, so two
 * sessions running commands in one worktree do not read each other's. The same check runs after a
 * command that failed (`PostToolUseFailure`): a failed command has often written before it failed.
 * A shell command that changed nothing stays silent.
 *
 * Reported once per verdict per REPORT_INTERVAL_MS, tracked in .git/task-claim-hook-state, so a
 * fresh session hears it on its first code edit and then is left alone until the situation changes.
 * The three files under `.git/` are located through `git rev-parse --git-path`, so a linked
 * worktree, where `.git` is a file, keeps its own marker and state.
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
const REPORT_INTERVAL_MS = 10 * 60 * 1000;
const FETCH_INTERVAL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash"]);
const TASK_ID_RE = /^T-(?:\d{6}-[0-9a-z]{3}|\d{4})$/;

function git(root, args, options = {}) {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8", ...options });
}

/**
 * A file under this checkout's git directory, wherever that is: in a linked worktree `.git` is a
 * file pointing elsewhere, and the marker and state belong to the worktree, not to its siblings.
 */
function gitPath(name, repoRoot = REPO_ROOT) {
  const result = git(repoRoot, ["rev-parse", "--git-path", name]);
  return result.status === 0
    ? path.resolve(repoRoot, result.stdout.trim())
    : path.join(repoRoot, ".git", name);
}

const MARKER_PATH = gitPath("current-task");
const STATE_PATH = gitPath("task-claim-hook-state");
const FETCH_STAMP_PATH = gitPath("task-claim-hook-fetched");
/** One snapshot per session, so concurrent sessions in one worktree keep their own before/after. */
function preSnapshotPath(sessionId, repoRoot = REPO_ROOT) {
  const suffix = sessionId
    ? `-${String(sessionId)
        .replace(/[^A-Za-z0-9_-]/g, "_")
        .slice(0, 64)}`
    : "";
  return gitPath(`task-claim-hook-pre${suffix}`, repoRoot);
}

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

/**
 * Working-tree status outside the registry as `path -> identity`, where the identity is the status
 * code plus the blob hash of the file as it is now, so a dirty file edited again reads differently
 * even though its status code does not. A deleted file has no blob and is identified by its code.
 * Renames count as their new name.
 */
function statusOutsideRegistry(repoRoot = REPO_ROOT) {
  const result = git(repoRoot, ["status", "--porcelain", "--untracked-files=all", "--", "."]);
  const entries = new Map();
  if (result.status !== 0) return entries;
  const files = [];
  for (const line of result.stdout.split("\n").filter(Boolean)) {
    const file = line.slice(3).trim().replace(/^"|"$/g, "").split(" -> ").pop();
    if (!isRegistryPath(file, repoRoot)) {
      files.push(file);
      entries.set(file, line.slice(0, 2));
    }
  }
  if (files.length > 0) {
    const present = files.filter((file) => fs.existsSync(path.join(repoRoot, file)));
    const hashed = present.length
      ? git(repoRoot, ["hash-object", "--", ...present], { maxBuffer: 64 * 1024 * 1024 })
      : { status: 0, stdout: "" };
    const hashes = hashed.status === 0 ? hashed.stdout.split("\n") : [];
    present.forEach((file, index) => {
      entries.set(file, `${entries.get(file)}:${hashes[index] ?? "?"}`);
    });
  }
  return entries;
}

function headSha(repoRoot = REPO_ROOT) {
  const result = git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  return result.status === 0 ? result.stdout.trim() : "";
}

/** Before a shell command: what the tree and HEAD look like, for the comparison afterwards. */
function writePreSnapshot(repoRoot = REPO_ROOT, snapshotPath = preSnapshotPath("", repoRoot)) {
  const snapshot = {
    head: headSha(repoRoot),
    status: Object.fromEntries(statusOutsideRegistry(repoRoot)),
  };
  try {
    fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
  } catch {
    // Without a snapshot the post-command check falls back to the status alone.
  }
  return snapshot;
}

function readPreSnapshot(snapshotPath = preSnapshotPath("")) {
  try {
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    fs.rmSync(snapshotPath, { force: true });
    return snapshot;
  } catch {
    return null;
  }
}

/**
 * After a shell command: the paths outside the registry that the command changed. With a snapshot
 * from before it, that is every status entry that is new or different plus every file a commit
 * made since then touched; without one, whatever the tree now differs in.
 */
function changedPathsOutsideRegistry(repoRoot = REPO_ROOT, snapshot = null) {
  const now = statusOutsideRegistry(repoRoot);
  const changed = new Set();
  if (!snapshot) {
    for (const file of now.keys()) changed.add(file);
    return [...changed];
  }
  const before = snapshot.status ?? {};
  for (const [file, identity] of now) {
    if (before[file] !== identity) changed.add(file);
  }
  // Present before and gone now: put back to HEAD, or an untracked file removed.
  for (const file of Object.keys(before)) {
    if (!now.has(file)) changed.add(file);
  }
  const head = headSha(repoRoot);
  if (snapshot.head && head && snapshot.head !== head) {
    const diff = git(repoRoot, ["diff", "--name-only", `${snapshot.head}..${head}`]);
    if (diff.status === 0) {
      for (const file of diff.stdout.split("\n").filter(Boolean)) {
        if (!isRegistryPath(file, repoRoot)) changed.add(file);
      }
    }
  } else if (!snapshot.head && head) {
    // The command made the first commit of the repository.
    const listed = git(repoRoot, ["ls-tree", "-r", "--name-only", head]);
    for (const file of (listed.stdout || "").split("\n").filter(Boolean)) {
      if (!isRegistryPath(file, repoRoot)) changed.add(file);
    }
  }
  return [...changed];
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
  const snapshotPath = preSnapshotPath(input.session_id ?? "");
  if (process.argv.includes("--pre")) {
    if (!input.tool_name || SHELL_TOOLS.has(input.tool_name))
      writePreSnapshot(REPO_ROOT, snapshotPath);
    return;
  }
  let filePath = "";
  if (input.tool_name && SHELL_TOOLS.has(input.tool_name)) {
    const changed = changedPathsOutsideRegistry(REPO_ROOT, readPreSnapshot(snapshotPath));
    if (changed.length === 0) return;
    filePath = changed.length === 1 ? changed[0] : `${changed[0]} and ${changed.length - 1} more`;
  } else {
    if (input.tool_name && !EDIT_TOOLS.has(input.tool_name)) return;
    filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? "";
    if (isRegistryPath(filePath)) return;
    filePath = filePath ? path.relative(REPO_ROOT, path.resolve(REPO_ROOT, filePath)) : "";
  }

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

  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: message(result, filePath),
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
  changedPathsOutsideRegistry,
  evaluate,
  gitPath,
  preSnapshotPath,
  readPreSnapshot,
  writePreSnapshot,
  isRegistryPath,
  locateRegistry,
  message,
  readMarker,
  shouldReport,
  taskStatusOnMain,
};
