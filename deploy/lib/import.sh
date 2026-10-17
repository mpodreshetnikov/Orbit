# shellcheck shell=bash
# `deploy/orbit migrate-from-supabase export|import|verify`: moving an Orbit that runs on hosted
# Supabase onto this instance. Sourced, never run. The steps run in the backup container
# (deploy/backup/migrate-from-supabase.sh); the procedure around them is docs/SELF_HOSTING.md,
# "Moving from hosted Supabase".

migration_run() {
  mkdir -p "$ORBIT_DATA_DIR/migration"
  compose run --rm --no-deps -T \
    -e SOURCE_DB_URL -e SOURCE_SUPABASE_URL -e SOURCE_SERVICE_ROLE_KEY -e SERVICE_ROLE_KEY \
    -v "$ORBIT_DATA_DIR/migration:/migration" \
    --entrypoint /usr/local/bin/migrate-from-supabase backup "$@"
}

# The allowlist is ORBIT_ALLOWED_EMAILS (deploy/lib/migrate.sh deletes whatever is not in it), so
# every address that had access on the hosted project must be in it before `migrate` runs.
check_imported_allowlist() {
  local missing
  missing="$(compose exec -T db psql -U supabase_admin -d postgres -qAt -v emails="$ORBIT_ALLOWED_EMAILS" <<'SQL'
select string_agg(email, ',') from public.allowed_users
where lower(email) <> all (select lower(trim(e)) from unnest(string_to_array(:'emails', ',')) as e);
SQL
  )"
  [[ -z "$missing" ]] || die "These e-mails had access on the hosted project but are not in ORBIT_ALLOWED_EMAILS: $missing
Add them to deploy/.env (or decide they should lose access) and run: deploy/orbit migrate-from-supabase import"
}

cmd_migrate_from_supabase() {
  local sub="${1:-}" assume_yes=0 answer
  [[ "${2:-}" == "--yes" ]] && assume_yes=1
  load_env
  case "$sub" in
    export)
      [[ -n "${SOURCE_DB_URL:-}" && -n "${SOURCE_SUPABASE_URL:-}" && -n "${SOURCE_SERVICE_ROLE_KEY:-}" ]] ||
        die "Set SOURCE_DB_URL, SOURCE_SUPABASE_URL and SOURCE_SERVICE_ROLE_KEY first (docs/SELF_HOSTING.md, Moving from hosted Supabase)."
      export SOURCE_DB_URL SOURCE_SUPABASE_URL SOURCE_SERVICE_ROLE_KEY
      compose build backup >/dev/null
      step "Exporting from $SOURCE_SUPABASE_URL"
      migration_run export
      ok "Exported into $ORBIT_DATA_DIR/migration. Next: deploy/orbit migrate-from-supabase import"
      ;;
    import)
      if ((assume_yes == 0)); then
        echo "This REPLACES all users, records and files of this instance with the exported ones."
        echo "Type IMPORT to continue:"
        read -r answer
        [[ "$answer" == "IMPORT" ]] || die "Not imported."
      fi
      export SERVICE_ROLE_KEY
      step "Importing into this instance"
      migration_run import
      check_imported_allowlist
      # Vault secrets, buckets, policies and cron are this instance's own; write them again.
      cmd_migrate
      compose restart functions >/dev/null
      wait_healthy 120
      warm_functions
      cmd_migrate_from_supabase verify
      ;;
    verify)
      export SERVICE_ROLE_KEY
      step "Comparing this instance with the export"
      migration_run verify
      ;;
    *) die "Usage: deploy/orbit migrate-from-supabase export | import [--yes] | verify" ;;
  esac
}
