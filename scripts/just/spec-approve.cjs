#!/usr/bin/env node

/**
 * Complex-task second-participant approve gate (ORB-47 / T-261113-o9b, D7 + D3).
 *
 * Spec lives inside the task file (no docs/tasks/specs/). Before a complex task's code lands,
 * another participant must have approved a task-file-only change. Fail-closed helpers below are
 * unit-tested; CI/pre-push call `evaluateCodeGate`.
 */

const {
  findParticipantByEmail,
  findParticipantByLogin,
  isParticipantLogin,
  participantOwnerProblem,
} = require("./participants.cjs");

const COMPLEX_TAGS = new Set(["needs-spec", "complex"]);

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
  // Explicit complexity markers from design C.0 recorded in the task body.
  if (/^##\s+Complexity\b/m.test(body) && /\bcomplex\b/i.test(body)) return true;
  return false;
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
  const approvals = Array.isArray(input.approvals) ? input.approvals : [];
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
        "(Maxim↔Igor); the owner's own approve does not count.",
    };
  }

  return {
    ok: true,
    code: "approved",
    message: `spec-approve: complex task approved by ${second.login}`,
  };
}

function main(argv = process.argv.slice(2)) {
  if (argv[0] !== "--self-test") {
    process.stderr.write("Usage: spec-approve.cjs --self-test\n");
    process.exit(2);
  }
  process.stdout.write("spec-approve: library only; see process-control.test.ts\n");
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  COMPLEX_TAGS,
  evaluateCodeGate,
  findParticipantByLogin,
  hasSpecSection,
  isComplexTask,
  parseFrontMatter,
};
