#!/usr/bin/env node

/**
 * Participant allowlist for Maxim/Igor process control (ORB-47 / T-261113-o9b, D14).
 * * Canonical twin of orbit-tasks/scripts/just/participants.cjs (Orbit CI has no registry checkout).
 *
 * Owner claims and git authorship may only name these people. Igor's real mailbox is unknown
 * until onboarding — do not invent one; keep the TODO slot empty so claims for him fail closed.
 */

/** @typedef {{ login: string, name: string, emails: string[], emailTodo?: string }} Participant */

/** @type {Participant[]} */
const PARTICIPANTS = [
  {
    login: "mpodreshetnikov",
    name: "Maxim Podreshetnikov",
    emails: ["mpodreshetnikov@gmail.com", "44291329+mpodreshetnikov@users.noreply.github.com"],
  },
  {
    login: "Kot-kAkos",
    name: "Igor",
    // TODO(D14): set Igor's real mailbox before onboarding claims. Do not invent an address.
    emails: [],
    emailTodo: "D14: Igor email unknown until onboarding",
  },
];

const OWNER_CLAIM_EMAILS = new Set(
  PARTICIPANTS.flatMap((p) =>
    p.emails.filter((e) => !e.toLowerCase().endsWith("@users.noreply.github.com")),
  ),
);

const ALL_AUTHOR_EMAILS = new Set(
  PARTICIPANTS.flatMap((p) => p.emails.map((e) => e.toLowerCase())),
);

const PARTICIPANT_LOGINS = new Set(PARTICIPANTS.map((p) => p.login.toLowerCase()));

/** Agent / unread mailboxes that still look like people under the coarse mailbox rules. */
const EXTRA_REJECTED_AGENT_MAILBOXES = [
  "cursoragent@cursor.com",
  "cursor@cursor.com",
  "noreply@anthropic.com",
  "claude@anthropic.com",
];

function normalizeEmail(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function findParticipantByEmail(email) {
  const needle = normalizeEmail(email);
  return PARTICIPANTS.find((p) => p.emails.some((e) => normalizeEmail(e) === needle)) ?? null;
}

function findParticipantByLogin(login) {
  const needle = String(login ?? "")
    .trim()
    .toLowerCase();
  return PARTICIPANTS.find((p) => p.login.toLowerCase() === needle) ?? null;
}

/**
 * Owner field for claims / registry: must be a participant mailbox people read (not noreply).
 * Returns an error string or null.
 */
function participantOwnerProblem(email) {
  const address = String(email ?? "").trim();
  if (!address) return "'owner' is required and must be a participant email";
  const lower = normalizeEmail(address);
  if (EXTRA_REJECTED_AGENT_MAILBOXES.includes(lower)) {
    return `'owner' is '${address}' — an agent mailbox. Pass a participant email (Maxim/Igor).`;
  }
  if (!OWNER_CLAIM_EMAILS.has(lower)) {
    const igor = PARTICIPANTS.find((p) => p.login === "Kot-kAkos");
    if (igor && igor.emails.length === 0) {
      return (
        `'owner' is '${address}' — not on the participant allowlist. ` +
        `Known claim emails: ${[...OWNER_CLAIM_EMAILS].join(", ")}. ` +
        `${igor.emailTodo}.`
      );
    }
    return (
      `'owner' is '${address}' — not on the participant allowlist ` +
      `(Maxim/Igor only). Known claim emails: ${[...OWNER_CLAIM_EMAILS].join(", ")}.`
    );
  }
  return null;
}

/**
 * Git author/committer email must be on the allowlist (includes GitHub noreply for Maxim).
 */
function participantAuthorProblem(email) {
  const address = String(email ?? "").trim();
  if (!address) return "commit author/committer email is empty";
  const lower = normalizeEmail(address);
  if (EXTRA_REJECTED_AGENT_MAILBOXES.includes(lower) || lower.includes("cursoragent@")) {
    return `'${address}' is an agent mailbox; commits must use a participant identity`;
  }
  if (!ALL_AUTHOR_EMAILS.has(lower)) {
    return (
      `'${address}' is not a participant author email. ` +
      `Allowlist: ${[...ALL_AUTHOR_EMAILS].join(", ") || "(empty — Igor email TODO)"}.`
    );
  }
  return null;
}

function isParticipantLogin(login) {
  return PARTICIPANT_LOGINS.has(
    String(login ?? "")
      .trim()
      .toLowerCase(),
  );
}

function displayNameForEmail(email) {
  return findParticipantByEmail(email)?.name ?? null;
}

module.exports = {
  ALL_AUTHOR_EMAILS,
  EXTRA_REJECTED_AGENT_MAILBOXES,
  OWNER_CLAIM_EMAILS,
  PARTICIPANTS,
  PARTICIPANT_LOGINS,
  displayNameForEmail,
  findParticipantByEmail,
  findParticipantByLogin,
  isParticipantLogin,
  normalizeEmail,
  participantAuthorProblem,
  participantOwnerProblem,
};
