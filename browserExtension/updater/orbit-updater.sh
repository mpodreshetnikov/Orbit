#!/bin/bash
# Orbit extension updater: a Chrome native messaging host for macOS (and Linux).
#
# Chrome starts this script when the unpacked Orbit extension asks it something, passes one
# length-prefixed JSON message on stdin and reads one reply from stdout. Two actions:
#
#   stage  {version, sha256, url}  download the release, check its sha256, unpack it beside
#                                  the extension folder. Slow, and harmless while importing.
#   apply  {version}               mirror the staged copy over the extension folder. Fast.
#                                  The extension asks only when nothing is importing, and
#                                  reloads itself right after.
#
# Installed by install.sh, which writes config.env next to this file. Nothing but the reply
# may reach stdout: everything else goes to updater.log.

set -u
export LC_ALL=C

HOST_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$HOST_DIR/updater.log"
STAGE_ROOT="$HOST_DIR/staged"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$LOG"; }

read_message() {
  local length
  length=$(dd bs=1 count=4 2>/dev/null | od -An -tu4 | tr -d ' \n')
  [ -n "$length" ] || return 1
  dd bs=1 count="$length" 2>/dev/null
}

reply() {
  local body="$1"
  local n=${#body}
  printf "$(printf '\\%03o\\%03o\\%03o\\%03o' $((n & 255)) $(((n >> 8) & 255)) $(((n >> 16) & 255)) $(((n >> 24) & 255)))"
  printf '%s' "$body"
}

ok() { reply "{\"ok\":true${1:+,$1}}"; exit 0; }

fail() {
  local message
  message=$(printf '%s' "$1" | tr -d '"\\' | tr '\n\r\t' '   ')
  log "error: $message"
  reply "{\"ok\":false,\"error\":\"$message\"${2:+,$2}}"
  exit 0
}

json_get() {
  if command -v osascript >/dev/null 2>&1; then
    osascript -l JavaScript \
      -e 'function run(a){var v=JSON.parse(a[0])[a[1]];return v==null?"":String(v)}' "$1" "$2"
  else
    python3 -c 'import json,sys; v=json.loads(sys.argv[1]).get(sys.argv[2]); print("" if v is None else v)' "$1" "$2"
  fi
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    sha256sum "$1" | cut -d' ' -f1
  fi
}

# The folder is mirrored with deletion, so it has to be a built Orbit extension and nothing
# else: the extension's own key in its manifest, a compiled background.js, and none of what a
# source checkout has. Mirroring a release over browserExtension/ in a clone wipes the sources.
is_built_orbit_extension() {
  [ -f "$1/manifest.json" ] && [ -f "$1/background.js" ] || return 1
  [ -e "$1/src" ] || [ -e "$1/package.json" ] || [ -e "$1/.git" ] && return 1
  grep -qF "$KEY_PREFIX" "$1/manifest.json"
}

manifest_has_version() {
  grep -Eq "\"version\"[[:space:]]*:[[:space:]]*\"$(printf '%s' "$2" | sed 's/\./\\./g')\"" "$1/manifest.json"
}

stage() {
  local version="$1" sha256="$2" url="$3"
  case "$url" in https://*) ;; *) fail "Refusing a download that is not https." ;; esac
  printf '%s' "$sha256" | grep -Eq '^[0-9a-f]{64}$' || fail "Invalid sha256."

  local dir="$STAGE_ROOT/$version"
  if [ -f "$dir/.verified" ] && [ "$(cat "$dir/.verified")" = "$sha256" ]; then
    ok "\"version\":\"$version\""
  fi

  rm -rf "$STAGE_ROOT"
  mkdir -p "$dir" || fail "Cannot create $dir."
  log "stage $version from $url"
  curl -fsSL --max-time 300 -o "$dir/release.zip" "$url" >>"$LOG" 2>&1 ||
    fail "Download failed."
  local actual
  actual=$(sha256_of "$dir/release.zip")
  [ "$actual" = "$sha256" ] || fail "sha256 mismatch: expected $sha256, got $actual."
  unzip -q -o "$dir/release.zip" -d "$dir/files" >>"$LOG" 2>&1 || fail "Cannot unpack the release."
  [ -f "$dir/files/manifest.json" ] || fail "The release has no manifest.json."
  manifest_has_version "$dir/files" "$version" || fail "The release is not version $version."
  rm -f "$dir/release.zip"
  printf '%s' "$sha256" >"$dir/.verified"
  ok "\"version\":\"$version\""
}

# Makes $2 an exact copy of $1.
mirror() {
  mkdir -p "$2" || return 1
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$1/" "$2/" >>"$LOG" 2>&1
  else
    find "$2" -mindepth 1 -maxdepth 1 -exec rm -rf {} + >>"$LOG" 2>&1 &&
      cp -R "$1/." "$2/" >>"$LOG" 2>&1
  fi
}

apply() {
  local version="$1"
  local files="$STAGE_ROOT/$version/files"
  [ -f "$STAGE_ROOT/$version/.verified" ] || fail "Version $version is not staged."
  [ -n "${EXTENSION_DIR:-}" ] || fail "The updater is not configured; run install.sh again."
  is_built_orbit_extension "$EXTENSION_DIR" ||
    fail "$EXTENSION_DIR does not hold the built Orbit extension."
  log "apply $version to $EXTENSION_DIR"
  # A mirror that stops halfway leaves a folder of neither release, which no worker can run. So
  # the current files are kept aside first and put back when the mirror fails; the reply says
  # whether that worked, and the extension keeps imports out until a mirror succeeds.
  local backup="$HOST_DIR/previous"
  rm -rf "$backup"
  mirror "$EXTENSION_DIR" "$backup" || fail "Cannot keep a copy of the current files." "\"restored\":true"
  if ! mirror "$files" "$EXTENSION_DIR"; then
    if mirror "$backup" "$EXTENSION_DIR"; then
      fail "Cannot replace the files; the previous version is back." "\"restored\":true"
    fi
    fail "Cannot replace the files, nor put the previous ones back." "\"restored\":false"
  fi
  rm -rf "$STAGE_ROOT" "$backup"
  # The host is a copy outside the folder, so it takes its own update from the release it just
  # applied. A rename replaces the file whole; this running shell keeps reading the old one.
  if [ -f "$EXTENSION_DIR/updater/orbit-updater.sh" ]; then
    cp "$EXTENSION_DIR/updater/orbit-updater.sh" "$HOST_DIR/.orbit-updater.sh.new" &&
      chmod 755 "$HOST_DIR/.orbit-updater.sh.new" &&
      mv -f "$HOST_DIR/.orbit-updater.sh.new" "$HOST_DIR/orbit-updater.sh" ||
      log "could not refresh the host from $version"
  fi
  ok "\"version\":\"$version\""
}

# One stage or apply at a time: two hosts (two browsers, or two calls close together) would
# otherwise delete the staging tree under each other. mkdir is atomic; a lock older than ten
# minutes belongs to a host that died and is taken over.
LOCK="$HOST_DIR/.lock"
acquire_lock() {
  local waited=0
  until mkdir "$LOCK" 2>/dev/null; do
    if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
      rm -rf "$LOCK"
      continue
    fi
    [ "$waited" -ge 300 ] && fail "Another update is in progress."
    sleep 1
    waited=$((waited + 1))
  done
  trap 'rm -rf "$LOCK"' EXIT
}

message=$(read_message) || exit 0
# shellcheck source=/dev/null
[ -f "$HOST_DIR/config.env" ] && . "$HOST_DIR/config.env"

action=$(json_get "$message" action)
version=$(json_get "$message" version)
printf '%s' "$version" | grep -Eq '^[0-9]+(\.[0-9]+){0,3}$' || fail "Invalid version."
acquire_lock

case "$action" in
  stage) stage "$version" "$(json_get "$message" sha256)" "$(json_get "$message" url)" ;;
  apply) apply "$version" ;;
  *) fail "Unknown action." ;;
esac
