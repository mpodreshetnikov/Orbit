#!/usr/bin/env node

/**
 * A Claude Code `SessionStart` hook that asks the agent to answer in caveman mode at level `full`
 * for the whole session -- terse phrasing, no filler, technical substance untouched.
 *
 * This is a hook rather than a line in AGENTS.md because activating a skill is an action taken at a
 * point in the session's lifecycle, and only the harness can fire on that event. Guidance in a
 * memory file describes how to work; it cannot switch a mode on before the first reply.
 *
 * The instruction is conditional on the skill actually being present. `caveman` is an account-level
 * skill synced from claude.ai, not one of the repo's vendored `.claude/skills`, so a clone made by
 * someone without it must see this as a silent no-op -- and specifically must not improvise a
 * caveman voice of its own, which would be the style without the rules that keep it accurate.
 *
 * Any failure here is silent and exits 0. A hook that breaks session startup over a formatting
 * preference is worse than the preference going unapplied.
 */

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

function main() {
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

module.exports = { CONTEXT };
