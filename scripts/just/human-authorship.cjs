#!/usr/bin/env node

/**
 * Human authorship gate (ORB-47 / T-261113-o9b, D13).
 *
 * - commit-msg / prepare-commit-msg: strip agent Co-authored-by / Claude-Session trailers;
 *   rewrite author/committer from the claimed task owner when running under Cursor Cloud.
 * - CI: every commit in base...head must use a participant author email; merge commits with
 *   committer GitHub <noreply@github.com> are allowed when the author is a participant.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  ALL_AUTHOR_EMAILS,
  displayNameForEmail,
  findParticipantByEmail,
  participantAuthorProblem,
  participantOwnerProblem,
  EXTRA_REJECTED_AGENT_MAILBOXES,
} = require("./participants.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function git(root, args) {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function normalizeLooseEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** Co-authored-by identities that are agent mailboxes — human co-authors stay. */
function isAgentCoAuthorIdentity(identity) {
  const text = String(identity ?? "").trim();
  if (!text) return false;
  const emailMatch = /<([^>]+)>/.exec(text);
  const email = normalizeLooseEmail(emailMatch ? emailMatch[1] : "");
  if (email) {
    if (EXTRA_REJECTED_AGENT_MAILBOXES.includes(email)) return true;
    if (email.includes("cursoragent@")) return true;
    if (email.endsWith("@anthropic.com")) return true;
    if (email.endsWith("@cursor.com") && !ALL_AUTHOR_EMAILS.has(email)) return true;
    // Participant noreply (Maxim) is human; other noreply agent boxes are not.
    if (ALL_AUTHOR_EMAILS.has(email)) return false;
    if (email.includes("noreply") && email !== "noreply@github.com") return true;
    return false;
  }
  // Name-only trailers: strip known agent labels.
  return /cursor\s*agent/i.test(text) || /^claude(\b|$)/i.test(text);
}

function lineIsAgentTrailer(line) {
  const trimmed = String(line).trim();
  if (/^Claude-Session:/i.test(trimmed)) return true;
  const co = /^Co-authored-by:\s*(.+)$/i.exec(trimmed);
  if (!co) return false;
  return isAgentCoAuthorIdentity(co[1]);
}

function readMarker(repoRoot = REPO_ROOT) {
  const result = git(repoRoot, ["rev-parse", "--git-path", "current-task"]);
  const markerPath =
    result.status === 0
      ? path.resolve(repoRoot, result.stdout.trim())
      : path.join(repoRoot, ".git", "current-task");
  try {
    const id = fs.readFileSync(markerPath, "utf8").trim();
    return id || null;
  } catch {
    return null;
  }
}

function locateRegistry(repoRoot = REPO_ROOT, env = process.env) {
  if (env.ORBIT_TASKS_ROOT) return path.resolve(env.ORBIT_TASKS_ROOT);
  if (env.ORBIT_TASKS_REGISTRY) return path.resolve(env.ORBIT_TASKS_REGISTRY);
  const sibling = path.resolve(repoRoot, "..", "orbit-tasks");
  if (fs.existsSync(path.join(sibling, "docs", "tasks"))) return sibling;
  // docs/tasks → <registry>/docs/tasks; ascend two levels to the repo root (task-claim-hook).
  try {
    const linked = fs.realpathSync(path.join(repoRoot, "docs", "tasks"));
    const root = path.resolve(linked, "..", "..");
    if (fs.existsSync(path.join(root, "docs", "tasks", "README.md"))) return root;
  } catch {
    /* absent */
  }
  return null;
}

function taskOwnerFromRegistry(taskId, registryRoot) {
  if (!taskId || !registryRoot) return null;
  const dir = path.join(registryRoot, "docs", "tasks");
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const file = names.find((n) => n.startsWith(`${taskId}-`) && n.endsWith(".md"));
  if (!file) return null;
  const text = fs.readFileSync(path.join(dir, file), "utf8");
  const match = /^owner:\s*(.+)$/m.exec(text);
  return match ? match[1].trim() : null;
}

function stripAgentTrailers(message) {
  const kept = String(message)
    .split(/\n/)
    .filter((line) => !lineIsAgentTrailer(line));
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function messageHasAgentTrailer(message) {
  return String(message)
    .split(/\n/)
    .some((line) => lineIsAgentTrailer(line));
}

function isCursorCloud(env = process.env) {
  return env.CURSOR_AGENT === "1" || env.CURSOR_CODE_REMOTE === "true";
}

function isAgentSession(env = process.env) {
  return (
    isCursorCloud(env) ||
    env.CLAUDE_CODE_REMOTE === "true" ||
    Boolean(env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || env.CODEX_CI === "1")
  );
}

/**
 * Identity to stamp on the next commit under Cursor Cloud: claim owner → participant name/email.
 * Prefer the claimable mailbox (gmail), not users.noreply, when both exist.
 */
function rewriteIdentityFromClaim(repoRoot = REPO_ROOT, env = process.env) {
  const taskId = readMarker(repoRoot);
  const registry = locateRegistry(repoRoot, env);
  const owner = taskOwnerFromRegistry(taskId, registry);
  if (!owner) {
    return {
      ok: false,
      message:
        "human-authorship: REFUSED. Cursor Cloud commit needs .git/current-task pointing at an " +
        "in-progress task whose owner is a participant email (claim first).",
    };
  }
  const claimProblem = participantOwnerProblem(owner);
  if (claimProblem) {
    return { ok: false, message: `human-authorship: REFUSED. ${claimProblem}` };
  }
  const participant = findParticipantByEmail(owner);
  const email = owner;
  const name = participant?.name || displayNameForEmail(owner) || "Orbit Participant";
  return { ok: true, name, email, taskId };
}

function applyRewriteEnv(identity) {
  process.env.GIT_AUTHOR_NAME = identity.name;
  process.env.GIT_AUTHOR_EMAIL = identity.email;
  process.env.GIT_COMMITTER_NAME = identity.name;
  process.env.GIT_COMMITTER_EMAIL = identity.email;
}

/** commit-msg hook: strip agent trailers; optionally rewrite identity under Cursor Cloud. */
function runCommitMsg(messagePath, { repoRoot = REPO_ROOT, env = process.env } = {}) {
  const original = fs.readFileSync(messagePath, "utf8");
  const cleaned = stripAgentTrailers(original);
  if (cleaned !== original) fs.writeFileSync(messagePath, `${cleaned}\n`);

  if (messageHasAgentTrailer(cleaned)) {
    return {
      ok: false,
      message: "human-authorship: REFUSED. Commit message still carries an agent trailer.",
    };
  }

  if (isCursorCloud(env)) {
    const identity = rewriteIdentityFromClaim(repoRoot, env);
    if (!identity.ok) return identity;
    // prepare-commit-msg / commit-msg cannot change author of the in-flight commit reliably;
    // export for a wrapper, and fail if current author is still an agent mailbox.
  }

  const author = git(repoRoot, ["var", "GIT_AUTHOR_IDENT"]).stdout || "";
  const emailMatch = /<([^>]+)>/.exec(author);
  const email = emailMatch ? emailMatch[1] : "";
  if (isCursorCloud(env)) {
    const identity = rewriteIdentityFromClaim(repoRoot, env);
    if (!identity.ok) return identity;
    const problem = participantAuthorProblem(email);
    if (problem && EXTRA_REJECTED_AGENT_MAILBOXES.includes(String(email).toLowerCase())) {
      // Cursor Cloud always starts as cursoragent — require the wrapper that sets GIT_* first.
      return {
        ok: false,
        message:
          `human-authorship: REFUSED. Author is still '${email}'. Re-run the commit with ` +
          `GIT_AUTHOR_* / GIT_COMMITTER_* set from the claimed task owner ` +
          `(${identity.name} <${identity.email}>), e.g. via scripts/just/git-commit-as-owner.cjs.`,
      };
    }
  }

  const authorProblem = participantAuthorProblem(email);
  if (authorProblem && isAgentSession(env)) {
    return { ok: false, message: `human-authorship: REFUSED. ${authorProblem}` };
  }
  if (authorProblem && !isAgentSession(env)) {
    return { ok: false, message: `human-authorship: REFUSED. ${authorProblem}` };
  }
  return { ok: true, message: "human-authorship: commit message ok" };
}

function parseIdent(ident) {
  const match = /^(.*)\s+<([^>]+)>\s+(\d+)\s+([+-]\d+)$/.exec(String(ident).trim());
  if (!match) {
    const loose = /<([^>]+)>/.exec(ident);
    return { name: "", email: loose ? loose[1] : "", raw: ident };
  }
  return { name: match[1], email: match[2], raw: ident };
}

function isGithubMergeCommitter(email, parents) {
  return (
    String(email).toLowerCase() === "noreply@github.com" &&
    Array.isArray(parents) &&
    parents.length >= 2
  );
}

/**
 * CI check over base...head. Each non-merge commit's author+committer must be participants.
 * Merge commits may use GitHub noreply committer when author is a participant.
 */
function checkRange(base, head, { repoRoot = REPO_ROOT } = {}) {
  const list = git(repoRoot, ["rev-list", `${base}..${head}`]);
  if (list.status !== 0) {
    return { ok: false, message: `human-authorship: cannot list ${base}..${head}` };
  }
  const shas = list.stdout
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const failures = [];
  for (const sha of shas) {
    const show = git(repoRoot, ["show", "-s", "--format=%H%n%an%n%ae%n%cn%n%ce%n%P%n%B", sha]);
    if (show.status !== 0) {
      failures.push(`${sha}: cannot read`);
      continue;
    }
    const lines = show.stdout.split(/\n/);
    const authorEmail = lines[2];
    const committerEmail = lines[4];
    const parents = (lines[5] || "").split(/\s/).filter(Boolean);
    const body = lines.slice(6).join("\n");
    if (messageHasAgentTrailer(body)) {
      failures.push(`${sha}: agent trailer in message`);
    }
    const authorProblem = participantAuthorProblem(authorEmail);
    if (authorProblem) failures.push(`${sha}: author ${authorProblem}`);
    if (isGithubMergeCommitter(committerEmail, parents)) {
      // allowed when author already checked
    } else {
      const committerProblem = participantAuthorProblem(committerEmail);
      if (committerProblem) failures.push(`${sha}: committer ${committerProblem}`);
    }
  }
  if (failures.length) {
    return {
      ok: false,
      message: `human-authorship: REFUSED.\n${failures.map((f) => `  - ${f}`).join("\n")}`,
    };
  }
  return {
    ok: true,
    message: `human-authorship: ${shas.length} commit(s) in range use participant identities`,
  };
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] === "--commit-msg") {
    const result = runCommitMsg(argv[1]);
    (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
    process.exit(result.ok ? 0 : 1);
  }
  if (argv[0] === "--check-range") {
    const base = argv[1];
    const head = argv[2] || "HEAD";
    const result = checkRange(base, head);
    (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
    process.exit(result.ok ? 0 : 1);
  }
  process.stderr.write(
    "Usage: human-authorship.cjs --commit-msg <path> | --check-range <base> [head]\n",
  );
  process.exit(2);
}

if (require.main === module) {
  main();
}

module.exports = {
  applyRewriteEnv,
  checkRange,
  isAgentCoAuthorIdentity,
  isAgentSession,
  isCursorCloud,
  isGithubMergeCommitter,
  lineIsAgentTrailer,
  locateRegistry,
  messageHasAgentTrailer,
  parseIdent,
  readMarker,
  rewriteIdentityFromClaim,
  runCommitMsg,
  stripAgentTrailers,
  taskOwnerFromRegistry,
};
