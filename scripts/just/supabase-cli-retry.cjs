#!/usr/bin/env node
/**
 * Runs a Supabase CLI command, retrying the one failure that is not ours.
 *
 * `supabase start` and `supabase db reset` fail on this repository's CI roughly six times in ten,
 * always the same way and always *after* every migration and `seed.sql` have applied:
 *
 *     supabase_edge_runtime_orbit container logs:
 *     Stopping containers...
 *     Error status 502: An invalid response was received from the upstream server
 *
 * Reproduced locally, the shape is unambiguous. At the moment the CLI gives up, the edge runtime
 * container is `running` with exit code 0 and has written **no log output at all** — the CLI
 * prints its logs to explain the failure and there is nothing to print, because the runtime has
 * not finished booting. The 502 comes from the readiness probe reaching the API gateway before
 * the runtime is listening, and the CLI treats that first refusal as fatal rather than waiting.
 *
 * So the retry is bounded and *narrow*: only this signature is retried, and only after the CLI
 * has already torn its own stack down, which makes a fresh attempt clean by construction. A
 * migration error, a syntax error in the seed, a port collision — anything else — fails on the
 * first attempt exactly as before. Retrying every failure would turn a broken migration into a
 * slow broken migration, which is the opposite of what this repository learned the hard way.
 *
 *   node scripts/just/supabase-cli-retry.cjs start
 *   node scripts/just/supabase-cli-retry.cjs db reset --yes
 */

const { spawn } = require("child_process");

/** The readiness failure, and nothing else. */
const RETRYABLE_PATTERN = /Error status 502/;
const MAX_ATTEMPTS = 3;
/** Long enough for a runtime that was still booting to have finished. */
const BACKOFF_MS = [5000, 15000];

function runCommand(command, args, { onChunk }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"] });
    let combined = "";

    const forward = (stream, sink) => {
      stream.on("data", (chunk) => {
        const text = chunk.toString();
        combined += text;
        // Echoed as it arrives: a CI log that only appears after a three-attempt failure is
        // useless for telling which attempt failed and how.
        sink.write(text);
        onChunk?.(text);
      });
    };

    forward(child.stdout, process.stdout);
    forward(child.stderr, process.stderr);

    child.on("error", (error) => resolve({ status: 1, combined: `${combined}\n${error.message}` }));
    child.on("close", (code) => resolve({ status: code ?? 1, combined }));
  });
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(output) {
  return RETRYABLE_PATTERN.test(output);
}

/**
 * The retry loop itself, with the two things that make it slow and external — running a command
 * and waiting — passed in. That is what lets the loop be tested for the property that matters:
 * that it retries the readiness 502 and nothing else, a fixed number of times.
 */
async function runWithRetry({ args, run, sleep: wait = sleep, log = console.error }) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = await run(args, attempt);
    if (result.status === 0) return { status: 0, attempts: attempt };

    if (!isRetryable(result.combined)) {
      log(
        `[supabase-cli-retry] \`supabase ${args.join(" ")}\` failed for a reason this does not ` +
          `retry. Exiting with the CLI's status.`,
      );
      return { status: result.status, attempts: attempt };
    }

    if (attempt === MAX_ATTEMPTS) {
      log(
        `[supabase-cli-retry] the edge-runtime readiness 502 persisted across ${MAX_ATTEMPTS} ` +
          `attempts, so it is no longer a race. See T-260829-hhj.`,
      );
      return { status: result.status, attempts: attempt };
    }

    const backoff = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
    log(
      `[supabase-cli-retry] attempt ${attempt}/${MAX_ATTEMPTS} hit the edge-runtime readiness ` +
        `502 after the migrations had applied; retrying in ${backoff / 1000}s. See T-260829-hhj.`,
    );
    await wait(backoff);
  }

  return { status: 1, attempts: MAX_ATTEMPTS };
}

async function main(argv) {
  const args = argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: supabase-cli-retry.cjs <supabase cli args...>");
    return 1;
  }

  const { status } = await runWithRetry({
    args,
    run: (cliArgs) => runCommand("npx", ["supabase", ...cliArgs], {}),
  });
  return status;
}

if (require.main === module) {
  main(process.argv)
    .then((status) => process.exit(status))
    .catch((error) => {
      console.error(`[supabase-cli-retry] ${error.message}`);
      process.exit(1);
    });
}

module.exports = { isRetryable, runWithRetry, MAX_ATTEMPTS, BACKOFF_MS, RETRYABLE_PATTERN };
