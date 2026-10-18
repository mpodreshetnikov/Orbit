#!/usr/bin/env bash
# Turns a fresh Ubuntu or Debian server into one Orbit can run on, safely. Run it as root:
#
#   curl -fsSL https://raw.githubusercontent.com/mpodreshetnikov/Orbit/main/deploy/bootstrap.sh | bash
#
# What it does, each step safe to repeat (docs/SELF_HOSTING.md, "What the server setup does"):
#   - installs Docker and the few tools deploy/orbit needs, with automatic security updates;
#   - creates the user `orbit`, who logs in with the same SSH keys as root and may use sudo;
#   - SSH: keys only, no root login -- but only once `orbit` has a key, so nobody is locked out;
#   - firewall: only SSH (22), HTTP (80) and HTTPS (443) are reachable; fail2ban bans password
#     guessers;
#   - clones Orbit into /opt/orbit and, when deploy/.env is complete, runs `deploy/orbit install`.
#
# Settings, all optional, as environment variables:
#   ORBIT_SETTINGS    a file of NAME=value settings for deploy/.env (with them the install runs
#                     unattended; deploy/.env.example lists the names)
#   ORBIT_SSH_KEY     an SSH public key to let in as `orbit` (in addition to root's keys)
#   ORBIT_REPO        the repository to clone (default: the public Orbit repository)
#   ORBIT_REF         the branch, tag or commit to check out (default: main)
#   ORBIT_DIR         where to put it (default: /opt/orbit)
#   ORBIT_SKIP_INSTALL=true   prepare the server only, do not run deploy/orbit install
#   ORBIT_TOKEN_FILE  a file holding a GitHub token, for a private repository and its images; used
#                     for this run only (deploy/ci/deploy.sh passes the workflow's)
set -Eeuo pipefail

ORBIT_REPO_GIVEN="${ORBIT_REPO:+yes}"
ORBIT_REPO="${ORBIT_REPO:-https://github.com/mpodreshetnikov/Orbit.git}"
ORBIT_REF="${ORBIT_REF:-main}"
ORBIT_DIR="${ORBIT_DIR:-/opt/orbit}"
ORBIT_USER=orbit
export DEBIAN_FRONTEND=noninteractive

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
ok() { printf '\033[32mOK\033[0m   %s\n' "$*"; }
warn() { printf '\033[33mWARN\033[0m %s\n' "$*" >&2; }
die() {
  printf '\033[31mERR\033[0m  %s\n' "$*" >&2
  exit 1
}
# git with the GitHub token, when there is one, as an HTTP header passed through the environment:
# neither the command line nor the checkout's config ever holds it.
gitx() {
  if [[ -n "${ORBIT_TOKEN_FILE:-}" ]]; then
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.https://github.com/.extraheader \
      GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$(cat "$ORBIT_TOKEN_FILE")" | base64 -w0)" \
      git "$@"
  else
    git "$@"
  fi
}

retry() {
  local n=1
  until "$@"; do
    ((n >= 4)) && return 1
    warn "failed: $*; retrying in $((2 ** n))s"
    sleep $((2 ** n))
    n=$((n + 1))
  done
}

preflight() {
  ((EUID == 0)) || die "Run this as root (sudo -i, then run it again)."
  # shellcheck source=/dev/null
  . /etc/os-release
  case "${ID:-}" in
    ubuntu | debian) ;;
    *) die "This script supports Ubuntu and Debian; this server runs ${PRETTY_NAME:-an unknown system}." ;;
  esac
  ok "${PRETTY_NAME}, $(awk '/MemTotal/ {print int($2 / 1024)}' /proc/meminfo) MB RAM"
}

install_packages() {
  step "Installing packages and automatic security updates"
  retry apt-get update -qq
  retry apt-get install -y -qq ca-certificates curl git openssl jq sudo ufw fail2ban python3-systemd \
    unattended-upgrades >/dev/null
  # Security updates install themselves every day. A kernel update needs a reboot to take effect;
  # it happens at 04:30 UTC, after the nightly backup, and Docker brings Orbit back by itself --
  # but not while someone is logged in, who may be halfway through a restore.
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
  cat >/etc/apt/apt.conf.d/52orbit-unattended-upgrades <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
Unattended-Upgrade::Automatic-Reboot-WithUsers "false";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
EOF
  ok "packages installed; security updates are automatic"
}

install_docker() {
  step "Installing Docker"
  if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
    ok "Docker is already installed ($(docker --version))"
  else
    local log=/var/log/orbit-docker-install.log
    if ! retry sh -c 'curl -fsSL https://get.docker.com | sh' >"$log" 2>&1; then
      tail -20 "$log" >&2
      die "Installing Docker failed; the whole log is in $log"
    fi
    ok "$(docker --version)"
  fi
  # Container logs are capped, so a chatty service cannot fill the disk. Merged into whatever is
  # there already (deploy/orbit adds a registry mirror the same way).
  local file=/etc/docker/daemon.json tmp
  tmp="$(mktemp)"
  [[ -s "$file" ]] || echo '{}' >"$file"
  jq '. + {"log-driver": "json-file", "log-opts": {"max-size": "10m", "max-file": "3"}}' "$file" >"$tmp"
  if ! cmp -s "$tmp" "$file"; then
    cat "$tmp" >"$file"
    systemctl restart docker
  fi
  rm -f "$tmp"
  systemctl enable --now docker >/dev/null 2>&1
  ok "container logs are capped at 30 MB per service"
  # With a token, the images of a private repository can be pulled -- for this run only, through
  # a Docker client config of its own: root's stays as it was, whatever logins it holds.
  if [[ -n "${ORBIT_TOKEN_FILE:-}" ]]; then
    DOCKER_CONFIG="$(mktemp -d)"
    export DOCKER_CONFIG
    trap 'rm -rf "$DOCKER_CONFIG"' EXIT
    [[ ! -f /root/.docker/config.json ]] || cp /root/.docker/config.json "$DOCKER_CONFIG/"
    docker login ghcr.io -u x-access-token --password-stdin <"$ORBIT_TOKEN_FILE" >/dev/null 2>&1 ||
      warn "Could not log in to ghcr.io with the token; only public images can be pulled."
  fi
}

create_user() {
  step "Creating the user $ORBIT_USER"
  id "$ORBIT_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$ORBIT_USER"
  usermod -aG docker "$ORBIT_USER"
  # No password to type: the account is reached only by SSH key, and is the server's administrator.
  echo "$ORBIT_USER ALL=(ALL) NOPASSWD:ALL" >/etc/sudoers.d/90-orbit
  chmod 440 /etc/sudoers.d/90-orbit
  visudo -cf /etc/sudoers.d/90-orbit >/dev/null
  # The same keys that open root open orbit, plus ORBIT_SSH_KEY and the keys of whoever ran sudo.
  local home="/home/$ORBIT_USER" keys
  install -d -m 700 -o "$ORBIT_USER" -g "$ORBIT_USER" "$home/.ssh"
  keys="$home/.ssh/authorized_keys"
  touch "$keys"
  {
    cat /root/.ssh/authorized_keys 2>/dev/null || true
    if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root ]]; then
      cat "$(getent passwd "$SUDO_USER" | cut -d: -f6)/.ssh/authorized_keys" 2>/dev/null || true
    fi
    [[ -z "${ORBIT_SSH_KEY:-}" ]] || printf '%s\n' "$ORBIT_SSH_KEY"
    cat "$keys"
  } | grep -E '^(ssh-|ecdsa-|sk-)' | sort -u >"$keys.new" || true
  mv "$keys.new" "$keys"
  chown "$ORBIT_USER:$ORBIT_USER" "$keys"
  chmod 600 "$keys"
  ok "$ORBIT_USER can log in with $(wc -l <"$keys") SSH key(s)"
}

harden_ssh() {
  step "Locking down SSH"
  local keys="/home/$ORBIT_USER/.ssh/authorized_keys" conf=/etc/ssh/sshd_config.d/00-orbit.conf
  if ! command -v sshd >/dev/null; then
    warn "No SSH server on this machine; nothing to lock down."
    return 0
  fi
  if [[ ! -s "$keys" ]]; then
    warn "Nobody has an SSH key on this server, so passwords stay allowed -- turning them off now would lock you out."
    warn "Add your key (ORBIT_SSH_KEY=\"ssh-ed25519 ...\") and run this script again."
    return 0
  fi
  if ! grep -Eqi '^\s*Include\s+/etc/ssh/sshd_config.d/' /etc/ssh/sshd_config; then
    warn "/etc/ssh/sshd_config does not read sshd_config.d; SSH left as it is."
    return 0
  fi
  # 00- so that it is read first: sshd keeps the first value it sees, and cloud images ship a
  # 50-cloud-init.conf that may allow passwords.
  cat >"$conf" <<'EOF'
# Written by Orbit's deploy/bootstrap.sh.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
EOF
  if ! sshd -t 2>/dev/null; then
    rm -f "$conf"
    die "The new SSH settings did not validate; nothing was changed."
  fi
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  ok "SSH: keys only, no root login. From now on: ssh $ORBIT_USER@<this server>"
}

setup_firewall() {
  step "Firewall"
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  # Whatever port SSH listens on stays open, so the firewall cannot lock anyone out.
  local port
  for port in $(sshd -T 2>/dev/null | awk '$1 == "port" {print $2}'); do ufw allow "$port/tcp" >/dev/null; done
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
  # Docker publishes ports past ufw. Orbit publishes only 80 and 443 to the world; the API gateway
  # listens on 127.0.0.1, and the database on no port at all.
  cat >/etc/fail2ban/jail.d/orbit.conf <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
  systemctl enable fail2ban >/dev/null 2>&1
  systemctl restart fail2ban
  ok "open to the world: 22, 80, 443; SSH password guessers are banned for an hour"
}

fetch_orbit() {
  step "Getting Orbit into $ORBIT_DIR"
  if [[ ! -d "$ORBIT_DIR/.git" ]]; then
    retry gitx clone --quiet "$ORBIT_REPO" "$ORBIT_DIR"
  elif [[ -n "$ORBIT_REPO_GIVEN" && "$(git -C "$ORBIT_DIR" remote get-url origin)" != "$ORBIT_REPO" ]]; then
    # Asked to deploy from a repository (a fork's CI, say): fetch from that one from now on.
    git -C "$ORBIT_DIR" remote set-url origin "$ORBIT_REPO"
    ok "$ORBIT_DIR now follows $ORBIT_REPO"
  fi
  # deploy/orbit runs as root on a checkout owned by orbit; git refuses that unless told it is fine.
  git config --system --get-all safe.directory | grep -qx "$ORBIT_DIR" ||
    git config --system --add safe.directory "$ORBIT_DIR"
  # Clean means no change at all, an untracked file included: deploy/orbit would build one in.
  if [[ -z "$(git -C "$ORBIT_DIR" status --porcelain 2>/dev/null)" ]]; then
    # A branch is checked out as itself, so that `git pull` updates it later; a commit, detached.
    if gitx -C "$ORBIT_DIR" ls-remote --exit-code --heads origin "$ORBIT_REF" >/dev/null 2>&1; then
      retry gitx -C "$ORBIT_DIR" fetch --quiet origin "+refs/heads/$ORBIT_REF:refs/remotes/origin/$ORBIT_REF"
      git -C "$ORBIT_DIR" checkout --quiet -B "$ORBIT_REF" "origin/$ORBIT_REF"
    else
      retry gitx -C "$ORBIT_DIR" fetch --quiet origin "$ORBIT_REF"
      git -C "$ORBIT_DIR" checkout --quiet --detach FETCH_HEAD
    fi
  elif [[ "$ORBIT_REF" =~ ^[0-9a-f]{40}$ ]]; then
    # Asked for one exact commit (a deploy from CI): installing another one would be a lie.
    die "$ORBIT_DIR has local changes, so it cannot be moved to $ORBIT_REF. See them with: git -C $ORBIT_DIR status"
  else
    warn "$ORBIT_DIR has local changes; left on the commit it is on."
  fi
  chown -R "$ORBIT_USER:$ORBIT_USER" "$ORBIT_DIR"
  ok "Orbit $(git -C "$ORBIT_DIR" rev-parse --short=12 HEAD)"
}

install_orbit() {
  local env="$ORBIT_DIR/deploy/.env"
  if [[ -n "${ORBIT_SETTINGS:-}" ]]; then
    [[ -f "$ORBIT_SETTINGS" ]] || die "ORBIT_SETTINGS=$ORBIT_SETTINGS does not exist"
    "$ORBIT_DIR/deploy/orbit" apply-env "$ORBIT_SETTINGS"
  elif [[ ! -f "$env" ]]; then
    install -m 600 "$ORBIT_DIR/deploy/.env.example" "$env"
  fi
  chown "$ORBIT_USER:$ORBIT_USER" "$env"
  if [[ "${ORBIT_SKIP_INSTALL:-false}" == "true" ]]; then
    ok "server ready; Orbit not installed (ORBIT_SKIP_INSTALL=true)"
    return
  fi
  if ! "$ORBIT_DIR/deploy/orbit" check >/dev/null 2>&1; then
    cat <<EOF

$(printf '\033[32m%s\033[0m' "The server is ready.") Two steps left:
  1. Fill in the settings:   sudo nano $env     (every line is explained there)
  2. Install:                sudo $ORBIT_DIR/deploy/orbit install
EOF
    return
  fi
  "$ORBIT_DIR/deploy/orbit" install
}

preflight
install_packages
install_docker
create_user
harden_ssh
setup_firewall
fetch_orbit
install_orbit
