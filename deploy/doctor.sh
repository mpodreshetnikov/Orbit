#!/usr/bin/env bash
# What this server's network lets Orbit reach, in enough detail to tell the usual causes apart:
# a link smaller than 1500 bytes, IPv4 or IPv6 missing or filtered, DNS answering differently for
# containers, a provider that cuts long transfers short, a service that refuses the server. Also
# what fills its disk, and why a request through Caddy failed.
#
#   sudo deploy/orbit doctor          on the server
#   Actions -> Deploy to your server -> Run workflow, action "doctor"   from GitHub
#
# Self-contained, and only reads: GitHub sends it over SSH, so it works whatever version of Orbit
# the server has. It prints addresses and timings, nothing of Orbit's data or settings.
set -uo pipefail

urls=(
  https://api.github.com
  https://accounts.google.com/.well-known/openid-configuration
  https://deno.land
  https://registry.npmjs.org
  https://jsr.io/@std/path/meta.json
  https://jsr.io
  https://openrouter.ai/api/v1/models
  https://api.telegram.org
  https://hc-ping.com
  https://uptime.betterstack.com
  # Other heartbeat monitors, to pick one this server reaches when the one in use is blocked.
  https://healthchecks.io
  https://cronitor.link
  https://heartbeat.uptimerobot.com
  https://nosnch.in
  https://push.statuscake.com
  https://ping.checklyhq.com
  https://api.honeybadger.io
  https://sentry.io
  https://ping-admin.com
)
fmt='%{http_code} exit=%{exitcode} ip=%{remote_ip} connect=%{time_connect}s tls=%{time_appconnect}s total=%{time_total}s bytes=%{size_download}'

# The first address of a family. getent maps IPv4 into IPv6 (::ffff:a.b.c.d), which is not an
# AAAA record and would read as one.
first_addr() { getent "$1" "$2" 2>/dev/null | awk '$1 !~ /^::ffff:/ {print $1; exit}'; }

echo "== This server"
route="$(ip -o route get 1.1.1.1 2>/dev/null || true)"
dev="$(sed -n 's/.* dev \([^ ]*\).*/\1/p' <<<"$route")"
echo "link:        ${dev:-?}, MTU $(cat "/sys/class/net/${dev:-none}/mtu" 2>/dev/null || echo '?')"
echo "IPv6 route:  $(ip -6 route get 2606:4700:4700::1111 2>&1 | head -1 || echo none)"
echo "resolvers:   $(awk '/^nameserver/ {print $2}' /etc/resolv.conf | paste -sd' ')"
if command -v resolvectl >/dev/null; then
  echo "upstream:    $(resolvectl dns 2>/dev/null | awk -F': ' 'NF > 1 && $2 != "" {print $2}' | paste -sd' ')"
fi
echo "MSS clamp:   $(iptables -t mangle -S FORWARD 2>/dev/null | grep -c TCPMSS) rule(s) in mangle FORWARD"
echo "Docker:      $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo 'not running')"
net="$(docker inspect supabase-edge-functions --format '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' 2>/dev/null | awk '{print $1}')"
net="${net:-orbit_default}"
echo "Orbit's net: $net, $(docker network inspect "$net" --format 'driver MTU {{or (index .Options "com.docker.network.driver.mtu") "default (1500)"}}, IPv6 {{.EnableIPv6}}' 2>/dev/null || echo 'not found')"

# Sizes only, no file names below the top level: this log is public. A deploy warns under 15 GB free
# (preflight_server in deploy/lib/common.sh); this says what holds the rest.
echo
echo "== Disk"
df -h / /var/lib/docker /var/lib/orbit 2>/dev/null | awk 'NR == 1 || !seen[$1]++' | sed 's/^/   /'
echo "Docker:"
docker system df 2>/dev/null | sed 's/^/   /'
echo "prebuilt images kept: $(docker images --format '{{.Tag}}' 2>/dev/null | grep -c -E '^[0-9a-f]{40}$')"
echo "largest directories:"
du -xsh /var/lib/docker /var/lib/orbit/* /var/log /var/cache /opt /home /root /tmp /orbit.swap 2>/dev/null |
  sort -rh | head -12 | sed 's/^/   /'

echo
echo "== From the server"
for url in "${urls[@]}"; do
  host="${url#https://}"
  host="${host%%/*}"
  echo "$url"
  echo "   DNS   A $(first_addr ahostsv4 "$host")  AAAA $(first_addr ahostsv6 "$host")"
  echo "   IPv4  $(curl -4 -s -o /dev/null -m 15 -w "$fmt" "$url")"
  echo "   IPv6  $(curl -6 -s -o /dev/null -m 15 -w "$fmt" "$url")"
done

echo
echo "== From Orbit's network, where the services run"
if ! docker network inspect "$net" >/dev/null 2>&1; then
  echo "Orbit's network $net does not exist: Orbit is not running (deploy/orbit install, or update)."
elif docker image inspect orbit-backup:local >/dev/null 2>&1; then
  # The loop runs in the container: its variables are meant for that shell, not this one.
  # shellcheck disable=SC2016
  docker run --rm --network "$net" --entrypoint sh orbit-backup:local -c '
    fmt="$1"; shift
    echo "resolvers:   $(awk "/^nameserver/ {print \$2}" /etc/resolv.conf | paste -sd" ")"
    echo "link MTU:    $(cat /sys/class/net/eth0/mtu 2>/dev/null)"
    for url in "$@"; do
      host="${url#https://}"; host="${host%%/*}"
      echo "$url"
      echo "   DNS   $(getent ahosts "$host" | awk "NR == 1 {print \$1}")"
      echo "   curl  $(curl -s -o /dev/null -m 15 -w "$fmt" "$url")"
    done' sh "$fmt" "${urls[@]}"
else
  echo "No orbit-backup:local image yet: install first (deploy/orbit install)."
fi

# A 502 the browser or Claude sees is Caddy failing to reach a service. This says whether the web
# app restarted or was killed, what memory looks like, and when Caddy failed and why, counted per
# minute. Paths without their query and Caddy's own message only: this log is public.
echo
echo "== Web app and proxy"
for c in orbit-web orbit-caddy; do
  echo "$c: $(docker inspect "$c" --format '{{.State.Status}} since {{.State.StartedAt}}, {{.RestartCount}} restart(s), OOM killed {{.State.OOMKilled}}, last exit {{.State.ExitCode}}' 2>/dev/null || echo 'no container')"
done
echo "memory:"
free -m 2>/dev/null | sed 's/^/   /'
docker stats --no-stream --format '{{.Name}} {{.MemUsage}} cpu {{.CPUPerc}}' 2>/dev/null | sort | sed 's/^/   /'
echo "kernel OOM kills, last 3 days: $(journalctl -k --since '-72h' 2>/dev/null | grep -c -i 'killed process')"
echo "Caddy's failed requests, last 3 days (count, minute UTC, path, why):"
docker logs --since 72h orbit-caddy 2>&1 | grep '"logger":"http.log.error"' |
  awk '{
    ts = 0; uri = ""; msg = ""
    if (match($0, /"ts":[0-9]+/)) ts = substr($0, RSTART + 5, RLENGTH - 5)
    if (match($0, /"uri":"[^"?]*/)) uri = substr($0, RSTART + 7, RLENGTH - 7)
    if (match($0, /"msg":"[^"]*/)) msg = substr($0, RSTART + 7, RLENGTH - 7)
    sub(/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+:[0-9]+->/, "", msg)
    print int(ts / 60) * 60, uri, substr(msg, 1, 80)
  }' | uniq -c | tail -80 |
  while read -r n minute rest; do
    echo "   $n  $(date -u -d "@$minute" '+%F %H:%M')  $rest"
  done

# The heartbeat (BACKUP_HEALTHCHECK_URL) is pinged after each nightly run; when it goes quiet, this
# says whether the daemon ran, is stuck in a job, or failed. Only the daemon's own lines are shown:
# a tool's error output can name buckets and endpoints, and this log is public.
echo
echo "== Backups"
if ! docker inspect orbit-backup >/dev/null 2>&1; then
  echo "No orbit-backup container."
else
  echo "container:   $(docker inspect orbit-backup --format '{{.State.Status}} since {{.State.StartedAt}}, {{.RestartCount}} restart(s)')"
  echo "now:         $(date -u +%FT%TZ)"
  # shellcheck disable=SC2016
  docker exec orbit-backup sh -c '
    for f in /state/last_* /state/failing_* /state/initialized; do
      [ -f "$f" ] || continue
      case "$f" in
        */last_*) echo "   $(basename "$f")  $(date -u -d "@$(cat "$f")" +%FT%TZ)" ;;
        *) echo "   $(basename "$f")  $(date -u -r "$f" +%FT%TZ)" ;;
      esac
    done
    # The image has no ps; a process directory is created when the process starts.
    echo "processes, with their start:"
    for p in /proc/[0-9]*; do
      c="$(cat "$p/comm" 2>/dev/null)" || continue
      case "$c" in sh | sleep | cat | date | "") continue ;; esac
      echo "   $(date -u -r "$p" +%FT%TZ)  $c"
    done' 2>&1
  echo "daemon log, last 3 days:"
  docker logs --since 72h orbit-backup 2>&1 |
    grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]+Z (start|done|ALERT|backup daemon|a backup loop|waiting|no backup)' |
    grep -v -E ' (start|done) (snapshot_files|wal)' | tail -60 | sed 's/^/   /'
fi
