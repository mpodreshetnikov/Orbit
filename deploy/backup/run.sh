#!/usr/bin/env bash
# Entry point of the `backup` container (deploy/backup/Dockerfile). Started by deploy/orbit:
#
#   daemon          the long-running loop: ships WAL as it appears, runs the scheduled jobs
#   nightly         base backup + full snapshot + retention, now
#   files           snapshot of uploaded files only, now
#   verify          restore the latest copies into a scratch directory and check they read
#   restore-db      rebuild /restore/db from the WAL-G copy (optionally to RESTORE_TARGET_TIME)
#   restore-files   put the snapshot's uploaded files and the pgsodium key under /restore
#   restore-dump    put the nightly snapshot's database dump at /migration/source.dump
#   init            create the snapshot repository if it does not exist yet
#   status          when each job last succeeded
#
# Two independent copies, deliberately on two providers and two tools (docs/SELF_HOSTING.md,
# "Backups"):
#   1. WAL-G, bucket 1: every WAL segment within archive_timeout (60 s) plus a nightly physical
#      base backup. Restores the database to any moment.
#   2. restic, bucket 2: uploaded files every BACKUP_FILES_INTERVAL_MIN minutes, and nightly a
#      logical dump of the database, the pgsodium key that Vault needs, and deploy/.env.
#
# The database writes finished WAL segments into /wal-spool (deploy/backup/archive-wal.sh, its
# archive_command); this loop uploads and removes them. Postgres never waits on the network.
set -euo pipefail

SPOOL=/wal-spool
STATE=/state
PGDATA_RO=/var/lib/postgresql/data
mkdir -p "$STATE"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
mark() { date -u +%s >"$STATE/$1"; }
age_of() { local t; t="$(cat "$STATE/$1" 2>/dev/null || echo 0)"; echo $(($(date -u +%s) - t)); }

# --- Configuration --------------------------------------------------------------------------------

walg_configured() { [[ -n "${BACKUP_WAL_S3_PREFIX:-}" && -n "${BACKUP_WAL_S3_ACCESS_KEY_ID:-}" ]]; }
restic_configured() { [[ -n "${BACKUP_SNAPSHOT_REPOSITORY:-}" && -n "${BACKUP_SNAPSHOT_ACCESS_KEY_ID:-}" ]]; }

walg() {
  WALG_S3_PREFIX="$BACKUP_WAL_S3_PREFIX" \
    AWS_ENDPOINT="${BACKUP_WAL_S3_ENDPOINT:-}" \
    AWS_REGION="${BACKUP_WAL_S3_REGION:-auto}" \
    AWS_S3_FORCE_PATH_STYLE=true \
    AWS_ACCESS_KEY_ID="$BACKUP_WAL_S3_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$BACKUP_WAL_S3_SECRET_ACCESS_KEY" \
    WALG_LIBSODIUM_KEY="${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY is missing; run deploy/orbit backup setup}" \
    WALG_LIBSODIUM_KEY_TRANSFORM=hex \
    WALG_COMPRESSION_METHOD=brotli \
    WALG_PREVENT_WAL_OVERWRITE=true \
    PGHOST=db PGPORT=5432 PGUSER=supabase_admin PGDATABASE=postgres PGPASSWORD="${POSTGRES_PASSWORD:?}" \
    wal-g "$@"
}

rst() {
  RESTIC_REPOSITORY="$BACKUP_SNAPSHOT_REPOSITORY" \
    RESTIC_PASSWORD="${BACKUP_SNAPSHOT_PASSWORD:?BACKUP_SNAPSHOT_PASSWORD is missing; run deploy/orbit backup setup}" \
    AWS_ACCESS_KEY_ID="$BACKUP_SNAPSHOT_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$BACKUP_SNAPSHOT_SECRET_ACCESS_KEY" \
    AWS_DEFAULT_REGION="${BACKUP_SNAPSHOT_REGION:-auto}" \
    RESTIC_CACHE_DIR="$STATE/restic-cache" \
    restic "$@"
}

# --- Alerts ---------------------------------------------------------------------------------------

notify() {
  local text host
  host="$(hostname -s 2>/dev/null || echo server)"
  text="Orbit backup on ${host}: $*"
  log "ALERT $*"
  if [[ -n "${ALERT_TELEGRAM_BOT_TOKEN:-}" && -n "${ALERT_TELEGRAM_CHAT_ID:-}" ]]; then
    curl -fsS -m 20 -o /dev/null "https://api.telegram.org/bot${ALERT_TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${ALERT_TELEGRAM_CHAT_ID}" --data-urlencode "text=${text}" || log "telegram alert failed"
  fi
  [[ -z "${BACKUP_HEALTHCHECK_URL:-}" ]] || curl -fsS -m 20 -o /dev/null --data-raw "$text" "${BACKUP_HEALTHCHECK_URL}/fail" || true
}

ping_ok() { [[ -z "${BACKUP_HEALTHCHECK_URL:-}" ]] || curl -fsS -m 20 -o /dev/null "$BACKUP_HEALTHCHECK_URL" || true; }

# Runs a job; on failure records it and alerts, but never kills the daemon. Jobs take turns: the
# daemon's schedule and a `deploy/orbit backup now` must not write to one repository at once.
job() {
  local name="$1"
  shift
  exec 9>"$STATE/.job.lock"
  flock -w 7200 9 || { notify "$name could not start: another backup job held the lock for 2 hours"; return 1; }
  log "start $name"
  # The job runs as a process of its own: bash ignores set -e inside any function called from a
  # condition or an `||` list -- which is how the daemon calls jobs -- and a subshell inherits that,
  # so a failed pg_dump followed by a successful upload would count as a successful job.
  local rc=0
  "$0" __job "$@" || rc=$?
  if ((rc == 0)); then
    mark "last_${name}"
    rm -f "$STATE/failing_${name}"
    log "done $name"
  else
    date -u +%FT%TZ >"$STATE/failing_${name}"
    notify "$name FAILED (deploy/orbit logs backup)"
  fi
  flock -u 9
  return $rc
}

# --- Jobs -----------------------------------------------------------------------------------------

push_spool() {
  local f
  shopt -s nullglob
  for f in "$SPOOL"/*; do
    [[ "$f" == *.part ]] && continue
    walg wal-push "$f" >/dev/null && rm -f "$f" && mark last_wal_push
  done
  shopt -u nullglob
}

base_backup() {
  walg backup-push "$PGDATA_RO" &&
    walg delete retain FULL "${BACKUP_WAL_KEEP_FULL:-14}" --confirm
}

snapshot_files() {
  rst backup --tag files --host orbit /data/storage --quiet &&
    rst forget --tag files --host orbit --keep-last 8 --keep-hourly 48 --keep-daily 14 --quiet
}

snapshot_full() {
  local work="$STATE/snapshot"
  rm -rf "$work" && mkdir -p "$work"
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h db -U supabase_admin -d postgres -Fc -f "$work/postgres.dump"
  PGPASSWORD="$POSTGRES_PASSWORD" pg_dumpall -h db -U supabase_admin --roles-only -f "$work/roles.sql"
  cp /config/orbit.env "$work/orbit.env"
  rst backup --tag nightly --host orbit "$work" /data/storage /data/db-config --quiet &&
    rst forget --tag nightly --host orbit --keep-last 3 --keep-daily 14 --keep-weekly 8 --keep-monthly 12 --quiet
  local rc=$?
  rm -rf "$work"
  return $rc
}

prune() { rst prune --quiet; }

nightly() {
  local failed=0
  # A manual run counts as today's: the daemon does not take a second one right behind it.
  mark last_nightly_run
  if walg_configured; then job base_backup base_backup || failed=1; fi
  if restic_configured; then job snapshot_full snapshot_full || failed=1; fi
  ((failed == 0)) && ping_ok
  return $failed
}

# Starts a stock PostgreSQL 17 on a restored data directory, as the postgres user, with nothing
# from Supabase's configuration: no preload libraries, only a local socket, trust auth.
start_scratch_postgres() {
  local dir="$1" sock="$2" extra=("${@:3}")
  mkdir -p "$sock" && chown -R postgres:postgres "$dir" "$sock" && chmod 700 "$dir"
  printf 'local all all trust\n' >"$sock/hba.conf"
  setpriv --reuid=100 --regid=101 --clear-groups pg_ctl -D "$dir" -w -t 3600 -l "$sock/log" start -o \
    "-c config_file=$dir/postgresql.conf -c hba_file=$sock/hba.conf -c listen_addresses='' -c unix_socket_directories=$sock -c port=5439 -c shared_preload_libraries='' -c archive_mode=off ${extra[*]}"
}

stop_scratch_postgres() { setpriv --reuid=100 --regid=101 --clear-groups pg_ctl -D "$1" -w -m fast stop; }

# The newest base backup finished before the target time; recovery can only move forward from one.
base_backup_for() {
  local target="$1" cutoff name time chosen=""
  [[ -n "$target" ]] || { echo LATEST; return; }
  cutoff="$(date -u -d "$target" +%s)"
  while read -r name time; do
    (($(date -u -d "$time" +%s) <= cutoff)) && chosen="$name"
  done < <(walg backup-list --json 2>/dev/null | jq -r 'sort_by(.time) | .[] | "\(.backup_name) \(.time)"')
  [[ -n "$chosen" ]] || { echo "no base backup finished before $target" >&2; return 1; }
  echo "$chosen"
}

# Fetches the base backup into $1 and sets it up to replay WAL from the archive, then lets a scratch
# server run the recovery to the end (or RESTORE_TARGET_TIME) and stop cleanly, so the directory
# can be handed to the real database container, which has no WAL-G of its own.
recover_into() {
  local dir="$1" sock="$2"
  # Emptied rather than removed: on a real restore it is a mount point.
  mkdir -p "$dir" && find "$dir" -mindepth 1 -delete
  walg backup-fetch "$dir" "$(base_backup_for "${RESTORE_TARGET_TIME:-}")"
  # Supabase's server reads its own config file from outside the data directory; give the scratch
  # server a minimal one, and keep whatever postgresql.conf the backup carried out of the way.
  [[ -f "$dir/postgresql.conf" ]] && mv "$dir/postgresql.conf" "$dir/postgresql.conf.supabase"
  {
    echo "restore_command = '/usr/local/bin/orbit-backup wal-fetch %f %p'"
    echo "recovery_target_action = 'promote'"
    [[ -z "${RESTORE_TARGET_TIME:-}" ]] || echo "recovery_target_time = '${RESTORE_TARGET_TIME}'"
  } >"$dir/postgresql.conf"
  touch "$dir/recovery.signal"
  chown -R postgres:postgres "$dir"
  start_scratch_postgres "$dir" "$sock"
  # Recovery is over once the server accepts writes (pg_is_in_recovery() = false).
  local deadline=$((SECONDS + ${RESTORE_TIMEOUT_SEC:-7200}))
  until [[ "$(psql -h "$sock" -p 5439 -U supabase_admin -d postgres -Atc 'select pg_is_in_recovery()' 2>/dev/null)" == "f" ]]; do
    if ((SECONDS > deadline)); then
      tail -20 "$sock/log" >&2
      stop_scratch_postgres "$dir" || true
      echo "recovery did not finish in ${RESTORE_TIMEOUT_SEC:-7200}s; the server log is above" >&2
      return 1
    fi
    sleep 2
  done
}

verify() {
  local scratch="$STATE/verify" sock="$STATE/verify-sock" users records
  rm -rf "$scratch" "$sock"
  if walg_configured; then
    recover_into "$scratch/db" "$sock"
    users="$(psql -h "$sock" -p 5439 -U supabase_admin -d postgres -Atc 'select count(*) from auth.users')"
    records="$(psql -h "$sock" -p 5439 -U supabase_admin -d postgres -Atc 'select count(*) from public.medical_records')"
    stop_scratch_postgres "$scratch/db"
    log "WAL-G copy restored and read: $users users, $records medical records"
  fi
  if restic_configured; then
    rst check --read-data-subset=10% --quiet
    rst restore latest --tag nightly --host orbit --target "$scratch/snapshot" --include "$STATE/snapshot/postgres.dump" --quiet
    # Through a file, not a pipe: grep -q stops reading at the first match, and under pipefail the
    # pg_restore it cut off would fail the check.
    pg_restore --list "$scratch/snapshot/$STATE/snapshot/postgres.dump" >"$scratch/toc"
    grep -q 'TABLE DATA auth users' "$scratch/toc"
    log "snapshot repository consistent; nightly dump lists its tables"
  fi
  rm -rf "$scratch" "$sock"
  echo "restore verified"
}

restore_db() {
  local sock=/restore/.sock
  walg_configured || { echo "BACKUP_WAL_* is not configured; restore from the snapshot instead (docs/SELF_HOSTING.md)" >&2; return 1; }
  recover_into /restore/db "$sock"
  stop_scratch_postgres /restore/db
  # Hand back Supabase's own config arrangement: its server reads /etc/postgresql/postgresql.conf.
  rm -f /restore/db/postgresql.conf
  [[ -f /restore/db/postgresql.conf.supabase ]] && mv /restore/db/postgresql.conf.supabase /restore/db/postgresql.conf
  rm -rf "$sock"
  echo "database restored into /restore/db"
}

# The nightly full dump, for a rebuild when the WAL-G copy is gone too (`deploy/orbit restore
# --from-snapshot`). It is loaded by deploy/backup/migrate-from-supabase.sh like an export.
restore_dump() {
  local tmp=/state/restore-dump snapshot
  snapshot="$(pick_snapshot /state/snapshot nightly)"
  [[ -n "$snapshot" ]] || { echo "no nightly snapshot at or before ${RESTORE_TARGET_TIME:-now}" >&2; return 1; }
  rm -rf "$tmp"
  rst restore "$snapshot" --target "$tmp" --include /state/snapshot/postgres.dump --quiet
  mkdir -p /migration && rm -f /migration/files.tsv /migration/counts.tsv
  mv "$tmp/state/snapshot/postgres.dump" /migration/source.dump
  rm -rf "$tmp"
  echo "database dump from snapshot $snapshot ready"
}

# Brings back what only the snapshot holds: uploaded files and the pgsodium root key Vault
# encrypts with. The files come from the newest snapshot holding them (the 15-minute `files` ones
# and the nightly ones both do) taken at or before RESTORE_TARGET_TIME when one is set, so files and
# database describe the same moment. deploy/orbit mounts the live storage directory and db-config
# volume at /restore/*, after copying the old files aside.
# The newest snapshot with the given tag(s) holding the given path, taken at or before
# RESTORE_TARGET_TIME (or now).
pick_snapshot() {
  local path="$1" snapshot="" cutoff id time t tags=()
  shift
  for t in "$@"; do tags+=(--tag "$t"); done
  cutoff="$(date -u -d "${RESTORE_TARGET_TIME:-now}" +%s)"
  while read -r id time; do
    (($(date -u -d "$time" +%s) <= cutoff)) && snapshot="$id"
  done < <(rst snapshots --json --host orbit "${tags[@]}" |
    jq -r --arg p "$path" 'sort_by(.time) | .[] | select(any(.paths[]; . == $p)) | "\(.short_id) \(.time)"')
  echo "$snapshot"
}

restore_files() {
  local tmp=/state/restore-files snapshot
  # A rebuild from the nightly dump takes the files from that same nightly snapshot, so rows and
  # files describe one moment; otherwise the newest of the 15-minute and nightly snapshots.
  if [[ "${RESTORE_FILES_FROM:-}" == nightly ]]; then
    snapshot="$(pick_snapshot /data/storage nightly)"
  else
    snapshot="$(pick_snapshot /data/storage files nightly)"
  fi
  [[ -n "$snapshot" ]] || { echo "no snapshot with uploaded files at or before ${RESTORE_TARGET_TIME:-now}" >&2; return 1; }
  rm -rf "$tmp"
  rst restore "$snapshot" --target "$tmp" --include /data/storage --quiet
  find /restore/storage -mindepth 1 -delete
  cp -a "$tmp/data/storage/." /restore/storage/
  rm -rf "$tmp"
  rst restore latest --tag nightly --host orbit --target "$tmp" --include /data/db-config --quiet
  if [[ -f "$tmp/data/db-config/pgsodium_root.key" ]]; then
    # The key it replaces is kept for deploy/orbit's rollback, should a later step of the restore fail.
    [[ ! -f /restore/db-config/pgsodium_root.key ]] ||
      cp -a /restore/db-config/pgsodium_root.key /restore/db-config/pgsodium_root.key.before-restore
    cp -a "$tmp/data/db-config/pgsodium_root.key" /restore/db-config/pgsodium_root.key
  fi
  rm -rf "$tmp"
  echo "files restored from snapshot $snapshot, and the Vault key"
}

init() {
  if restic_configured && ! rst cat config >/dev/null 2>&1; then
    rst init
  fi
  if walg_configured; then
    # A new database starts its WAL at the same file names as the one before it, so archiving it
    # into a folder that holds another database's backups would overwrite that one's history -- the
    # copy a replacement server is meant to restore from. WALG_PREVENT_WAL_OVERWRITE stops the
    # overwrite itself; this stops it from being set up at all, and says why.
    local ours theirs
    ours="$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h db -U supabase_admin -d postgres -Atc 'select system_identifier from pg_control_system()')"
    theirs="$(walg backup-list --detail --json 2>/dev/null | jq -r '.[]?.system_identifier' | sort -u)"
    if [[ -n "$theirs" ]] && ! grep -qx "$ours" <<<"$theirs"; then
      echo "bucket 1 ($BACKUP_WAL_S3_PREFIX) already holds the backups of another database." >&2
      echo "If this server replaces a lost one, restore from it first: deploy/orbit restore." >&2
      echo "To start a new chain of backups instead, point BACKUP_WAL_S3_PREFIX at a new, empty folder." >&2
      return 1
    fi
  fi
  touch "$STATE/initialized"
  # From now on the database's archive_command keeps its segments for upload (archive-wal.sh).
  touch "$SPOOL/.enabled"
  echo "backup storage reachable"
}

status() {
  local name
  for name in wal_push base_backup snapshot_files snapshot_full verify; do
    if [[ -f "$STATE/last_$name" ]]; then
      printf '  %-15s %s ago\n' "$name" "$(($(age_of "last_$name") / 60)) min"
    else
      printf '  %-15s never\n' "$name"
    fi
    [[ ! -f "$STATE/failing_$name" ]] || printf '  %-15s FAILING since %s\n' "" "$(cat "$STATE/failing_$name")"
  done
  printf '  %-15s %s files waiting\n' "wal spool" "$(find "$SPOOL" -maxdepth 1 -type f ! -name '.*' ! -name '*.part' | wc -l)"
}

# --- The loop -------------------------------------------------------------------------------------

daemon() {
  local today last_day="" files_every=$((${BACKUP_FILES_INTERVAL_MIN:-15} * 60)) alerted_spool=0
  if ! walg_configured && ! restic_configured; then
    log "no backup storage configured (BACKUP_* in deploy/.env); idle"
    exec sleep infinity
  fi
  until [[ -f "$STATE/initialized" ]]; do
    log "waiting for deploy/orbit backup setup"
    sleep 60
  done
  log "backup daemon up: wal=$(walg_configured && echo on || echo off) snapshots=$(restic_configured && echo on || echo off)"
  while true; do
    walg_configured && { push_spool || true; }

    # A segment stuck in the spool means the database is no longer copied off the server.
    if [[ -n "$(find "$SPOOL" -maxdepth 1 -type f ! -name '.*' -mmin +15 -print -quit)" ]]; then
      if ((SECONDS - alerted_spool > 3600 || alerted_spool == 0)); then
        notify "WAL has not reached bucket 1 for 15+ minutes"
        alerted_spool=$SECONDS
      fi
    fi

    if restic_configured && (($(age_of last_snapshot_files) >= files_every)); then
      job snapshot_files snapshot_files || true
    fi

    today="$(date -u +%F)"
    if [[ "$today" != "$last_day" && "$(date -u +%H%M)" > "${BACKUP_TIME_UTC:-0330}" ]] &&
      (($(age_of last_nightly_run) > 20 * 3600)); then
      last_day="$today"
      nightly || true
      if [[ "$(date -u +%u)" == "${BACKUP_VERIFY_WEEKDAY:-7}" ]]; then
        job verify verify || true
        restic_configured && { job prune prune || true; }
      fi
    fi
    sleep 5
  done
}

case "${1:-daemon}" in
  __job)
    shift
    "$@"
    ;;
  daemon) daemon ;;
  nightly) nightly ;;
  files) job snapshot_files snapshot_files ;;
  verify) job verify verify ;;
  restore-db) restore_db ;;
  restore-files) restore_files ;;
  restore-dump) restore_dump ;;
  init) init ;;
  status) status ;;
  # restore_command of the scratch recovery server.
  wal-fetch) walg wal-fetch "$2" "$3" ;;
  *) echo "unknown command: $1" >&2 && exit 2 ;;
esac
