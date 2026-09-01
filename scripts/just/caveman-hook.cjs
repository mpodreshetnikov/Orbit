#!/usr/bin/env node

/**
 * A Claude Code `SessionStart` hook that asks the agent to answer in caveman mode at level `full` --
 * terse phrasing, no filler, technical substance untouched.
 *
 * This is a hook rather than a line in AGENTS.md because activating a skill is an action taken at a
 * point in the session's lifecycle, and only the harness can fire on that event. Guidance in a
 * memory file describes how to work; it cannot switch a mode on before the first reply.
 *
 * `SessionStart` fires for four sources, and only two of them start a new conversation. On `resume`
 * and `compact` the conversation continues, so a user who already said `/caveman off` or `lite` is
 * still in it -- re-injecting the default there would quietly undo their choice at the moment a
 * long session compacts, which is the moment it would be least obvious. Those two are skipped.
 *
 * The instruction is conditional on the skill actually being present. `caveman` is an account-level
 * skill synced from claude.ai, not one of the repo's vendored `.claude/skills`, so a clone made by
 * someone without it must see this as a silent no-op -- and specifically must not improvise a
 * caveman voice of its own, which would be the style without the rules that keep it accurate.
 *
 * Any failure here is silent and exits 0. A hook that breaks session startup over a formatting
 * preference is worse than the preference going unapplied.
 */

const fs = require("fs");

/** Sources that begin a fresh conversation, where no earlier level choice can be overridden. */
const ACTIVATING_SOURCES = new Set(["startup", "clear"]);

const CONTEXT = [
  "Caveman mode is requested for this session at level **full**.",
  'If a skill named "caveman" is available in this session, invoke the Skill tool with skill',
  '"caveman" and args "full" before answering the first user message, then follow that skill for',
  "the rest of the session.",
  "If no such skill is listed, ignore this note entirely and respond normally -- do not mention it",
  "and do not improvise a caveman style of your own.",
  "The user can change the level any time with /caveman lite|full|ultra|off, or turn it off by",
  'saying "stop caveman" / "normal mode".',
].join(" ");

/**
 * @param {string} input Raw hook payload from stdin.
 * @returns {boolean} Whether this start should activate caveman mode.
 */
function shouldActivate(input) {
  let source;
  try {
    source = JSON.parse(input).source;
  } catch {
    // An unreadable payload says nothing about the source. Treat it as a plain startup rather than
    // losing the mode entirely: a spurious activation is recoverable, a hook that never fires is
    // just broken.
    return true;
  }

  return typeof source === "string" ? ACTIVATING_SOURCES.has(source) : true;
}

function main() {
  let input = "";
  try {
    input = fs.readFileSync(0, "utf8");
  } catch {
    // No stdin available; fall through with an empty payload.
  }

  if (!shouldActivate(input)) {
    return;
  }

  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: CONTEXT,
      },
      suppressOutput: true,
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

module.exports = { ACTIVATING_SOURCES, CONTEXT, shouldActivate };
