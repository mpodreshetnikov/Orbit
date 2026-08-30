set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# List all available project commands with descriptions.
commands-list:
  @{{ just_executable() }} --list --unsorted

# Configure Git to use repository hooks from .githooks.
git-hooks-install:
  git config --local core.hooksPath .githooks

# Show current Git hooks path for this repository.
git-hooks-status:
  git config --local --get core.hooksPath

# Install locked Node dependencies.
install-dependencies:
  npm ci

# Run Next.js development server.
web-dev-server:
  $port = if ($env:WEB_DEV_PORT) { $env:WEB_DEV_PORT } else { "3000" }; npx next dev --port $port

# Build the web app for production.
web-build-production:
  npx next build

# Sync the iOS app shell: copy web assets and native plugins into ios/.
ios-sync:
  npx cap sync ios

# Open the iOS app shell in Xcode (macOS only).
ios-open:
  npx cap open ios

# Build browser extension in watch mode.
extension-dev-watch:
  npx tsx scripts/extension/build.ts --mode=development --watch

# Build browser extension for production.
extension-build-production:
  npx tsx scripts/extension/build.ts --mode=production

# Build the versioned production extension release bundle.
# The conditional is a just interpolation, not shell: just resolves it before the
# recipe runs, so the command line is valid under both sh and PowerShell. This
# previously used PowerShell's `if (…) { … } else { … }`, which is a syntax error
# under sh and so failed on Linux CI. Passing an empty --published-at is not an
# option — the CLI rejects a blank value — so the flag has to be omitted entirely.
extension-release-build artifact_dir='.artifacts/extension-release' published_at='':
  npx tsx scripts/extension/release.ts build-artifact --output-dir "{{artifact_dir}}" {{ if published_at == '' { '' } else { '--published-at "' + published_at + '"' } }}

# Publish the prepared production extension release bundle to Supabase Storage.
extension-release-publish artifact_dir='.artifacts/extension-release':
  npx tsx scripts/extension/release.ts publish --artifact-dir "{{artifact_dir}}"

# Check whether extension changes in a git range require a manifest version bump.
extension-release-check-version from to:
  npx tsx scripts/extension/release.ts check-version-bump --from "{{from}}" --to "{{to}}"

# Money-import live debug: run extension scraper for any source (auto-detects auth).
# Agent note: if an auth gate appears, ask a human to pass it; do not stop. Use a short --wait-for-manual <seconds> (e.g. 5–10) to quickly see if a human is needed without waiting long (run the script directly to pass it).
extension-debug-live source='tbank_web' wait='':
  if ("{{wait}}" -eq "") { npx tsx scripts/extension/playwright-cli-run-connector-parser.ts --source "{{source}}" } else { npx tsx scripts/extension/playwright-cli-run-connector-parser.ts --source "{{source}}" --wait-for-manual "{{wait}}" }

# Money-import live debug full: parse + edge apply/complete. Agent note: on auth gate, ask human to pass it; use short --wait-for-manual to probe (pass wait as second arg).
extension-debug-live-full source='tbank_web' wait='':
  if ("{{wait}}" -eq "") { npx tsx scripts/extension/playwright-cli-run-connector-parser.ts --source "{{source}}" --full-run } else { npx tsx scripts/extension/playwright-cli-run-connector-parser.ts --source "{{source}}" --full-run --wait-for-manual "{{wait}}" }

# Analyze latest (or explicit) scraper debug artifact for a source.
extension-debug-analyze source='tbank_web' artifact='':
  if ("{{artifact}}" -eq "") { npx tsx scripts/extension/analyze-tbank-debug-artifact.ts --source "{{source}}" } else { npx tsx scripts/extension/analyze-tbank-debug-artifact.ts --source "{{source}}" --artifact "{{artifact}}" }

# Generate human-readable scraper report (Markdown + CSV preview) for a source.
extension-debug-report source='tbank_web' artifact='':
  if ("{{artifact}}" -eq "") { npx tsx scripts/extension/analyze-tbank-debug-artifact.ts --source "{{source}}" --print-report } else { npx tsx scripts/extension/analyze-tbank-debug-artifact.ts --source "{{source}}" --artifact "{{artifact}}" --print-report }

# Check formatting with Prettier.
quality-format-check:
  npx prettier --check .

# Write formatting with Prettier.
quality-format-write:
  npx prettier --write .

# Run ESLint for the web app and shared UI.
quality-lint-web:
  npx eslint src shared --ext .ts,.tsx --max-warnings=0

# Run ESLint for browser extension runtime and popup surfaces.
quality-lint-extension:
  npx eslint browserExtension/src browserExtension/popup-src --ext .ts,.tsx --max-warnings=0

# Run ESLint for scripts, tooling and the native app shell config.
quality-lint-scripts:
  npx eslint scripts native vite.config.extension.ts capacitor.config.ts --ext .js,.cjs,.mjs,.ts,.tsx --max-warnings=0

# Run Deno lint for Supabase Edge Functions.
quality-lint-supabase-functions:
  deno lint --config supabase/functions/deno.json supabase/functions

# Run all lint surfaces with zero warnings allowed.
quality-lint: quality-lint-web quality-lint-extension quality-lint-scripts quality-lint-supabase-functions

# Run all lint surfaces in parallel (faster for CI).
quality-lint-parallel:
  node scripts/just/run-lint-parallel.cjs

# Run ESLint autofix where safe.
quality-lint-fix:
  npx eslint src shared browserExtension/src browserExtension/popup-src scripts native vite.config.extension.ts capacitor.config.ts --ext .js,.cjs,.mjs,.ts,.tsx --fix --max-warnings=0

# Run TypeScript type checks for web and extension surfaces.
quality-typecheck-web:
  npx tsc --noEmit

# Verify Supabase Edge Functions lockfile compatibility.
quality-check-supabase-functions-lock:
  node scripts/just/check-supabase-functions-lock.cjs

# Regenerate Supabase Edge Functions lockfile with runtime-compatible Deno.
supabase-functions-lock-refresh:
  node scripts/just/refresh-supabase-functions-lock.cjs

# Run Deno type checks for Supabase Edge Functions.
quality-typecheck-supabase-functions: quality-check-supabase-functions-lock
  deno check --config supabase/functions/deno.json supabase/functions/*/index.ts

# Run aggregate type checks.
quality-typecheck: quality-typecheck-web quality-typecheck-supabase-functions

# Mirror .agents/skills into .claude/skills so every client sees the same skills.
agent-skills-sync:
  node scripts/just/sync-agent-skills.cjs

# Fail when .claude/skills has drifted from .agents/skills.
agent-skills-check:
  node scripts/just/sync-agent-skills.cjs --check

# Fail when a branch adds a migration that sorts before one the base branch already carries.
# Defaults to origin/main; pass a ref for a branch that targets something else.
quality-migration-order *base:
  node scripts/just/check-migration-order.cjs {{ if base == "" { "" } else { "--base " + base } }}

# Fail when a branch adds more reviewable lines against its base than one automated review pass is
# worth. Defaults to origin/main; pass a ref for a branch that targets something else.
quality-pr-size *base:
  node scripts/just/check-pr-size.cjs {{ if base == "" { "" } else { "--base " + base } }}

# Report whether the change made since the last automated review is worth requesting another one.
# Pass the commit that review read (Codex names it as "Reviewed commit"). Advisory, not a gate.
review-delta since:
  node scripts/just/check-review-delta.cjs --since {{ since }}

# All static quality checks: skill sync, migration order, PR size, format, lint, typecheck (no
# builds, DB, tests). The skill, migration-order and size checks run first because they finish in
# milliseconds, so a drifted skill mirror, a misordered migration or a branch too large to review
# is reported before the slow lanes start.
quality: agent-skills-check quality-migration-order quality-pr-size quality-format-check quality-lint-parallel quality-typecheck

# Run current smoke gate (web production build).
quality-smoke-build: web-build-production

# Run web unit tests across client and server runtime projects.
test-unit-web:
  npx vitest run --project web --project web-server

# Run extension unit tests (core + popup UI).
test-unit-ext:
  npx vitest run --project extension-core --project extension-ui

# Run node/runtime-agnostic unit tests.
test-unit-node:
  npx vitest run --project node

# Run Supabase Edge Function unit tests under Deno.
test-unit-functions:
  deno test --allow-env --allow-read --config supabase/functions/deno.json supabase/functions

# Run fast unit tests across all non-DB surfaces.
test-unit:
  npx vitest run
  deno test --allow-env --allow-read --config supabase/functions/deno.json supabase/functions

# Run unit tests with coverage reports.
test-unit-coverage:
  npx vitest run --coverage --retry=1
  deno test --allow-env --allow-read --config supabase/functions/deno.json supabase/functions
  deno test --allow-env --allow-read --config supabase/functions/deno.json --coverage=.coverage/deno supabase/functions
  node scripts/just/coverage-report.cjs

# Run end-to-end product flow checks in deterministic no-external-LLM mode where applicable.
test-e2e:
  node scripts/just/run-e2e.cjs

# Score extraction quality against the fixture corpus (replays recordings; --live to call the model).
test-extraction *args:
  npx tsx scripts/extraction-eval/run.ts {{args}}

# Generate combined runtime + DB coverage report artifacts.
coverage-report:
  node scripts/just/coverage-report.cjs

# Validate coverage ratchet and changed DB object coverage mapping.
coverage-check:
  node scripts/just/run-coverage-check-parallel.cjs

# Report DB object to pgTAP test mapping coverage.
db-coverage-report:
  node scripts/just/db-coverage-report.cjs

# Run local Supabase DB lint (public schema only), failing on warnings.
quality-db-lint:
  npx supabase db lint --local --schema public --fail-on warning

# Run pgTAP tests for database functions and policies.
quality-db-test:
  npx supabase test db --local supabase/tests

# Start local Supabase stack.
supabase-local-start:
  npx supabase start

# Stop local Supabase stack.
supabase-local-stop:
  npx supabase stop

# Show local Supabase service status.
supabase-local-status:
  npx supabase status

# Apply pending local migrations without reset.
supabase-local-migrate-only:
  npx supabase migration up

# Reset local DB to migrations and seed (destructive).
supabase-local-reset-only:
  npx supabase db reset --yes

# Apply idempotent SQL objects from supabase/db/deploy.sql to local DB.
supabase-local-deploy-sql:
  node supabase/db/run-deploy.js local

# Bring local DB up-to-date without reset.
supabase-local-migrate-and-deploy: supabase-local-migrate-only supabase-local-deploy-sql

# Rebuild local DB from scratch and re-apply idempotent SQL.
supabase-local-reset-and-deploy: supabase-local-reset-only supabase-local-deploy-sql

# Regenerate DB schema snapshot and TS DB types from a reset local DB.
supabase-local-artifacts-refresh:
  node scripts/just/db-artifacts.cjs

# Regenerate DB artifacts and fail if tracked generated files drift.
supabase-local-artifacts-verify:
  node scripts/just/db-artifacts.cjs --verify

# Serve local Supabase Edge Functions.
supabase-local-functions-serve:
  npx supabase functions serve

# Start local observability stack (grafana/otel-lgtm).
obs-up:
  node -e "const { ensureDockerReady } = require('./scripts/just/docker-preflight.cjs'); process.exit(ensureDockerReady());"
  docker compose -f docker-compose.observability.yml up -d

# Stop local observability stack (idempotent).
obs-down:
  docker compose -f docker-compose.observability.yml down --remove-orphans; if ($LASTEXITCODE -ne 0) { Write-Output "obs-down skipped (stack not running or Docker unavailable)."; exit 0 }

# Prepare DB, run web dev + extension watch + functions serve, and cleanup on exit.
dev-ready-local stop_db='true' auth='default':
  node scripts/just/dev-ready-local.cjs {{stop_db}} {{auth}}

# Stop local developer services.
dev-local-stop:
  {{ just_executable() }} supabase-local-stop; $supabaseExit = $LASTEXITCODE; if ($env:OBS_AUTO -ne "0") { {{ just_executable() }} obs-down }; if ($supabaseExit -ne 0) { exit $supabaseExit }

# Simple dev command aliases (`just dev`, `just dev stop`, `just dev start bypass`).
dev action='start' auth='default':
  if ("{{action}}" -eq "start") { if ("{{auth}}" -eq "default" -or "{{auth}}" -eq "bypass") { {{ just_executable() }} dev-ready-local true {{auth}} } else { Write-Error "Unknown dev auth mode: {{auth}}. Use 'default' or 'bypass'."; exit 1 } } elseif ("{{action}}" -eq "stop") { {{ just_executable() }} dev-local-stop } else { Write-Error "Unknown dev action: {{action}}. Use 'start' or 'stop'."; exit 1 }

# Single command to build and check all local apps plus database with guaranteed cleanup.
build-local-all db_mode='auto':
  node scripts/just/build-local-all.cjs --db-mode={{db_mode}}

# CI-style local confidence gate before PR push.
ci-verify-local: quality build-local-all test-unit-coverage coverage-check test-e2e

# Quick local gate (no Supabase, no coverage): quality + unit tests + builds.
ci-verify-local-fast: quality test-unit web-build-production extension-build-production

# Full local quality gate.
check: build-local-all test-unit-coverage coverage-check test-e2e

# Regenerate per-client MCP configs from canonical source.
mcp-sync:
  npx tsx scripts/sync-mcp-configs.ts

# Create a local Grafana service account token for MCP via Grafana API.
mcp-grafana-token-create service_account_id='' token_name='mcp-grafana-local':
  $args = @("scripts/mcp/create-grafana-mcp-token.ts", "--token-name", "{{token_name}}"); if ("{{service_account_id}}" -ne "") { $args += @("--service-account-id", "{{service_account_id}}") }; npx tsx @args

# List local Grafana service account token metadata for MCP service accounts.
mcp-grafana-token-list service_account_id='':
  $args = @("scripts/mcp/create-grafana-mcp-token.ts", "--list-only"); if ("{{service_account_id}}" -ne "") { $args += @("--service-account-id", "{{service_account_id}}") }; npx tsx @args

# Scan likely push range for accidentally committed secrets.
secrets-preflight:
  node scripts/just/secrets-preflight.cjs

# Scan a specific commit range for accidentally committed secrets.
secrets-preflight-range from to:
  node scripts/just/secrets-preflight.cjs --range "{{from}}" "{{to}}"

# Deploy functions, migrations, and idempotent SQL using CI environment variables.
ci-deploy-supabase:
  node scripts/just/deploy-supabase.cjs --target ci --project-ref "{{env_var('SUPABASE_PROJECT_REF')}}" --database-url "{{env_var('DATABASE_URL')}}"

# Deploy to staging explicitly (dangerous, remote mutation).
deploy-staging-supabase project_ref database_url:
  node scripts/just/deploy-supabase.cjs --target staging --project-ref "{{project_ref}}" --database-url "{{database_url}}"

# Deploy to production explicitly (dangerous, remote mutation).
deploy-production-supabase project_ref database_url:
  node scripts/just/deploy-supabase.cjs --target production --project-ref "{{project_ref}}" --database-url "{{database_url}}"
