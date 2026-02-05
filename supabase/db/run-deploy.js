#!/usr/bin/env node
/**
 * Cross-platform DB deploy runner.
 * Sets GIT_SHA correctly on Windows (PowerShell/cmd) and Unix.
 *
 * Usage: node run-deploy.js [local]
 *   local = use local Supabase URL; otherwise use DATABASE_URL from env
 */

const { execSync } = require('child_process');
const path = require('path');

const isLocal = process.argv[2] === 'local';
const dbDir = path.resolve(__dirname);

let connectionString;
if (isLocal) {
  connectionString = 'postgresql://postgres:postgres@localhost:54322/postgres';
} else {
  connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set. Use "npm run db:deploy:local" for local.');
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
