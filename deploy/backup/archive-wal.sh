#!/bin/sh
# archive_command of the database container (deploy/docker-compose.yml, service db):
#   archive-wal.sh %p %f
# Copies a finished WAL segment into the spool the `backup` container uploads from. It must only
# report success once the copy is on disk, because Postgres recycles the segment afterwards.
#
# Until `deploy/orbit backup setup` creates /wal-spool/.enabled the segment is acknowledged and
# dropped -- exactly what happens with archiving off -- so an instance without backup storage does
# not fill its disk with WAL nobody will upload.
set -eu
spool=/wal-spool
[ -f "$spool/.enabled" ] || exit 0
# Postgres may retry a segment it already archived; an identical copy is success, a different one
# an error worth stopping for.
if [ -f "$spool/$2" ]; then
  cmp -s "$1" "$spool/$2"
  exit $?
fi
dd if="$1" of="$spool/$2.part" bs=1M conv=fsync 2>/dev/null
mv "$spool/$2.part" "$spool/$2"
# The rename is only durable once the directory is: without this, a power cut could leave the
# segment acknowledged to Postgres but present only as an ignored .part, a gap in the archive.
sync "$spool"
