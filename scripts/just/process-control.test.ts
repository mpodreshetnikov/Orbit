import { describe, expect, it } from "vitest";
import {
  EXTRA_REJECTED_AGENT_MAILBOXES,
  participantAuthorProblem,
  participantOwnerProblem,
} from "./participants.cjs";
import { evaluateCodeGate, hasSpecSection, isComplexTask } from "./spec-approve.cjs";
import { messageHasAgentTrailer, stripAgentTrailers } from "./human-authorship.cjs";

describe("participant allowlist (D9/D14)", () => {
  it("accepts Maxim claim email", () => {
    expect(participantOwnerProblem("mpodreshetnikov@gmail.com")).toBeNull();
  });

  it("refuses agent as executor/owner", () => {
    expect(participantOwnerProblem("cursoragent@cursor.com")).toMatch(/agent/i);
    expect(EXTRA_REJECTED_AGENT_MAILBOXES).toContain("cursoragent@cursor.com");
  });

  it("refuses a foreign human mailbox not on the allowlist", () => {
    expect(participantOwnerProblem("alice@example.com")).toMatch(/allowlist/i);
  });

  it("keeps Igor email as an explicit TODO (does not invent an address)", () => {
    expect(participantOwnerProblem("igor@example.com")).toMatch(/D14|allowlist/i);
  });

  it("allows Maxim GitHub noreply for authorship only", () => {
    expect(
      participantAuthorProblem("44291329+mpodreshetnikov@users.noreply.github.com"),
    ).toBeNull();
    expect(participantOwnerProblem("44291329+mpodreshetnikov@users.noreply.github.com")).toMatch(
      /allowlist|D14|noreply|participant/i,
    );
  });
});

describe("spec-approve fail-closed (D7)", () => {
  const maxim = "mpodreshetnikov@gmail.com";
  const complexTask = `---
id: T-261113-o9b
title: Example
status: in-progress
depth: execplan
owner: ${maxim}
tags: [needs-spec]
---

# Example

## Spec

Do the thing.
`;

  it("refuses complex task with no ## Spec", () => {
    const result = evaluateCodeGate({
      taskText: `---
id: T-1
depth: execplan
owner: ${maxim}
---

# No spec here
`,
      ownerEmail: maxim,
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("no-spec");
  });

  it("refuses complex task with no second-participant approve", () => {
    const result = evaluateCodeGate({
      taskText: complexTask,
      ownerEmail: maxim,
      approvals: [{ login: "mpodreshetnikov" }],
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("no-second-approve");
  });

  it("refuses when the actor is not the owner (foreign task)", () => {
    const result = evaluateCodeGate({
      taskText: complexTask,
      ownerEmail: maxim,
      actorEmail: "alice@example.com",
      approvals: [{ login: "Kot-kAkos" }],
    });
    expect(result.ok).toBe(false);
    expect(["foreign-task", "not-self"]).toContain(result.code);
  });

  it("refuses agent as executor", () => {
    const result = evaluateCodeGate({
      taskText: complexTask,
      ownerEmail: maxim,
      isAgentExecutor: true,
      approvals: [{ login: "Kot-kAkos" }],
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("agent-executor");
  });

  it("passes when the other participant approved a complex task with a Spec", () => {
    expect(isComplexTask({ depth: "execplan", tags: ["needs-spec"] }, "")).toBe(true);
    expect(hasSpecSection(complexTask)).toBe(true);
    const result = evaluateCodeGate({
      taskText: complexTask,
      ownerEmail: maxim,
      actorEmail: maxim,
      approvals: [{ login: "Kot-kAkos" }],
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe("approved");
  });

  it("does not require second approve on a simple task", () => {
    const result = evaluateCodeGate({
      taskText: `---
id: T-2
depth: note
owner: ${maxim}
---

# Simple
`,
      ownerEmail: maxim,
      actorEmail: maxim,
    });
    expect(result.ok).toBe(true);
    expect(result.code).toBe("simple");
  });
});

describe("human-authorship trailers (D13)", () => {
  it("strips agent Co-authored-by trailers", () => {
    const raw = "Subject\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>\n";
    expect(messageHasAgentTrailer(raw)).toBe(true);
    expect(stripAgentTrailers(raw)).not.toMatch(/Co-authored-by/i);
  });

  it("keeps legitimate human Co-authored-by trailers", () => {
    const raw = "Subject\n\nCo-authored-by: Maxim Podreshetnikov <mpodreshetnikov@gmail.com>\n";
    expect(messageHasAgentTrailer(raw)).toBe(false);
    expect(stripAgentTrailers(raw)).toContain("Co-authored-by: Maxim Podreshetnikov");
  });

  it("still strips Claude-Session trailers", () => {
    const raw = "Subject\n\nClaude-Session: abc\n";
    expect(messageHasAgentTrailer(raw)).toBe(true);
    expect(stripAgentTrailers(raw)).not.toMatch(/Claude-Session/i);
  });
});
