#!/usr/bin/env bash
# Runs inside the `migrate` container (deploy/web.Dockerfile, target tools), started by
# `deploy/orbit migrate`. Brings the database to this commit's schema the same way the hosted
# production deploy does (scripts/just/deploy-supabase.cjs), then writes the per-instance state
# that the hosted setup kept in the dashboard: the Vault secrets pg_cron reads, and the allowlist.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${PROJECT_URL_INTERNAL:?PROJECT_URL_INTERNAL is required}"
cd /app

echo "==> Applying migrations"
npx --no-install supabase db push --include-all --yes --db-url "$DATABASE_URL"

echo "==> Applying functions, triggers, policies and cron (supabase/db/deploy.sql)"
node supabase/db/run-deploy.js --database-url "$DATABASE_URL"

echo "==> Writing Vault secrets read by pg_cron"
# psql does not substitute variables inside a DO body, so the values travel as session settings.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
  -v project_url="$PROJECT_URL_INTERNAL" \
  -v fx_token="${MONEY_FX_SYNC_TOKEN:-}" <<'SQL'
\o /dev/null
select set_config('orbit.project_url', :'project_url', false),
       set_config('orbit.fx_token', :'fx_token', false);
\o
do $$
declare
  wanted record;
  existing uuid;
begin
  for wanted in
    select * from (values
      ('project_url', current_setting('orbit.project_url')),
      ('money_fx_sync_token', current_setting('orbit.fx_token'))
    ) as v(name, value)
    where v.value <> ''
  loop
    select id into existing from vault.secrets where name = wanted.name;
    if existing is null then
      perform vault.create_secret(wanted.value, wanted.name);
    else
      perform vault.update_secret(existing, wanted.value);
    end if;
  end loop;
end $$;
SQL

if [[ -n "${ORBIT_ALLOWED_EMAILS:-}" ]]; then
  echo "==> Allowlisting: ${ORBIT_ALLOWED_EMAILS}"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -v emails="$ORBIT_ALLOWED_EMAILS" <<'SQL'
insert into public.allowed_users (email)
select lower(trim(e)) from unnest(string_to_array(:'emails', ',')) as e
where trim(e) <> ''
on conflict (email) do nothing;
SQL
fi

echo "==> Database is at ${GIT_SHA:-this commit}"
