#!/usr/bin/env node
/**
 * Assertion-smell lint for Vitest `*.test.*` / `*.spec.*` files (T-261113-k54 / ORB-63).
 *
 * Flags weak oracles that survive buggy production code:
 * - sole `toBeTruthy` / `toBeDefined` in a case
 * - sole `toContain` in a case (HTML/string presence as the only proof)
 * - mock-call-only cases (every expect is `toHaveBeenCalled*`)
 *
 * Default mode is warn (exit 0) so `quality` stays green while counts drop.
 * Set `ORBIT_TEST_SMELL_FAIL=1` (or pass `--fail`) to exit non-zero when smells remain.
 *
 * Suppress a line with `// test-smell-ok: <reason>` on the same line as the expect.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const SCAN_ROOTS = [
  path.join(ROOT, "src"),
  path.join(ROOT, "browserExtension", "src"),
  path.join(ROOT, "browserExtension", "popup-src"),
  path.join(ROOT, "scripts"),
  path.join(ROOT, "shared"),
  path.join(ROOT, "native"),
];

const TEST_NAME = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const CASE_START =
  /(?:(?:it|test)(?:\.(?:only|skip|todo|concurrent|fails))?|\b(?:it|test)\.(?:each|for)\()\s*\(/g;
const EXPECT_RE =
  /expect\s*(?:\.\s*soft)?\s*\([\s\S]*?\)\s*(?:\.\s*(?:resolves|rejects)\s*)?\.\s*(to[A-Za-z0-9]+)/g;
const SUPPRESS_RE = /test-smell-ok:/;

const MOCK_CALL_MATCHERS = new Set([
  "toHaveBeenCalled",
  "toHaveBeenCalledTimes",
  "toHaveBeenCalledWith",
  "toHaveBeenCalledOnce",
  "toHaveBeenNthCalledWith",
  "toHaveBeenLastCalledWith",
  "toHaveReturned",
  "toHaveReturnedWith",
  "toHaveReturnedTimes",
  "toHaveLastReturnedWith",
  "toHaveNthReturnedWith",
]);

const WEAK_PRESENCE = new Set(["toBeTruthy", "toBeDefined", "toBeFalsy", "toBeUndefined"]);

/**
 * @param {string} dir
 * @param {(file: string) => void} visit
 */
function walk(dir, visit) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "dist-firefox") {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (TEST_NAME.test(entry.name)) visit(full);
  }
}

/**
 * Find the matching closing paren for the opener at `openIdx` (the `(` after it/test).
 * @param {string} source
 * @param {number} openIdx
 */
function matchingParen(source, openIdx) {
  let depth = 0;
  let inStr = null;
  let escaped = false;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Body of a test case callback inside `it(...)/test(...)` args: the `{ ... }` after `=>` or
 * `function (...)`.
 * @param {string} source
 * @param {number} openIdx index of `(` after it/test
 * @param {number} closeIdx matching `)` of that call
 */
function caseBodyRange(source, openIdx, closeIdx) {
  const args = source.slice(openIdx + 1, closeIdx);
  const arrow = /(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g;
  const fn = /(?:async\s+)?function\s*(?:[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/g;
  let best = null;
  for (const re of [arrow, fn]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(args))) {
      best = { match: m, re };
    }
  }
  if (!best) return null;
  const braceOpen = openIdx + 1 + best.match.index + best.match[0].length - 1;
  let depth = 0;
  let inStr = null;
  let escaped = false;
  for (let j = braceOpen; j < source.length; j++) {
    const ch = source[j];
    if (inStr) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return { start: braceOpen + 1, end: j };
    }
  }
  return null;
}

/**
 * @param {string} file
 * @param {string} source
 */
function analyzeFile(file, source) {
  /** @type {{ file: string, line: number, kind: string, detail: string }[]} */
  const findings = [];
  CASE_START.lastIndex = 0;
  let match;
  while ((match = CASE_START.exec(source))) {
    const openIdx = match.index + match[0].length - 1;
    const closeIdx = matchingParen(source, openIdx);
    if (closeIdx < 0) continue;
    const body = caseBodyRange(source, openIdx, closeIdx);
    if (!body) continue;
    const bodyText = source.slice(body.start, body.end);
    const expects = [];
    EXPECT_RE.lastIndex = 0;
    let em;
    while ((em = EXPECT_RE.exec(bodyText))) {
      const abs = body.start + em.index;
      const lineStart = source.lastIndexOf("\n", abs) + 1;
      const lineEnd = source.indexOf("\n", abs);
      const lineText = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
      if (SUPPRESS_RE.test(lineText)) continue;
      expects.push({
        matcher: em[1],
        line: source.slice(0, abs).split("\n").length,
      });
    }
    if (expects.length === 0) continue;

    const matchers = expects.map((e) => e.matcher);
    const line = expects[0].line;
    const rel = path.relative(ROOT, file);

    if (expects.length === 1 && WEAK_PRESENCE.has(matchers[0])) {
      findings.push({
        file: rel,
        line,
        kind: "lone-presence",
        detail: `sole expect is ${matchers[0]} — prefer a concrete value/oracle`,
      });
    } else if (expects.length === 1 && matchers[0] === "toContain") {
      findings.push({
        file: rel,
        line,
        kind: "lone-tocontain",
        detail: "sole expect is toContain — prefer structured outcome over substring presence",
      });
    } else if (matchers.every((m) => MOCK_CALL_MATCHERS.has(m))) {
      findings.push({
        file: rel,
        line,
        kind: "mock-call-only",
        detail: "every expect is a mock call matcher — assert a result/oracle too",
      });
    }
  }
  return findings;
}

/**
 * @param {{ fail?: boolean, roots?: string[] }} [opts]
 */
function run(opts = {}) {
  const fail =
    opts.fail === true ||
    process.argv.includes("--fail") ||
    process.env.ORBIT_TEST_SMELL_FAIL === "1";
  const roots = opts.roots ?? SCAN_ROOTS;
  /** @type {{ file: string, line: number, kind: string, detail: string }[]} */
  const findings = [];
  for (const root of roots) {
    walk(root, (file) => {
      const source = fs.readFileSync(file, "utf8");
      findings.push(...analyzeFile(file, source));
    });
  }

  const byKind = findings.reduce((acc, f) => {
    acc[f.kind] = (acc[f.kind] || 0) + 1;
    return acc;
  }, /** @type {Record<string, number>} */ ({}));

  const summary = `test-smell-lint: ${findings.length} finding(s)${
    findings.length
      ? ` (${Object.entries(byKind)
          .map(([k, n]) => `${k}=${n}`)
          .join(", ")})`
      : ""
  }`;

  if (findings.length === 0) {
    process.stdout.write(`${summary}\n`);
    return { findings, exitCode: 0 };
  }

  // Cap stdout noise; full list when failing.
  const shown = fail ? findings : findings.slice(0, 40);
  for (const f of shown) {
    process.stdout.write(`${f.file}:${f.line}: ${f.kind}: ${f.detail}\n`);
  }
  if (!fail && findings.length > shown.length) {
    process.stdout.write(
      `… ${findings.length - shown.length} more (run with --fail for full list)\n`,
    );
  }
  process.stdout.write(
    `${summary}${fail ? " — failing" : " — warn only (ORBIT_TEST_SMELL_FAIL=1 or --fail to gate)"}\n`,
  );
  return { findings, exitCode: fail ? 1 : 0 };
}

if (require.main === module) {
  const result = run();
  process.exit(result.exitCode);
}

module.exports = { run, analyzeFile, WEAK_PRESENCE, MOCK_CALL_MATCHERS };
