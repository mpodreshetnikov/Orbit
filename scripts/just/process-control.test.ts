import { describe, expect, it } from "vitest";
import {
  ALL_AUTHOR_EMAILS,
  EXTRA_REJECTED_AGENT_MAILBOXES,
  OWNER_CLAIM_EMAILS,
  displayNameForEmail,
  findParticipantByEmail,
  findParticipantByLogin,
  isParticipantLogin,
  normalizeEmail,
  participantAuthorProblem,
  participantOwnerProblem,
} from "./participants.cjs";
import { evaluateCodeGate, hasSpecSection, isComplexTask } from "./spec-approve.cjs";
import { messageHasAgentTrailer, stripAgentTrailers } from "./human-authorship.cjs";

describe("participant allowlist (D9/D14)", () => {
  it("accepts Maxim claim email", () => {
    expect(participantOwnerProblem("mpodreshetnikov@gmail.com")).toBeNull();
  });

  it("matches claim emails case-insensitively via lowercased OWNER_CLAIM_EMAILS", () => {
    expect(participantOwnerProblem("MPodreshetnikov@Gmail.COM")).toBeNull();
    expect(OWNER_CLAIM_EMAILS.has("mpodreshetnikov@gmail.com")).toBe(true);
    expect(OWNER_CLAIM_EMAILS.has("MPodreshetnikov@Gmail.COM")).toBe(false);
  });

  it("normalizeEmail trims, lowercases, and stringifies nullish", () => {
    expect(normalizeEmail("  A@B.C  ")).toBe("a@b.c");
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });

  it("findParticipantByEmail matches case-insensitively and rejects unknown", () => {
    expect(findParticipantByEmail("MPodreshetnikov@Gmail.COM")?.login).toBe("mpodreshetnikov");
    expect(findParticipantByEmail("nobody@example.com")).toBeNull();
  });

  it("findParticipantByLogin and isParticipantLogin are case-insensitive", () => {
    expect(findParticipantByLogin("MPODRESHETNIKOV")?.name).toBe("Maxim Podreshetnikov");
    expect(findParticipantByLogin("Kot-kAkos")?.name).toBe("Igor");
    expect(isParticipantLogin("mpodreshetnikov")).toBe(true);
    expect(isParticipantLogin("nope")).toBe(false);
    expect(isParticipantLogin(null)).toBe(false);
  });

  it("displayNameForEmail resolves Maxim and returns null for unknown", () => {
    expect(displayNameForEmail("mpodreshetnikov@gmail.com")).toBe("Maxim Podreshetnikov");
    expect(displayNameForEmail("ghost@example.com")).toBeNull();
  });

  it("refuses empty owner and agent mailboxes with exact problem text", () => {
    expect(participantOwnerProblem("")).toBe("'owner' is required and must be a participant email");
    expect(participantOwnerProblem("   ")).toBe(
      "'owner' is required and must be a participant email",
    );
    expect(participantOwnerProblem("cursoragent@cursor.com")).toBe(
      "'owner' is 'cursoragent@cursor.com' — an agent mailbox. Pass a participant email (Maxim/Igor).",
    );
    expect(EXTRA_REJECTED_AGENT_MAILBOXES).toContain("cursoragent@cursor.com");
    expect(EXTRA_REJECTED_AGENT_MAILBOXES).toContain("cursor@cursor.com");
  });

  it("refuses a foreign human mailbox with Igor TODO guidance", () => {
    const msg = participantOwnerProblem("alice@example.com");
    expect(msg).toContain("'owner' is 'alice@example.com' — not on the participant allowlist.");
    expect(msg).toContain("Known claim emails: mpodreshetnikov@gmail.com.");
    expect(msg).toContain("D14: Igor email unknown until onboarding");
  });

  it("allows Maxim GitHub noreply for authorship only", () => {
    expect(
      participantAuthorProblem("44291329+mpodreshetnikov@users.noreply.github.com"),
    ).toBeNull();
    expect(ALL_AUTHOR_EMAILS.has("44291329+mpodreshetnikov@users.noreply.github.com")).toBe(true);
    expect(participantOwnerProblem("44291329+mpodreshetnikov@users.noreply.github.com")).toContain(
      "not on the participant allowlist",
    );
  });

  it("refuses empty and agent authors with exact text", () => {
    expect(participantAuthorProblem("")).toBe("commit author/committer email is empty");
    expect(participantAuthorProblem("cursoragent@cursor.com")).toBe(
      "'cursoragent@cursor.com' is an agent mailbox; commits must use a participant identity",
    );
    expect(participantAuthorProblem("x+cursoragent@example.com")).toMatch(/agent mailbox/);
    expect(participantAuthorProblem("alice@example.com")).toBe(
      "'alice@example.com' is not a participant author email. Allowlist: mpodreshetnikov@gmail.com, 44291329+mpodreshetnikov@users.noreply.github.com.",
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
