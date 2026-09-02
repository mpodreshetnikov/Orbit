import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as checkReviewDelta from "./check-review-delta.cjs";
import * as checkPrSize from "./check-pr-size.cjs";

const { evaluateReviewDelta, formatReport, parseArgs, sensitiveAmong } = checkReviewDelta;
const { parseAllowlist } = checkPrSize;

const FIXTURE_RATIONALE = "recorded upstream responses, verified by replay rather than by reading";
const ALLOWLIST = `path test/fixtures/** # ${FIXTURE_RATIONALE}`;

function numstat(rows: [number | "-", number | "-", string][]) {
  return rows.map(([added, deleted, file]) => `${added}\t${deleted}\t${file}`).join("\n");
}

function evaluate(
  rows: [number | "-", number | "-", string][],
  options: { allowlist?: string; threshold?: number } = {},
) {
  return evaluateReviewDelta({
    numstat: numstat(rows),
    allowlist: parseAllowlist(options.allowlist ?? ALLOWLIST),
    threshold: options.threshold,
  });
}

describe("volume", () => {
  it("asks for no review when the delta is small and touches nothing sensitive", () => {
    const result = evaluate([[40, 12, "src/lib/format.ts"]]);

    expect(result.request).toBe(false);
    expect(result.addedLines).toBe(40);
  });

  it("asks for one once the delta is bigger than a change that drew findings here", () => {
    expect(evaluate([[651, 0, "src/lib/big.ts"]]).request).toBe(true);
  });

  it("treats the floor as inclusive, so exactly the floor does not ask", () => {
    expect(evaluate([[200, 0, "src/a.ts"]]).request).toBe(false);
    expect(evaluate([[201, 0, "src/a.ts"]]).request).toBe(true);
  });

  it("counts added lines only, so a large deletion does not buy a review on its own", () => {
    expect(evaluate([[10, 5000, "src/legacy.ts"]]).request).toBe(false);
  });

  it("does not count a lockfile toward the delta", () => {
    const result = evaluate([
      [40000, 20000, "package-lock.json"],
      [10, 0, "package.json"],
    ]);

    expect(result.addedLines).toBe(10);
    expect(result.request).toBe(false);
  });

  it("does not count the generated skill mirror twice with its source", () => {
    const result = evaluate([
      [150, 0, ".agents/skills/x/SKILL.md"],
      [150, 0, ".claude/skills/x/SKILL.md"],
    ]);

    expect(result.addedLines).toBe(150);
  });
});

describe("sensitive surfaces", () => {
  it("asks for a review on a migration however small", () => {
    const result = evaluate([[3, 0, "supabase/migrations/20260830120000_add_column.sql"]]);

    expect(result.request).toBe(true);
    expect(result.reasons.join(" ")).toContain("schema applied to production");
  });

  it("asks on a one-line change to an OAuth endpoint", () => {
    expect(evaluate([[1, 1, "src/app/api/oauth/token/route.ts"]]).request).toBe(true);
  });

  it("asks on a workflow change, which is where the deploy and the secrets live", () => {
    expect(evaluate([[2, 0, ".github/workflows/main.yml"]]).request).toBe(true);
  });

  it("asks on the connector that scrapes and scrubs upstream data", () => {
    expect(evaluate([[5, 0, "browserExtension/src/connectors/tbank-web.ts"]]).request).toBe(true);
  });

  it("asks on a recorded fixture even though it is excluded from the line count", () => {
    // The #18 case: 112k lines of cassette carrying personal data, allowlisted as not reviewable.
    // Excluding it from the count is right; letting that exclusion also hide it here would not be.
    const result = evaluate([[112000, 0, "test/fixtures/tbank/cassettes/dense-month/ops.json"]]);

    expect(result.addedLines).toBe(0);
    expect(result.request).toBe(true);
    expect(result.reasons.join(" ")).toContain("recorded upstream data");
  });

  it("does not treat an ordinary source file as sensitive", () => {
    expect(evaluate([[5, 0, "src/components/Button.tsx"]]).request).toBe(false);
  });

  it("does not fire on a filename that merely contains a sensitive-looking word", () => {
    expect(sensitiveAmong([{ path: "src/lib/tokenizer.ts", added: 5 }])).toEqual([]);
    expect(sensitiveAmong([{ path: "src/lib/author.ts", added: 5 }])).toEqual([]);
  });

  it("reports every sensitive file, not just the first", () => {
    const result = evaluate([
      [1, 0, "supabase/migrations/20260830120000_a.sql"],
      [1, 0, "src/app/auth/callback/route.ts"],
    ]);

    expect(result.sensitive).toHaveLength(2);
  });
});

describe("reporting", () => {
  it("names the largest files, because those are what a reviewer would spend its pass on", () => {
    const result = evaluate([
      [50, 0, "src/small.ts"],
      [400, 0, "src/huge.ts"],
    ]);

    expect(result.largest[0]).toEqual({ path: "src/huge.ts", added: 400 });
  });

  it("says nothing changed rather than asking, on an empty delta", () => {
    const result = evaluate([]);

    expect(result.request).toBe(false);
    expect(result.files).toBe(0);
  });

  it("quotes the budget docs/QUALITY.md sets, so the command cannot hand a branch over a round early", () => {
    const report = formatReport(evaluate([[10, 0, "src/small.ts"]]), "abc123");

    expect(report).toContain(
      "at most three requested reviews beyond the one the pull request opened with",
    );
    expect(report).not.toContain("at most two requested reviews");
  });
});

describe("argument handling", () => {
  const script = path.join(__dirname, "check-review-delta.cjs");

  function runScript(args: string[], env: Record<string, string> = {}) {
    return spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, REVIEW_DELTA_SINCE: "", ...env },
    });
  }

  it("reads an explicit ref", () => {
    expect(parseArgs(["--since", "abc123"])).toEqual({ since: "abc123" });
  });

  it("defaults to none", () => {
    expect(parseArgs([])).toEqual({});
  });

  it("rejects --since with no value", () => {
    expect(() => parseArgs(["--since"])).toThrow("Missing value for argument --since");
  });

  it("fails with a usable message when no ref is given at all", () => {
    const result = runScript([]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Reviewed commit");
  });

  it("fails rather than guessing when the ref cannot be resolved", () => {
    const result = runScript(["--since", "no/such/ref"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot resolve --since ref");
  });

  it("takes the ref from the environment, and reports against it", () => {
    const result = runScript([], { REVIEW_DELTA_SINCE: "origin/main" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("origin/main");
  });
});
