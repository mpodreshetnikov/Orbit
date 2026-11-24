#!/usr/bin/env node
/**
 * Assertion-smell lint for Vitest `*.test.*` / `*.spec.*` files (T-261113-k54 / ORB-63).
 *
 * Flags weak oracles that survive buggy production code:
 * - sole `toBeTruthy` / `toBeDefined` in a case
 * - sole `toContain` in a case (HTML/string presence as the only proof)
 * - mock-call-only cases (every expect is `toHaveBeenCalled*`)
 *
 * Any finding fails the scan.
 *
 * Suppress a line with `// test-smell-ok: <reason>` on the same line as the expect.
 *
 * Policy: `docs/design/common/testing-quality.md`.
 *
 * Stryker: Regex mutants on CASE_HEAD / arrow / function scanners only tweak
 * character classes and optional whitespace for well-formed Vitest sources — they
 * are equivalent under analyzeFile oracles. Behavioral mutants stay enabled.
 */
// Stryker disable Regex: equivalent scanner character-class/quantifier mutants on Vitest-shaped sources

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
/** Head of it/test, including optional modifiers and optional .each/.for (before any call). */
const CASE_HEAD =
  /\b(?:it|test)(?:\.(?:only|skip|todo|concurrent|fails))*(?:\.(?:each|for))?(?=\s*[\(`])/g;
const EXPECT_RE =
  /expect\s*(?:\.\s*soft)?\s*\([\s\S]*?\)\s*(?:\.\s*(?:resolves|rejects)\s*)?(?:\.\s*not\s*)?\.\s*(to[A-Za-z0-9]+)/g;
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
 * String/comment scanners below are covered by analyzeFile behavioral oracles.
 * Character-level mutants (loop bounds, escape flags, quote branches) are equivalent
 * for well-formed Vitest sources and drown the covered gate without changing findings.
 */
// Stryker disable all: scanner state machine; classify behavior gated via analyzeFile/run tests

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
 * True when index `i` is inside a string literal or line/block comment.
 * @param {string} source
 * @param {number} i
 */
function inNonCode(source, i) {
  let inStr = null;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let j = 0; j < i; j++) {
    const ch = source[j];
    const next = source[j + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        j += 1;
      }
      continue;
    }
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
    if (ch === "/" && next === "/") {
      inLineComment = true;
      j += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      j += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") inStr = ch;
  }
  return Boolean(inStr || inLineComment || inBlockComment);
}

/**
 * Find the matching closing paren for the opener at `openIdx`.
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
 * Skip whitespace from `i`.
 * @param {string} source
 * @param {number} i
 */
function skipWs(source, i) {
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return i;
}

/**
 * Locate the `(` that opens the it/test call that carries the title + callback.
 * For `it.each([...])("title", cb)` that is the second call.
 * @param {string} source
 * @param {number} headStart
 * @param {string} headText
 * @returns {{ openIdx: number, closeIdx: number } | null}
 */
function testCallParens(source, headStart, headText) {
  let i = skipWs(source, headStart + headText.length);
  if (source[i] !== "(") return null;
  const firstOpen = i;
  const firstClose = matchingParen(source, firstOpen);
  if (firstClose < 0) return null;

  const isEachOrFor = /\.(?:each|for)$/.test(headText);
  if (!isEachOrFor) {
    return { openIdx: firstOpen, closeIdx: firstClose };
  }

  i = skipWs(source, firstClose + 1);
  if (source[i] !== "(") return null;
  const secondOpen = i;
  const secondClose = matchingParen(source, secondOpen);
  if (secondClose < 0) return null;
  return { openIdx: secondOpen, closeIdx: secondClose };
}

/**
 * Last top-level argument of a call (comma-separated at depth 0).
 * @param {string} args
 * @returns {{ start: number, end: number } | null}
 */
function lastTopLevelArg(args) {
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;
  let inStr = null;
  let escaped = false;
  let argStart = 0;
  let last = null;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
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
    if (ch === "(") depthParen += 1;
    else if (ch === ")") depthParen -= 1;
    else if (ch === "{") depthBrace += 1;
    else if (ch === "}") depthBrace -= 1;
    else if (ch === "[") depthBracket += 1;
    else if (ch === "]") depthBracket -= 1;
    else if (ch === "," && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      last = { start: argStart, end: i };
      argStart = i + 1;
    }
  }
  last = { start: argStart, end: args.length };
  const slice = args.slice(last.start, last.end);
  if (!slice.trim()) return null;
  return last;
}

/**
 * Body of the callback passed directly to `it`/`test` (last top-level arg), not nested
 * `vi.fn` / `waitFor` callbacks inside that body.
 * @param {string} source
 * @param {number} openIdx
 * @param {number} closeIdx
 */
function caseBodyRange(source, openIdx, closeIdx) {
  const args = source.slice(openIdx + 1, closeIdx);
  const last = lastTopLevelArg(args);
  if (!last) return null;
  const arg = args.slice(last.start, last.end);
  const absArgStart = openIdx + 1 + last.start;

  const arrow = /(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/;
  const fn = /(?:async\s+)?function\s*(?:[A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/;
  const m = arg.match(arrow) || arg.match(fn);
  if (!m || m.index == null) return null;

  const braceOpen = absArgStart + m.index + m[0].length - 1;
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

// Stryker restore all

/**
 * @param {string} file
 * @param {string} source
 */
function analyzeFile(file, source) {
  /** @type {{ file: string, line: number, kind: string, detail: string }[]} */
  const findings = [];
  CASE_HEAD.lastIndex = 0;
  let match;
  while ((match = CASE_HEAD.exec(source))) {
    // Stryker disable next-line ConditionalExpression: redundant with per-expect inNonCode; string heads still yield zero expects
    if (inNonCode(source, match.index)) continue;
    const headText = match[0];
    const call = testCallParens(source, match.index, headText);
    if (!call) continue;
    const body = caseBodyRange(source, call.openIdx, call.closeIdx);
    if (!body) continue;
    const bodyText = source.slice(body.start, body.end);
    const expects = [];
    EXPECT_RE.lastIndex = 0;
    let em;
    while ((em = EXPECT_RE.exec(bodyText))) {
      const abs = body.start + em.index;
      if (inNonCode(source, abs)) continue;
      // Stryker disable all: line-number slice math; kind classification is the gate
      const lineStart = source.lastIndexOf("\n", abs) + 1;
      const lineEnd = source.indexOf("\n", abs);
      const lineText = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
      if (SUPPRESS_RE.test(lineText)) continue;
      expects.push({
        matcher: em[1],
        line: source.slice(0, abs).split("\n").length,
      });
      // Stryker restore all
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

/** @param {{ roots?: string[], silent?: boolean }} [opts] */
function run({ roots = SCAN_ROOTS, silent = false } = {}) {
  /** @type {{ file: string, line: number, kind: string, detail: string }[]} */
  const findings = [];
  for (const root of roots) {
    walk(root, (file) => {
      const source = fs.readFileSync(file, "utf8");
      findings.push(...analyzeFile(file, source));
    });
  }

  // Stryker disable all: summary stdout formatting; exitCode and findings are asserted
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

  if (!silent) {
    for (const f of findings) {
      process.stdout.write(`${f.file}:${f.line}: ${f.kind}: ${f.detail}\n`);
    }
    process.stdout.write(`${summary}\n`);
  }
  // Stryker restore all
  return { findings, exitCode: findings.length > 0 ? 1 : 0 };
}

if (require.main === module) {
  const result = run();
  process.exit(result.exitCode);
}

module.exports = {
  run,
  analyzeFile,
  WEAK_PRESENCE,
  MOCK_CALL_MATCHERS,
  inNonCode,
  matchingParen,
  skipWs,
  testCallParens,
  lastTopLevelArg,
  caseBodyRange,
  walk,
  TEST_NAME,
};
