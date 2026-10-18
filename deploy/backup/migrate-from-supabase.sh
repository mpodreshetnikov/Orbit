#!/usr/bin/env bash
# Moves an Orbit from hosted Supabase onto this instance. Runs in the backup container (it has
# pg_dump/psql 17, curl and jq), started by `deploy/orbit migrate-from-supabase`:
#
#   export   read the hosted project: a data-only dump of auth, public and storage, the row count of
#            every table in it, and every Storage object with its SHA-256. Writes /migration.
#   import   load /migration into this instance's database and Storage, replacing what is there.
#   verify   compare row counts and object checksums between /migration and this instance.
#
# Schema is not copied: this instance builds it from the repository's migrations (deploy/orbit
# install), exactly as production did, and only the data moves. Supabase's own bookkeeping
# (auth.schema_migrations, storage.migrations), Vault secrets and cron jobs stay per instance.
set -euo pipefail

DIR=/migration
SCHEMAS=(auth public storage)
EXCLUDE=(auth.schema_migrations storage.migrations)
target_psql() { PGPASSWORD="$POSTGRES_PASSWORD" psql -h db -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
log() { printf '%s %s\n' "$(date -u +%TZ)" "$*"; }

# Each path segment of an object name percent-encoded, the slashes kept.
object_url() { printf '%s/storage/v1/object/%s/%s' "$1" "$2" "$(jq -rn --arg n "$3" '$n | split("/") | map(@uri) | join("/")')"; }

# The tables of auth, public and storage whose data is in the dump, as schema.table, one per line.
# The dump is either `export`'s, or the nightly full dump from the snapshot (restore-from-snapshot),
# which also holds Supabase's internal schemas; those are never loaded.
dump_tables() {
  pg_restore --list "$DIR/source.dump" |
    awk -v schemas="${SCHEMAS[*]}" -v exclude="${EXCLUDE[*]}" '
      BEGIN { split(schemas, s, " "); for (i in s) want[s[i]] = 1; split(exclude, e, " "); for (i in e) skip[e[i]] = 1 }
      $4 == "TABLE" && $5 == "DATA" && ($6 in want) && !(($6 "." $7) in skip) {print $6 "." $7}'
}

export_source() {
  : "${SOURCE_DB_URL:?SOURCE_DB_URL is required}" "${SOURCE_SUPABASE_URL:?}" "${SOURCE_SERVICE_ROLE_KEY:?}"
  local args=() s t bucket name mime file snapshot in out
  mkdir -p "$DIR/files"
  for s in "${SCHEMAS[@]}"; do args+=(--schema="$s"); done
  for t in "${EXCLUDE[@]}"; do args+=(--exclude-table="$t"); done

  # Dump, row counts and the list of Storage objects all read one snapshot of the hosted database,
  # so a write landing during the export cannot leave counts or files out of step with the dump.
  # A session holds the snapshot open (pg_export_snapshot) while the others attach to it.
  coproc HOLD { psql "$SOURCE_DB_URL" -qAtX -v ON_ERROR_STOP=1; }
  in="${HOLD[1]}" out="${HOLD[0]}"
  printf 'begin isolation level repeatable read;\nselect pg_export_snapshot();\n' >&"$in"
  read -r -t 60 snapshot <&"$out" || { echo "could not open a snapshot on the hosted database" >&2; return 1; }
  in_snapshot() {
    psql "$SOURCE_DB_URL" -qAtX -v ON_ERROR_STOP=1 "$@" -c "begin isolation level repeatable read" \
      -c "set transaction snapshot '$snapshot'" -c "$SQL" -c "commit"
  }

  log "dumping data from the hosted database (snapshot $snapshot)"
  pg_dump "$SOURCE_DB_URL" --snapshot="$snapshot" --format=custom --data-only --no-owner "${args[@]}" --file="$DIR/source.dump"

  log "counting rows"
  SQL="$(dump_tables | awk -v q="'" '{printf "%sselect %s, count(*) from %s", (NR > 1 ? " union all " : ""), q $0 q, $0}')"
  SQL="$SQL" in_snapshot -F $'\t' >"$DIR/counts.tsv"

  log "downloading Storage objects"
  SQL="select bucket_id, name, coalesce(metadata->>'mimetype', '') from storage.objects order by 1, 2" \
    in_snapshot -F $'\t' >"$DIR/objects.tsv"
  printf 'commit;\n' >&"$in"
  exec {in}>&-
  wait "$HOLD_PID" 2>/dev/null || true

  : >"$DIR/files.tsv"
  while IFS=$'\t' read -r bucket name mime; do
    file="$DIR/files/$bucket/$name"
    mkdir -p "$(dirname "$file")"
    curl -fsS --retry 4 -H "apikey: $SOURCE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SOURCE_SERVICE_ROLE_KEY" \
      -o "$file" "$(object_url "$SOURCE_SUPABASE_URL" "$bucket" "$name")"
    printf '%s\t%s\t%s\t%s\n' "$bucket" "$name" "${mime:-application/octet-stream}" "$(sha256sum "$file" | cut -d' ' -f1)" >>"$DIR/files.tsv"
  done <"$DIR/objects.tsv"
  rm -f "$DIR/objects.tsv"

  log "exported $(wc -l <"$DIR/counts.tsv") tables and $(wc -l <"$DIR/files.tsv") objects into the migration directory"
}

import_into_target() {
  [[ -f "$DIR/source.dump" ]] || { echo "nothing exported yet: run deploy/orbit migrate-from-supabase export first" >&2; return 1; }
  local list="$DIR/restore.list" missing tables sequences bucket name mime sum file
  : "${SERVICE_ROLE_KEY:?}"

  # Load only into tables this instance has. A table the hosted project has and this one does not
  # (a newer Supabase feature) is reported, not silently dropped.
  missing="$(dump_tables | while read -r t; do
    [[ "$(target_psql -c "select to_regclass('$t') is not null")" == t ]] || echo "$t"
  done)"
  if [[ -n "$missing" ]]; then
    echo "not in this instance, so not imported: $(paste -sd" " <<<"$missing")" >&2
  fi
  # Lists travel through the environment: awk -v does not take a value with newlines in it.
  tables="$(dump_tables | MISSING="$missing" awk 'BEGIN { n = split(ENVIRON["MISSING"], m, "\n"); for (i = 1; i <= n; i++) skip[m[i]] = 1 }
      !($0 in skip)')"
  # Sequence values, likewise only for sequences this instance has: one that belongs to a table it
  # lacks would stop the whole load on its setval.
  sequences="$(pg_restore --list "$DIR/source.dump" |
    awk -v schemas="${SCHEMAS[*]}" 'BEGIN { split(schemas, s, " "); for (i in s) want[s[i]] = 1 }
      $4 == "SEQUENCE" && $5 == "SET" && ($6 in want) {print $6 "." $7}' |
    while read -r t; do
      [[ "$(target_psql -c "select to_regclass('$t') is not null")" != t ]] || echo "$t"
    done)"
  # The restore list: the data of exactly those tables, and the values of exactly those sequences.
  pg_restore --list "$DIR/source.dump" |
    TABLES="$tables" SEQUENCES="$sequences" awk '
      BEGIN { n = split(ENVIRON["TABLES"], t, "\n"); for (i = 1; i <= n; i++) load[t[i]] = 1
              n = split(ENVIRON["SEQUENCES"], q, "\n"); for (i = 1; i <= n; i++) setval[q[i]] = 1 }
      ($4 == "TABLE" && $5 == "DATA" && ($6 "." $7) in load) || ($4 == "SEQUENCE" && $5 == "SET" && ($6 "." $7) in setval)' >"$list"
  # A column the hosted project has and this instance lacks -- its Supabase release is ahead of the
  # one pinned here -- would stop the load halfway on a bare COPY error. Name them all up front.
  local table columns column have unknown=""
  while read -r table columns; do
    have=",$(target_psql -c "select string_agg(column_name, ',') from information_schema.columns
      where table_schema || '.' || table_name = '${table//\"/}'"),"
    for column in ${columns//,/ }; do
      column="${column//\"/}"
      [[ "$have" == *",$column,"* ]] || unknown+=" $table.$column"
    done
  done < <(pg_restore --data-only --use-list="$list" --file=- "$DIR/source.dump" |
    sed -n 's/^COPY \([^ ]*\) (\(.*\)) FROM stdin;$/\1 \2/p')
  if [[ -n "$unknown" ]]; then
    echo "the hosted data has columns this instance does not:$unknown" >&2
    echo "Its Supabase is newer than the release pinned in deploy/supabase-upstream.env: pin a newer" >&2
    echo "self-hosted release there, run deploy/orbit update, then import again. Nothing was changed." >&2
    return 1
  fi
  # Before an export's rows replace this instance's: delete its current files through the Storage
  # API, which removes them from disk as well. Loading the rows alone would leave the files of the
  # previous import behind, unreferenced, and in every snapshot from then on. A snapshot restore
  # (no files.tsv) has just put its own files in place and keeps them.
  if [[ -f "$DIR/files.tsv" ]]; then
    while IFS=$'\t' read -r bucket name; do
      curl -fsS --retry 4 -o /dev/null -X DELETE -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
        "$(object_url http://kong:8000 "$bucket" "$name")"
    done < <(target_psql -F $'\t' -c "select bucket_id, name from storage.objects")
  fi

  tables="$(paste -sd, - <<<"$tables")"
  log "replacing the data of $(tr ',' '\n' <<<"$tables" | wc -l) tables in one transaction"
  {
    # Replica mode: no triggers and no foreign-key checks while tables load in dump order.
    echo "set session_replication_role = replica;"
    echo "truncate $tables cascade;"
    pg_restore --data-only --no-owner --use-list="$list" --file=- "$DIR/source.dump"
  } | PGPASSWORD="$POSTGRES_PASSWORD" psql -h db -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q --single-transaction >/dev/null

  # Storage rows arrived with the data, but the files behind them did not. Upload each file through
  # the Storage API, which writes it where this instance keeps files, then give the rows back the
  # identity, owner and timestamps they had on the hosted project.
  # A dump from the snapshot comes with its files already restored into place: nothing to upload.
  [[ -f "$DIR/files.tsv" ]] || { log "import done (rows only; files were restored with the snapshot)"; return 0; }
  log "uploading $(wc -l <"$DIR/files.tsv") Storage objects"
  target_psql <<'SQL'
drop schema if exists orbit_migration cascade;
create schema orbit_migration;
create table orbit_migration.objects as select * from storage.objects;
-- storage.protect_delete() refuses direct deletes; replica mode skips it, as for the load above.
set session_replication_role = replica;
delete from storage.objects;
SQL
  while IFS=$'\t' read -r bucket name mime sum; do
    file="$DIR/files/$bucket/$name"
    curl -fsS --retry 4 -o /dev/null -X POST -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      -H "x-upsert: true" -H "Content-Type: $mime" --data-binary "@$file" "$(object_url http://kong:8000 "$bucket" "$name")"
  done <"$DIR/files.tsv"
  target_psql <<'SQL'
update storage.objects o
   set id = s.id, owner = s.owner, owner_id = s.owner_id, created_at = s.created_at,
       updated_at = s.updated_at, last_accessed_at = s.last_accessed_at, user_metadata = s.user_metadata
  from orbit_migration.objects s
 where s.bucket_id = o.bucket_id and s.name = o.name;
drop schema orbit_migration cascade;
SQL
  log "import done"
}

verify_target() {
  local t want got bucket name mime sum file problems=0
  : "${SERVICE_ROLE_KEY:?}"
  [[ -f "$DIR/counts.tsv" ]] || { echo "no export to compare with (a snapshot restore has none)"; return 0; }
  while IFS=$'\t' read -r t want; do
    # The deploy log gains this instance's own deploy right after the import.
    [[ "$t" == public.db_deploy_log ]] && continue
    got="$(target_psql -c "select count(*) from $t" 2>/dev/null || echo missing)"
    if [[ "$got" != "$want" ]]; then
      printf 'MISMATCH %-45s hosted %s, here %s\n' "$t" "$want" "$got"
      problems=$((problems + 1))
    fi
  done <"$DIR/counts.tsv"
  file="$(mktemp)"
  while IFS=$'\t' read -r bucket name mime sum; do
    if ! curl -fsS -o "$file" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
      "$(object_url http://kong:8000 "$bucket" "$name")" || [[ "$(sha256sum "$file" | cut -d' ' -f1)" != "$sum" ]]; then
      printf 'MISMATCH object %s/%s\n' "$bucket" "$name"
      problems=$((problems + 1))
    fi
  done <"$DIR/files.tsv"
  rm -f "$file"
  if ((problems > 0)); then
    echo "$problems difference(s) between the hosted project and this instance" >&2
    return 1
  fi
  echo "verified: $(wc -l <"$DIR/counts.tsv") tables have the same row counts, $(wc -l <"$DIR/files.tsv") objects the same bytes"
}

case "${1:-}" in
  export) export_source ;;
  import) import_into_target ;;
  verify) verify_target ;;
  *) echo "usage: migrate-from-supabase.sh export|import|verify" >&2 && exit 2 ;;
esac
