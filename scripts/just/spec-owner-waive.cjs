/**
 * Owner Spec waive (T-261028-yhm polish): "Spec waived by <owner-login>".
 * Kept outside spec-approve.cjs so that large module can stay identical to main
 * under incremental mutation; pre-push / CI call spec-approve-gate.cjs instead.
 */
"use strict";

const { findParticipantByEmail } = require("./participants.cjs");

/**
 * @param {string} text
 * @param {string|null|undefined} ownerEmail
 * @returns {{ login: string } | null}
 */
function parseOwnerSpecWaive(text, ownerEmail) {
  const owner = findParticipantByEmail(ownerEmail);
  if (!owner) return null;
  const re = /spec\s+waived\s+by\s+@?([A-Za-z0-9_-]+)/gi;
  let m;
  while ((m = re.exec(String(text)))) {
    if (m[1].toLowerCase() === owner.login.toLowerCase()) {
      return { login: owner.login };
    }
  }
  return null;
}

/**
 * After evaluateCodeGate fails for missing Spec / second approve, honour an owner waive.
 * Other refusals (agent executor, foreign task, …) stay refused.
 *
 * @param {{ ok: boolean, code: string, message: string }} gateResult
 * @param {{ taskText?: string, ownerEmail?: string|null }} input
 */
function applyOwnerSpecWaive(gateResult, input) {
  if (gateResult.ok) return gateResult;
  if (gateResult.code !== "no-spec" && gateResult.code !== "no-second-approve") {
    return gateResult;
  }
  const waive = parseOwnerSpecWaive(input.taskText || "", input.ownerEmail);
  if (!waive) return gateResult;
  return {
    ok: true,
    code: "waived",
    message: `spec-approve: Spec waived by owner ${waive.login}`,
  };
}

/**
 * @param {(input: object) => { ok: boolean, code: string, message: string }} evaluateCodeGate
 * @param {object} input
 */
function evaluateCodeGateWithOwnerWaive(evaluateCodeGate, input) {
  return applyOwnerSpecWaive(evaluateCodeGate(input), input);
}

module.exports = {
  parseOwnerSpecWaive,
  applyOwnerSpecWaive,
  evaluateCodeGateWithOwnerWaive,
};
