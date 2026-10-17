# shellcheck shell=bash
# `deploy/orbit backup ...` and `deploy/orbit restore`. Sourced, never run. The work itself happens
# in the backup container (deploy/backup/run.sh); this file decides when and with what mounted.

backup_configured() {
  [[ -n "${BACKUP_WAL_S3_PREFIX:-}" || -n "${BACKUP_SNAPSHOT_REPOSITORY:-}" ]]
}

check_backup_env() {
  local problems=0 name
  if [[ -n "${BACKUP_WAL_S3_PREFIX:-}" ]]; then
    for name in BACKUP_WAL_S3_ENDPOINT BACKUP_WAL_S3_ACCESS_KEY_ID BACKUP_WAL_S3_SECRET_ACCESS_KEY; do
      if [[ -z "${!name:-}" ]]; then
        err "deploy/.env: $name is empty but BACKUP_WAL_S3_PREFIX is set"
        problems=$((problems + 1))
      fi
    done
    if [[ "$BACKUP_WAL_S3_PREFIX" != s3://* ]]; then
      err "deploy/.env: BACKUP_WAL_S3_PREFIX must look like s3://bucket/folder"
      problems=$((problems + 1))
    fi
  else
    warn "BACKUP_WAL_S3_* is empty: no continuous database copy (you could lose up to a day of changes)"
  fi
  if [[ -n "${BACKUP_SNAPSHOT_REPOSITORY:-}" ]]; then
    for name in BACKUP_SNAPSHOT_ACCESS_KEY_ID BACKUP_SNAPSHOT_SECRET_ACCESS_KEY; do
      if [[ -z "${!name:-}" ]]; then
        err "deploy/.env: $name is empty but BACKUP_SNAPSHOT_REPOSITORY is set"
        problems=$((problems + 1))
      fi
    done
    if [[ "$BACKUP_SNAPSHOT_REPOSITORY" != s3:* ]]; then
      err "deploy/.env: BACKUP_SNAPSHOT_REPOSITORY must look like s3:https://endpoint/bucket/folder"
      problems=$((problems + 1))
    fi
  else
    warn "BACKUP_SNAPSHOT_* is empty: uploaded files and the Vault key are not copied anywhere"
  fi
  backup_configured || die "Fill at least one of the two BACKUP_* blocks in deploy/.env (docs/SELF_HOSTING.md, Backups)."
  ((problems == 0)) || die "Fix the $problems line(s) above in deploy/.env and run the command again."
}

in_backup() { compose exec -T backup /usr/local/bin/orbit-backup "$@"; }

backup_status() {
  echo "Backups:"
  if ! backup_configured; then
    echo "  NOT CONFIGURED -- your data exists only on this server. docs/SELF_HOSTING.md, Backups."
    return
  fi
  in_backup status 2>/dev/null || echo "  the backup service is not running (deploy/orbit backup setup)"
}

backup_setup() {
  check_backup_env
  ensure_secrets "$ENV_FILE"
  load_env
  prepare_data_dir
  step "Building and starting the backup service"
  compose build backup
  compose up -d db backup
  wait_healthy 300
  step "Checking the backup storage"
  in_backup init
  step "Switching on WAL archiving"
  touch "$ORBIT_DATA_DIR/wal-spool/.enabled"
  step "Taking the first full backup"
  in_backup nightly
  compose exec -T db psql -U supabase_admin -d postgres -qAtc 'select pg_switch_wal()' >/dev/null
  backup_status
  echo
  echo "$(c_green "Backups are on.") Two keys in deploy/.env decrypt them: BACKUP_ENCRYPTION_KEY (bucket 1)"
  echo "and BACKUP_SNAPSHOT_PASSWORD (bucket 2). They live on this server: if it is lost, so are they,"
  echo "unless you keep a copy. Store deploy/.env in your password manager NOW."
}

cmd_backup() {
  local sub="${1:-status}"
  load_env
  case "$sub" in
    setup) backup_setup ;;
    now) in_backup nightly ;;
    files) in_backup files ;;
    verify) in_backup verify ;;
    status) backup_status ;;
    *) die "Unknown: deploy/orbit backup $sub (setup | now | verify | status)" ;;
  esac
}

# Replaces the database with the WAL-G copy (latest, or --time), and the uploaded files and Vault
# key with the snapshot from the same moment. With --from-snapshot, or when there is no WAL-G copy,
# the database is rebuilt from the nightly dump instead (up to a day older). Whatever is replaced
# is kept aside, never deleted.
cmd_restore() {
  local target_time="" assume_yes=0 from_snapshot=0 stamp answer
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --time)
        target_time="$2"
        shift 2
        ;;
      --yes)
        assume_yes=1
        shift
        ;;
      --from-snapshot)
        from_snapshot=1
        shift
        ;;
      *) die "Unknown option $1. Usage: deploy/orbit restore [--time \"2026-10-17 12:00:00+00\"] [--from-snapshot] [--yes]" ;;
    esac
  done
  load_env
  backup_configured || die "No backup storage in deploy/.env -- nothing to restore from."
  fetch_upstream
  prepare_data_dir
  if ((assume_yes == 0)); then
    echo "This stops Orbit and replaces its database${target_time:+ with its state at $target_time} and files with the backup."
    echo "The current data is kept next to it as *.before-restore-<time>. Type RESTORE to continue:"
    read -r answer
    [[ "$answer" == "RESTORE" ]] || die "Not restored."
  fi
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  step "Stopping Orbit"
  compose build backup >/dev/null
  compose stop

  if ((from_snapshot == 0)) && [[ -n "${BACKUP_WAL_S3_PREFIX:-}" ]]; then
    step "Restoring the database${target_time:+ to $target_time}"
    mv "$ORBIT_DATA_DIR/db" "$ORBIT_DATA_DIR/db.before-restore-$stamp"
    mkdir -p "$ORBIT_DATA_DIR/db"
    if ! compose run --rm --no-deps -e RESTORE_TARGET_TIME="$target_time" \
      -v "$ORBIT_DATA_DIR/db:/restore/db" backup restore-db; then
      # Put the database back exactly as it was and bring Orbit up again before giving up.
      rm -rf "$ORBIT_DATA_DIR/db"
      mv "$ORBIT_DATA_DIR/db.before-restore-$stamp" "$ORBIT_DATA_DIR/db"
      compose up -d --remove-orphans
      die "The restore failed (see above); Orbit is back on the data it had before."
    fi
  elif [[ -n "${BACKUP_SNAPSHOT_REPOSITORY:-}" ]]; then
    step "Fetching the nightly database dump${target_time:+ from before $target_time}"
    cp -a "$ORBIT_DATA_DIR/db" "$ORBIT_DATA_DIR/db.before-restore-$stamp"
    mkdir -p "$ORBIT_DATA_DIR/migration"
    compose run --rm --no-deps -e RESTORE_TARGET_TIME="$target_time" \
      -v "$ORBIT_DATA_DIR/migration:/migration" backup restore-dump
    from_snapshot=1
  fi

  if [[ -n "${BACKUP_SNAPSHOT_REPOSITORY:-}" ]]; then
    step "Restoring uploaded files and the Vault key"
    cp -a "$ORBIT_DATA_DIR/storage" "$ORBIT_DATA_DIR/storage.before-restore-$stamp"
    compose run --rm --no-deps -e RESTORE_TARGET_TIME="$target_time" -v "$ORBIT_DATA_DIR/storage:/restore/storage" \
      -v "orbit_db-config:/restore/db-config" backup restore-files
  fi

  step "Starting Orbit"
  compose up -d --remove-orphans
  wait_healthy 600
  if ((from_snapshot == 1)); then
    # The dump replaces the rows of auth, public and storage in the running database; the files
    # those Storage rows point at were restored above, from the same moment.
    step "Loading the nightly dump"
    export SERVICE_ROLE_KEY
    migration_run import
  fi
  # Vault secrets and the allowlist are per instance; write them again for this one.
  cmd_migrate
  compose restart functions >/dev/null
  wait_healthy 120
  warm_functions
  # The restored database continues on a new timeline (or is a new one): start the copies afresh.
  if [[ -n "${BACKUP_WAL_S3_PREFIX:-}" ]]; then in_backup nightly; fi
  ok "Restored. The data it replaced is in $ORBIT_DATA_DIR/*.before-restore-$stamp; delete it once you are happy."
}
