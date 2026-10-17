# shellcheck shell=bash
# Shared helpers for deploy/orbit. Sourced, never run.

c_green() { printf '\033[32m%s\033[0m' "$*"; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[32mOK\033[0m   %s\n' "$*"; }
warn() { printf '\033[33mWARN\033[0m %s\n' "$*" >&2; }
err() { printf '\033[31mERR\033[0m  %s\n' "$*" >&2; }
die() {
  err "$*"
  exit 1
}

# retry <attempts> <command...> -- exponential backoff for network calls (2s, 4s, 8s, ...).
retry() {
  local attempts="$1" delay=2 n=1
  shift
  until "$@"; do
    ((n >= attempts)) && return 1
    warn "Attempt $n of $attempts failed: $*; retrying in ${delay}s"
    sleep "$delay"
    n=$((n + 1))
    delay=$((delay * 2))
  done
}

# What the stack needs from the machine. Each failure says how to fix it.
preflight_server() {
  local problems=0 mem_mb disk_gb probe="${ORBIT_DATA_DIR:-/var/lib}"
  while [[ ! -d "$probe" ]]; do probe="$(dirname "$probe")"; done
  command -v docker >/dev/null || {
    err "Docker is not installed. Install it with: curl -fsSL https://get.docker.com | sh"
    problems=$((problems + 1))
  }
  if command -v docker >/dev/null; then
    docker compose version >/dev/null 2>&1 || {
      err "The Docker Compose plugin is missing (docker compose). It comes with the get.docker.com install."
      problems=$((problems + 1))
    }
    docker info >/dev/null 2>&1 || {
      err "Cannot talk to Docker. Run as root, or add yourself to the docker group and log in again."
      problems=$((problems + 1))
    }
  fi
  for tool in git curl openssl; do
    command -v "$tool" >/dev/null || {
      err "$tool is not installed (apt install -y $tool)"
      problems=$((problems + 1))
    }
  done
  mem_mb="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo 2>/dev/null || echo 0)"
  ((mem_mb >= 1800)) || warn "This server has ${mem_mb} MB of RAM; Orbit needs at least 2 GB"
  disk_gb="$(df -Pk "$probe" 2>/dev/null | awk 'NR==2 {print int($4 / 1048576)}' || echo 0)"
  ((disk_gb >= 15)) || warn "Only ${disk_gb} GB free on disk; leave at least 15 GB for images, data and the WAL spool"
  ((problems == 0)) || die "The server is not ready: fix the $problems problem(s) above."
}

# Docker Hub limits anonymous pulls and is unreachable from some networks (Russia among them).
# ORBIT_REGISTRY_MIRROR=https://mirror.gcr.io (or any Docker Hub mirror) routes pulls through it.
configure_registry_mirror() {
  local mirror="${ORBIT_REGISTRY_MIRROR:-}" daemon_json=/etc/docker/daemon.json
  [[ -n "$mirror" ]] || return 0
  if [[ -f "$daemon_json" ]] && grep -q "$mirror" "$daemon_json"; then return 0; fi
  if [[ -f "$daemon_json" ]] && [[ -s "$daemon_json" ]]; then
    warn "$daemon_json already exists; add \"registry-mirrors\": [\"$mirror\"] to it yourself and restart Docker"
    return 0
  fi
  step "Routing Docker Hub pulls through $mirror"
  printf '{\n  "registry-mirrors": ["%s"]\n}\n' "$mirror" >"$daemon_json"
  if command -v systemctl >/dev/null && systemctl is-active --quiet docker; then
    systemctl restart docker
  else
    warn "Restart the Docker daemon so it picks up $daemon_json"
  fi
}

# Running, the stack takes about 0.9 GB; building the web app peaks at about 2 GB on top of what is
# already running (docs/SELF_HOSTING.md, "What runs where"). A server with less than 4 GB therefore
# gets a 2 GB swap file the first time, unless it has swap already or ORBIT_NO_SWAP=true. Swap is
# only touched during builds; the running stack fits in memory.
ensure_swap() {
  local mem_mb swap_mb
  mem_mb="$(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo 2>/dev/null || echo 0)"
  swap_mb="$(awk '/SwapTotal/ {print int($2 / 1024)}' /proc/meminfo 2>/dev/null || echo 0)"
  ((mem_mb > 0 && mem_mb < 3800 && swap_mb < 1024)) || return 0
  [[ "${ORBIT_NO_SWAP:-false}" != "true" ]] || return 0
  if [[ "$(id -u)" != 0 ]] || [[ -e /orbit.swap ]]; then
    warn "This server has ${mem_mb} MB of RAM and no swap; building the app may run out of memory. Add swap, or run as root once so deploy/orbit adds it."
    return 0
  fi
  step "Adding a 2 GB swap file (${mem_mb} MB of RAM is tight for building the app)"
  if fallocate -l 2G /orbit.swap 2>/dev/null || dd if=/dev/zero of=/orbit.swap bs=1M count=2048 status=none; then
    chmod 600 /orbit.swap && mkswap /orbit.swap >/dev/null && swapon /orbit.swap &&
      { grep -q '^/orbit.swap ' /etc/fstab || echo '/orbit.swap none swap sw 0 0' >>/etc/fstab; } &&
      ok "swap on: /orbit.swap" && return 0
  fi
  rm -f /orbit.swap
  warn "Could not add swap here (some containers and VPS types forbid it); the build may run out of memory."
}
