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
  npx next dev

# Build the web app for production.
web-build-production:
  npx next build

# Build browser extension in watch mode.
extension-dev-watch:
  npx tsx scripts/extension/build.ts --mode=development --watch

# Build browser extension for production.
extension-build-production:
  npx tsx scripts/extension/build.ts --mode=production

# Check formatting with Prettier.
quality-format-check:
  npx prettier --check .

# Write formatting with Prettier.
quality-format-write:
  npx prettier --write .

# Run ESLint with zero warnings allowed.
quality-lint:
  npx eslint src browserExtension/src browserExtension/popup-src scripts/extension supabase/functions --ext .ts,.tsx --max-warnings=0

# Run TypeScript type checks.
quality-typecheck:
  npx tsc --noEmit
  npx tsc --noEmit -p supabase/functions/tsconfig.json

# Run current smoke gate (web production build).
quality-smoke-build: web-build-production

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

# Prepare DB, run web dev + extension watch + functions serve, and cleanup on exit.
dev-ready-local stop_db='true':
  node scripts/just/dev-ready-local.cjs {{stop_db}}

# Stop local developer services.
dev-local-stop: supabase-local-stop

# Single command to build and check all local apps plus database with guaranteed cleanup.
build-local-all:
  node scripts/just/build-local-all.cjs

# CI-style local confidence gate before PR push.
ci-verify-local: build-local-all

# Regenerate per-client MCP configs from canonical source.
mcp-sync:
  npx tsx scripts/sync-mcp-configs.ts

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
