#!/usr/bin/env bash
# Puts Orbit on your own server from GitHub Actions (.github/workflows/self-hosted.yml), configured
# entirely by the repository's secrets and variables -- docs/SELF_HOSTING.md, "Deploy from GitHub".
# It runs on the Actions runner and, over SSH, runs deploy/bootstrap.sh on the server: a fresh
# server gets set up and installed, an existing one brought to this commit. Safe to repeat.
#
# Environment:
#   ORBIT_SECRET_<NAME>                   the secrets a server needs, each by name (the workflow
#                                         lists them; never the repository's whole set)
#   ORBIT_VARS_JSON                       toJSON(vars) of the workflow
#   ORBIT_COMMIT                          the commit to deploy
#   ORBIT_ACTION                          deploy (the default); restore: then restore the latest
#                                         backup over it (a server replacing a lost one); doctor:
#                                         only run deploy/doctor.sh there, changing nothing;
#                                         migrate-from-supabase: then replace its data with the hosted
#                                         project's, exported here (SOURCE_* below); test-alert: then
#                                         send a test message to the Telegram alerts
#   SOURCE_DB_URL, SOURCE_SUPABASE_URL, SOURCE_SERVICE_ROLE_KEY
#                                         the hosted project, for migrate-from-supabase only; or
#   HOSTED_PROJECT_REF, HOSTED_DB_PASS, HOSTED_SERVICE_ROLE_KEY
#                                         the same, from what the hosted production deploys with
#   GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SERVER_URL   from Actions
set -Eeuo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fail() {
  echo "::error::$*"
  exit 1
}

vars_json="${ORBIT_VARS_JSON:-}"
[[ -n "$vars_json" ]] || vars_json='{}'

# A secret wins over a variable of the same name.
setting() {
  local secret="ORBIT_SECRET_$1" value
  value="${!secret:-}"
  [[ -n "$value" ]] || value="$(jq -r --arg n "$1" '.[$n] // empty' <<<"$vars_json")"
  printf '%s' "$value"
}

host="$(setting ORBIT_SERVER_HOST)"
[[ -n "$host" ]] || fail "Set the ORBIT_SERVER_HOST variable to your server's IP address."
[[ -n "$(setting ORBIT_SSH_PRIVATE_KEY)" ]] ||
  fail "Set the ORBIT_SSH_PRIVATE_KEY secret to a private key your server accepts (docs/SELF_HOSTING.md, Deploy from GitHub)."
[[ -n "$(setting ORBIT_MASTER_KEY)" ]] ||
  fail "Set the ORBIT_MASTER_KEY secret to the output of: openssl rand -hex 32 -- and keep a copy: every key of the server is derived from it."

# What goes into deploy/.env: every setting deploy/.env.example names, and the generated values a
# move from hosted Supabase sets on purpose. Nothing else -- the SSH settings stay here.
names="$(grep -oE '^[A-Z][A-Z0-9_]*=' "$here/../.env.example" | tr -d '=')
POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY"
install -m 600 /dev/null "$work/settings"
# GitHub is where these settings live: one deleted there is emptied on the server too (except the
# keys the server created for itself, which deploy/orbit apply-env never empties).
for name in $names; do
  value="$(setting "$name")"
  [[ "$value" != *$'\n'* ]] || fail "$name has more than one line; deploy/.env takes one line per setting."
  printf '%s=%s\n' "$name" "$value" >>"$work/settings"
done
# The images this repository's own CI published for the commit.
[[ -n "$(setting ORBIT_PREBUILT_IMAGES)" ]] ||
  sed -i "s|^ORBIT_PREBUILT_IMAGES=\$|ORBIT_PREBUILT_IMAGES=ghcr.io/${GITHUB_REPOSITORY,,}|" "$work/settings"
echo "Settings for deploy/.env: $(grep -v '=$' "$work/settings" | cut -d= -f1 | paste -sd' ')"

# SSH. The server's host key is pinned by ORBIT_SSH_KNOWN_HOSTS when set; otherwise the key it
# presents now is accepted, and printed so that it can be pinned.
install -m 600 /dev/null "$work/key"
setting ORBIT_SSH_PRIVATE_KEY >"$work/key"
echo >>"$work/key"
if [[ -n "$(setting ORBIT_SSH_KNOWN_HOSTS)" ]]; then
  setting ORBIT_SSH_KNOWN_HOSTS >"$work/known_hosts"
else
  ssh-keyscan -T 15 "$host" 2>/dev/null >"$work/known_hosts" || true
  [[ -s "$work/known_hosts" ]] || fail "Cannot reach $host on port 22."
  echo "::notice::Accepted the SSH host key $host presents. To pin it, set the variable ORBIT_SSH_KNOWN_HOSTS to the output of: ssh-keyscan $host"
fi
ssh_opts=(-i "$work/key" -o UserKnownHostsFile="$work/known_hosts" -o StrictHostKeyChecking=yes
  -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=30)

# The first deploy logs in as root (or ORBIT_SERVER_USER); bootstrap.sh then turns root logins
# off, so every later one is `orbit`.
user=""
for candidate in orbit "$(setting ORBIT_SERVER_USER)" root; do
  [[ -n "$candidate" ]] || continue
  if ssh "${ssh_opts[@]}" "$candidate@$host" true 2>/dev/null; then
    user="$candidate"
    break
  fi
done
[[ -n "$user" ]] || fail "ORBIT_SSH_PRIVATE_KEY does not log in to $host as orbit, $(setting ORBIT_SERVER_USER) or root."
echo "Logged in to $host as $user"
sudo=""
[[ "$user" == root ]] || sudo="sudo -n"
# The command is built here and runs there: client-side expansion is the point.
# shellcheck disable=SC2029
remote() { ssh "${ssh_opts[@]}" "$user@$host" "$@"; }

# The hosted project is exported here, on the runner, before the server is touched: Supabase's
# cloud sits behind Cloudflare, which some servers' networks cannot download from (on 2026-10-18,
# the first server's could not). The export reads only; the old project is not changed. It runs in
# the backup image, which has the tools, as this user, so the files stay removable.
if [[ "${ORBIT_ACTION:-deploy}" == migrate-from-supabase ]]; then
  # One whole set: a database from one project and files from another would import and still
  # verify, against checksums of the wrong files.
  if [[ -n "${SOURCE_DB_URL:-}${SOURCE_SUPABASE_URL:-}${SOURCE_SERVICE_ROLE_KEY:-}" ]]; then
    [[ -n "${SOURCE_DB_URL:-}" && -n "${SOURCE_SUPABASE_URL:-}" && -n "${SOURCE_SERVICE_ROLE_KEY:-}" ]] ||
      fail "Set all three of the SOURCE_DB_URL and SOURCE_SERVICE_ROLE_KEY secrets and the SOURCE_SUPABASE_URL variable, or none."
  elif [[ -n "${HOSTED_PROJECT_REF:-}" && -n "${HOSTED_DB_PASS:-}" && -n "${HOSTED_SERVICE_ROLE_KEY:-}" ]]; then
    # The session pooler the hosted production's own deploy connects through (main.yml).
    SOURCE_DB_URL="postgresql://postgres.$HOSTED_PROJECT_REF:$HOSTED_DB_PASS@aws-1-eu-central-1.pooler.supabase.com:5432/postgres"
    SOURCE_SUPABASE_URL="https://$HOSTED_PROJECT_REF.supabase.co"
    SOURCE_SERVICE_ROLE_KEY="$HOSTED_SERVICE_ROLE_KEY"
    export SOURCE_DB_URL SOURCE_SUPABASE_URL SOURCE_SERVICE_ROLE_KEY
  else
    fail "Set the SOURCE_DB_URL and SOURCE_SERVICE_ROLE_KEY secrets and the SOURCE_SUPABASE_URL variable (docs/SELF_HOSTING.md, Moving from hosted Supabase)."
  fi
  image="ghcr.io/${GITHUB_REPOSITORY,,}-backup:$ORBIT_COMMIT"
  docker pull --quiet "$image" >/dev/null 2>&1 || docker build --quiet -t "$image" "$here/../backup" >/dev/null
  mkdir -p "$work/migration"
  docker run --rm --user "$(id -u):$(id -g)" -e SOURCE_DB_URL -e SOURCE_SUPABASE_URL -e SOURCE_SERVICE_ROLE_KEY \
    -v "$work/migration:/migration" --entrypoint /usr/local/bin/migrate-from-supabase "$image" export
fi

# Sent over stdin, so it runs whatever version of Orbit the server has, or none.
if [[ "${ORBIT_ACTION:-deploy}" == doctor ]]; then
  remote "$sudo bash -s" <"$here/../doctor.sh"
  exit 0
fi

# Files travel over stdin into a directory only this login can read, and are gone after the run.
# The workflow token in it lets the server fetch a private repository and pull its images; it
# expires when this run ends.
dir="$(remote 'umask 077 && mktemp -d')"
remote "cat >$dir/settings" <"$work/settings"
remote "cat >$dir/bootstrap.sh" <"$here/../bootstrap.sh"
printf '%s' "$GITHUB_TOKEN" | remote "cat >$dir/token"
ssh-keygen -y -f "$work/key" | remote "cat >$dir/ssh_key.pub"

remote "set -e
  trap 'rm -rf $dir' EXIT
  $sudo env ORBIT_REPO='$GITHUB_SERVER_URL/$GITHUB_REPOSITORY.git' ORBIT_REF='$ORBIT_COMMIT' \
    ORBIT_SETTINGS=$dir/settings ORBIT_TOKEN_FILE=$dir/token ORBIT_SSH_KEY=\"\$(cat $dir/ssh_key.pub)\" \
    bash $dir/bootstrap.sh"

if [[ "${ORBIT_ACTION:-deploy}" == restore ]]; then
  remote "$sudo /opt/orbit/deploy/orbit restore --yes"
fi
if [[ "${ORBIT_ACTION:-deploy}" == test-alert ]]; then
  remote "$sudo /opt/orbit/deploy/orbit backup test-alert"
fi
# Choosing this action in the workflow is the confirmation `import` otherwise asks for. This log is
# public on a public repository: an object's name can say what a person stored, and the allowlist
# check names the people it is missing, so a mismatch shows its bucket only and an address none.
# On the server, `deploy/orbit migrate-from-supabase import` and `verify` show both in full.
if [[ "${ORBIT_ACTION:-deploy}" == migrate-from-supabase ]]; then
  tar -C "$work/migration" -cz . | remote "$sudo /opt/orbit/deploy/orbit migrate-from-supabase receive"
  remote "$sudo /opt/orbit/deploy/orbit migrate-from-supabase import --yes" 2>&1 |
    sed -E -e 's|^(MISMATCH object [^/]*)/.*|\1/...|' -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]+/<e-mail>/g'
fi
echo "::notice::Orbit $(cut -c1-12 <<<"$ORBIT_COMMIT") is on $host"
