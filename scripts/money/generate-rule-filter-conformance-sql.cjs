#!/usr/bin/env node
/**
 * Renders the pgTAP half of the rule-filter conformance suite from the shared corpus.
 *
 * Both halves must run the *same* cases, so the corpus lives in one JSON file. pgTAP has no
 * good way to read that file at run time — `pg_read_file` resolves against the server's data
 * directory, which the test does not control — so the SQL is generated from it and committed.
 * A unit test compares the committed file against a fresh render, which is what keeps the two
 * from drifting apart.
 */

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const casesPath = path.join(repoRoot, "supabase/tests/fixtures/money_rule_filter_cases.json");
const outputPath = path.join(
  repoRoot,
  "supabase/tests/functions/money_rule_filter_conformance_test.sql",
);

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlUuidOrNull(value) {
  return value === null || value === undefined ? "NULL" : `${sqlLiteral(value)}::uuid`;
}

function sqlTextOrNull(value) {
  return value === null || value === undefined ? "NULL" : sqlLiteral(value);
}

function render(cases) {
  const lines = [];
  lines.push("-- GENERATED FILE — do not edit by hand.");
  lines.push("-- Source: supabase/tests/fixtures/money_rule_filter_cases.json");
  lines.push("-- Regenerate: node scripts/money/generate-rule-filter-conformance-sql.cjs");
  lines.push("--");
  lines.push("-- The money rule engine exists twice: in PL/pgSQL here and in TypeScript in");
  lines.push(
    "-- supabase/functions/money-categorize/service.ts. Which one runs depends on whether the",
  );
  lines.push(
    "-- person has an LLM rule enabled, so enabling one rule must not change how every other",
  );
  lines.push("-- rule behaves. This suite and its Deno twin run the same corpus through both.");
  lines.push("");
  lines.push("BEGIN;");
  lines.push(`SELECT plan(${cases.length + 1});`);
  lines.push("");
  lines.push(
    "SELECT has_function('public', 'money_evaluate_category_rule_filter', ARRAY['jsonb', 'uuid', 'text', 'jsonb']);",
  );
  lines.push("");

  for (const entry of cases) {
    lines.push("SELECT is(");
    lines.push("  public.money_evaluate_category_rule_filter(");
    lines.push(`    ${sqlLiteral(JSON.stringify(entry.context))}::jsonb,`);
    lines.push(`    ${sqlUuidOrNull(entry.current_category_id)},`);
    lines.push(`    ${sqlTextOrNull(entry.current_canonical_system_key)},`);
    lines.push(`    ${sqlLiteral(JSON.stringify(entry.filter))}::jsonb`);
    lines.push("  ),");
    lines.push(`  ${entry.expected ? "true" : "false"},`);
    lines.push(`  ${sqlLiteral(entry.name)}`);
    lines.push(");");
    lines.push("");
  }

  lines.push("SELECT * FROM finish();");
  lines.push("ROLLBACK;");
  return lines.join("\n") + "\n";
}

function main() {
  const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));
  const sql = render(cases);
  if (process.argv.includes("--check")) {
    const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
    if (existing !== sql) {
      console.error(
        `${path.relative(repoRoot, outputPath)} is out of date. Run: node scripts/money/generate-rule-filter-conformance-sql.cjs`,
      );
      process.exit(1);
    }
    return;
  }
  fs.writeFileSync(outputPath, sql);
}

module.exports = { render, casesPath, outputPath };

if (require.main === module) main();
