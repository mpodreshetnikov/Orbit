#!/usr/bin/env node
/**
 * Cross-platform DB deploy runner.
 * Sets GIT_SHA correctly on Windows (PowerShell/cmd) and Unix.
 *
 * Usage:
 *   node run-deploy.js [local] [--database-url <url>]
 *
 * Modes:
 *   local = use local Supabase URL
 *   remote = use --database-url or DATABASE_URL from env
 */

const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const isLocal = args.includes('local');
const dbDir = path.resolve(__dirname);

function getDatabaseUrlFromArgs(argv) {
  const directIndex = argv.indexOf('--database-url');
  if (directIndex !== -1) {
    return argv[directIndex + 1] || '';
  }
  const equalsArg = argv.find((arg) => arg.startsWith('--database-url='));
  if (equalsArg) {
    return equalsArg.slice('--database-url='.length);
  }
  return '';
}

let connectionString;
if (isLocal) {
  connectionString = 'postgresql://postgres:postgres@localhost:54322/postgres';
} else {
  connectionString = getDatabaseUrlFromArgs(args) || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Use --database-url for remote deploy or "just supabase-local-deploy-sql" for local.');
    process.exit(1);
  }
}

let gitSha;
try {
  gitSha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
} catch {
  gitSha = '';
}

// psql: ON_ERROR_STOP=1 makes deploy fail on first SQL error; GIT_SHA must be safe (no single quotes)
const psqlCmd = `psql "${connectionString}" -v ON_ERROR_STOP=1 -v GIT_SHA=${gitSha} -f deploy.sql`;
try {
  execSync(psqlCmd, { stdio: 'inherit', cwd: dbDir, shell: true });
} catch (err) {
  process.exit(err.status ?? 1);
}
