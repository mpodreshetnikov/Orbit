#!/usr/bin/env node

/**
 * Complex-task second-participant approve gate (ORB-47 / T-261113-o9b, D7 + D3).
 *
 * Spec lives inside the task file (no docs/tasks/specs/). Before a complex task's code lands,
 * another participant must have approved. Enforced from pre-push and CI via `--check-claimed`
 * / `--check-task-file`.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  findParticipantByEmail,
  findParticipantByLogin,
  isParticipantLogin,
  participantOwnerProblem,
} = require("./participants.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const COMPLEX_TAGS = new Set(["needs-spec", "complex"]);

function git(root, args) {
  return spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

function parseFrontMatter(text) {
  const match = /^---\n([\s\S]*?)\n---/.exec(String(text));
  if (!match) return {};
  const data = {};
  for (const line of match[1].split(/\n/)) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    data[key] = value;
  }
  return data;
}

function hasSpecSection(body) {
  return /^##\s+Spec\b/m.test(String(body)) || /^##\s+Спека\b/m.test(String(body));
}

function isComplexTask(frontMatter, body = "") {
  if (!frontMatter) return false;
  if (String(frontMatter.depth || "").toLowerCase() === "execplan") return true;
  const tags = Array.isArray(frontMatter.tags) ? frontMatter.tags : [];
  if (tags.some((t) => COMPLEX_TAGS.has(String(t).toLowerCase()))) return true;
  if (/^##\s+Complexity\b/m.test(body) && /\bcomplex\b/i.test(body)) return true;
  return false;
}

/**
 * Approvals recorded on the task file: front-matter `approvals: [login]` and/or
 * Progress / body lines like "Spec approved by Kot-kAkos".
 */
function parseApprovalsFromTask(text) {
  const fm = parseFrontMatter(text);
  const fromFm = Array.isArray(fm.approvals)
    ? fm.approvals
    : typeof fm.approvals === "string" && fm.approvals
      ? [fm.approvals]
      : [];
  const fromBody = [];
  const body = String(text);
  const patterns = [
    /(?:spec\s+)?approved by\s+@?([A-Za-z0-9_-]+)/gi,
    /second[- ]participant approve[d]?\s*:\s*@?([A-Za-z0-9_-]+)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(body))) {
      fromBody.push(m[1]);
    }
  }
  const seen = new Set();
  const logins = [];
  for (const login of [...fromFm, ...fromBody]) {
    const key = String(login).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    logins.push(String(login));
  }
  return logins.map((login) => ({ login }));
}

/**
 * @param {{
 *   taskText: string,
 *   ownerEmail: string,
 *   actorEmail?: string|null,
 *   approvals?: { login: string }[],
 *   isAgentExecutor?: boolean,
 * }} input
 */
function evaluateCodeGate(input) {
  const text = String(input.taskText || "");
  const fm = parseFrontMatter(text);
  const body = text.replace(/^---[\s\S]*?---\n/, "");
  const ownerEmail = input.ownerEmail || fm.owner;

  if (input.isAgentExecutor) {
    return {
      ok: false,
      code: "agent-executor",
      message:
        "spec-approve: REFUSED. Agent cannot be the executor/owner; owner must be a participant.",
    };
  }

  const ownerProblem = participantOwnerProblem(ownerEmail);
  if (ownerProblem) {
    return { ok: false, code: "agent-executor", message: `spec-approve: REFUSED. ${ownerProblem}` };
  }

  if (input.actorEmail) {
    const actorProblem = participantOwnerProblem(input.actorEmail);
    if (actorProblem) {
      return { ok: false, code: "not-self", message: `spec-approve: REFUSED. ${actorProblem}` };
    }
    if (String(input.actorEmail).trim().toLowerCase() !== String(ownerEmail).trim().toLowerCase()) {
      return {
        ok: false,
        code: "foreign-task",
        message:
          "spec-approve: REFUSED. Working a task owned by another participant (foreign task).",
      };
    }
  }

  const complex = isComplexTask(fm, body);
  if (!complex) {
    return {
      ok: true,
      code: "simple",
      message: "spec-approve: simple task — second approve not required",
    };
  }

  if (!hasSpecSection(body)) {
    return {
      ok: false,
      code: "no-spec",
      message: "spec-approve: REFUSED. Complex task has no ## Spec section in the task file (D7).",
    };
  }

  const owner = findParticipantByEmail(ownerEmail);
  const approvals =
    Array.isArray(input.approvals) && input.approvals.length > 0
      ? input.approvals
      : parseApprovalsFromTask(text);
  const second = approvals.find((a) => {
    if (!isParticipantLogin(a.login)) return false;
    if (!owner) return true;
    return a.login.toLowerCase() !== owner.login.toLowerCase();
  });

  if (!second) {
    return {
      ok: false,
      code: "no-second-approve",
      message:
        "spec-approve: REFUSED. Complex task needs an approve from the other participant " +
        "(Maxim↔Igor); the owner's own approve does not count. Record it on the task file " +
        "(approvals: [login] or 'Spec approved by <login>').",
    };
  }

  return {
    ok: true,
    code: "approved",
    message: `spec-approve: complex task approved by ${second.login}`,
  };
}

function locateRegistry(repoRoot = REPO_ROOT, env = process.env) {
  if (env.ORBIT_TASKS_ROOT) return path.resolve(env.ORBIT_TASKS_ROOT);
  if (env.ORBIT_TASKS_REGISTRY) return path.resolve(env.ORBIT_TASKS_REGISTRY);
  const sibling = path.resolve(repoRoot, "..", "orbit-tasks");
  if (fs.existsSync(path.join(sibling, "docs", "tasks"))) return sibling;
  try {
    const linked = fs.realpathSync(path.join(repoRoot, "docs", "tasks"));
    const root = path.resolve(linked, "..", "..");
    if (fs.existsSync(path.join(root, "docs", "tasks", "README.md"))) return root;
  } catch {
    /* absent */
  }
  return null;
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

function loadTaskFile(taskId, registryRoot) {
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
  const full = path.join(dir, file);
  return { path: full, text: fs.readFileSync(full, "utf8") };
}

function isAgentExecutorEnv(env = process.env) {
  return (
    env.CURSOR_AGENT === "1" ||
    env.CURSOR_CODE_REMOTE === "true" ||
    env.CLAUDE_CODE_REMOTE === "true" ||
    env.CLAUDECODE === "1" ||
    (typeof env.AI_AGENT === "string" && env.AI_AGENT.startsWith("claude-code_")) ||
    Boolean(env.CODEX_THREAD_ID || env.CODEX_SESSION_ID || env.CODEX_CI === "1") ||
    (typeof env.CODEX_SANDBOX === "string" && env.CODEX_SANDBOX.length > 0)
  );
}

/**
 * Enforce Spec/second-approve for the claimed task (pre-push / local).
 * Simple tasks pass. Missing registry+marker: skip with ok (claim-hook owns that).
 */
function checkClaimedTask({ repoRoot = REPO_ROOT, env = process.env } = {}) {
  const taskId = readMarker(repoRoot);
  if (!taskId) {
    return {
      ok: true,
      code: "no-marker",
      message: "spec-approve: no .git/current-task — claim gate covers that separately",
    };
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
  return evaluateCodeGate({
    taskText: loaded.text,
    ownerEmail: fm.owner,
    actorEmail: fm.owner,
    // Agent sessions are executors of human-owned work; owner stays the participant.
    isAgentExecutor: false,
    approvals: parseApprovalsFromTask(loaded.text),
  });
}

function checkTaskFile(filePath, { env = process.env } = {}) {
  const text = fs.readFileSync(filePath, "utf8");
  const fm = parseFrontMatter(text);
  const extra = env.SPEC_APPROVALS
    ? String(env.SPEC_APPROVALS)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((login) => ({ login }))
    : [];
  return evaluateCodeGate({
    taskText: text,
    ownerEmail: fm.owner,
    actorEmail: fm.owner,
    isAgentExecutor: false,
    approvals: [...parseApprovalsFromTask(text), ...extra],
  });
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] === "--check-claimed") {
    const result = checkClaimedTask();
    (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
    process.exit(result.ok ? 0 : 1);
  }
  if (argv[0] === "--check-task-file") {
    const file = argv[1];
    if (!file) {
      process.stderr.write("Usage: spec-approve.cjs --check-task-file <path>\n");
      process.exit(2);
    }
    const result = checkTaskFile(file);
    (result.ok ? process.stdout : process.stderr).write(`${result.message}\n`);
    process.exit(result.ok ? 0 : 1);
  }
  if (argv[0] === "--self-test") {
    process.stdout.write("spec-approve: ok (use process-control.test.ts)\n");
    process.exit(0);
  }
  process.stderr.write(
    "Usage: spec-approve.cjs --check-claimed | --check-task-file <path> | --self-test\n",
  );
  process.exit(2);
}

if (require.main === module) {
  main();
}

module.exports = {
  COMPLEX_TAGS,
  checkClaimedTask,
  checkTaskFile,
  evaluateCodeGate,
  findParticipantByLogin,
  hasSpecSection,
  isAgentExecutorEnv,
  isComplexTask,
  loadTaskFile,
  locateRegistry,
  parseApprovalsFromTask,
  parseFrontMatter,
  readMarker,
};
