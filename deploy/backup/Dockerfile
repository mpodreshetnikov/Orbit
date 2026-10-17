# The `backup` service (deploy/docker-compose.yml): WAL-G for the continuous physical copy, restic
# for the nightly snapshot, and a stock PostgreSQL 17 to rehearse restores with. docs/SELF_HOSTING.md,
# "Backups", says what each one is for.
FROM ubuntu:24.04

ARG TARGETARCH
ARG WALG_VERSION=v3.0.9
ARG RESTIC_VERSION=0.19.1

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg bzip2 jq tzdata \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" >/etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17 postgresql-client-17 locales \
  && rm -rf /var/lib/apt/lists/* \
  && echo "en_US.UTF-8 UTF-8" >/etc/locale.gen && locale-gen
# Supabase's database is created with LC_COLLATE en_US.UTF-8; a server without it refuses to open it.

# Checksums pinned here, so a tampered or truncated download fails the build instead of shipping.
RUN set -eu; \
  case "$TARGETARCH" in \
    amd64) walg=wal-g-pg-24.04-amd64; walg_sum=444ce216230c254edef803e098a59a1746806da3e0d55671d7b0f0082db14ef4; \
           restic=restic_${RESTIC_VERSION}_linux_amd64; restic_sum=f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c ;; \
    arm64) walg=wal-g-pg-24.04-aarch64; walg_sum=cb37c5f8391bd8ef2efceeb9c6995059c0abf2fa74b9b717b42a16a7c93cfde1; \
           restic=restic_${RESTIC_VERSION}_linux_arm64; restic_sum=a5f64aaab53d51e311fa3829124c5b703f2d14cf187d8640b6be3b2b49376465 ;; \
    *) echo "unsupported architecture $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  curl -fsSL -o /tmp/walg.tgz "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/${walg}.tar.gz"; \
  echo "${walg_sum}  /tmp/walg.tgz" | sha256sum -c -; \
  tar -xzf /tmp/walg.tgz -C /tmp && install -m 0755 "/tmp/${walg}" /usr/local/bin/wal-g; \
  curl -fsSL -o /tmp/restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/${restic}.bz2"; \
  echo "${restic_sum}  /tmp/restic.bz2" | sha256sum -c -; \
  bunzip2 -c /tmp/restic.bz2 >/usr/local/bin/restic && chmod 0755 /usr/local/bin/restic; \
  rm -f /tmp/walg.tgz "/tmp/${walg}" /tmp/restic.bz2; \
  wal-g --version && restic version

# Same uid/gid as the postgres user in supabase/postgres, so a restored data directory is owned
# correctly and the scratch recovery server (run as this user) can open it. The container itself
# runs as root: it reads deploy/.env (mode 600) into the snapshot.
RUN groupmod -g 1101 ubuntu 2>/dev/null || true; usermod -u 1100 ubuntu 2>/dev/null || true; \
  groupmod -o -g 101 postgres && usermod -o -u 100 -g 101 postgres

COPY run.sh /usr/local/bin/orbit-backup
COPY migrate-from-supabase.sh /usr/local/bin/migrate-from-supabase
ENV PATH="/usr/lib/postgresql/17/bin:${PATH}"
ENTRYPOINT ["/usr/local/bin/orbit-backup"]
CMD ["daemon"]
