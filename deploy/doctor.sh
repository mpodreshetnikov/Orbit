#!/usr/bin/env bash
# What this server's network lets Orbit reach, in enough detail to tell the usual causes apart:
# a link smaller than 1500 bytes, IPv4 or IPv6 missing or filtered, DNS answering differently for
# containers, a provider that cuts long transfers short, a service that refuses the server.
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
)
fmt='%{http_code} exit=%{exitcode} ip=%{remote_ip} connect=%{time_connect}s tls=%{time_appconnect}s total=%{time_total}s bytes=%{size_download}'

first_addr() { getent "$1" "$2" 2>/dev/null | awk 'NR == 1 {print $1}'; }

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
if docker image inspect orbit-backup:local >/dev/null 2>&1; then
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
