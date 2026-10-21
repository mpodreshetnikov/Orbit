#!/bin/bash
# Installs the Orbit extension updater for the unpacked extension this script ships in.
#
#   bash "/path/to/orbit-extension/updater/install.sh"
#
# Copies the native messaging host out of the extension folder (the folder is replaced on
# every update, the host must not be) and registers it with Chrome, Chromium, Brave and Edge
# for this extension's id only. Run it again after moving the extension folder.

set -euo pipefail

EXTENSION_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST_NAME="space.privateorbit.extension_updater"
MANIFEST="$EXTENSION_DIR/manifest.json"

[ -f "$MANIFEST" ] || { echo "No manifest.json in $EXTENSION_DIR" >&2; exit 1; }
# The updater replaces this folder wholesale, so it must be the unpacked release, never the
# extension's sources in a clone of the repository.
if [ ! -f "$EXTENSION_DIR/background.js" ] || [ -e "$EXTENSION_DIR/src" ] ||
  [ -e "$EXTENSION_DIR/package.json" ] || [ -e "$EXTENSION_DIR/.git" ]; then
  echo "$EXTENSION_DIR is not an unpacked Orbit release; run install.sh from the downloaded copy." >&2
  exit 1
fi

json_get() {
  if command -v osascript >/dev/null 2>&1; then
    osascript -l JavaScript \
      -e 'function run(a){var v=JSON.parse(a[0])[a[1]];return v==null?"":String(v)}' "$1" "$2"
  else
    python3 -c 'import json,sys; v=json.loads(sys.argv[1]).get(sys.argv[2]); print("" if v is None else v)' "$1" "$2"
  fi
}

KEY="$(json_get "$(cat "$MANIFEST")" key)"
[ -n "$KEY" ] || { echo "manifest.json has no key; is this the Orbit release build?" >&2; exit 1; }
# Chrome's id for an unpacked extension with a key: sha256 of the key's bytes, first 32 hex
# digits, each mapped 0-f to a-p.
EXTENSION_ID="$(printf '%s' "$KEY" | openssl base64 -d -A | openssl dgst -sha256 -hex |
  sed 's/^.*= //' | cut -c1-32 | tr '0-9a-f' 'a-p')"

case "$(uname -s)" in
  Darwin)
    HOST_DIR="$HOME/Library/Application Support/Orbit/extension-updater"
    BROWSER_DIRS=(
      "$HOME/Library/Application Support/Google/Chrome"
      "$HOME/Library/Application Support/Google/Chrome Beta"
      "$HOME/Library/Application Support/Google/Chrome Canary"
      "$HOME/Library/Application Support/Chromium"
      "$HOME/Library/Application Support/BraveSoftware/Brave-Browser"
      "$HOME/Library/Application Support/Microsoft Edge"
    )
    ;;
  *)
    HOST_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/orbit/extension-updater"
    BROWSER_DIRS=(
      "$HOME/.config/google-chrome"
      "$HOME/.config/google-chrome-beta"
      "$HOME/.config/chromium"
      "$HOME/.config/BraveSoftware/Brave-Browser"
      "$HOME/.config/microsoft-edge"
    )
    ;;
esac

# One extension folder per machine: every browser reaches the same host, and the host cannot tell
# which browser asked, so a second folder replaces the first rather than being added to it.
if [ -f "$HOST_DIR/config.env" ]; then
  previous="$(sed -n 's/^EXTENSION_DIR=//p' "$HOST_DIR/config.env")"
  if [ -n "$previous" ] && [ "$(eval "printf '%s' $previous")" != "$EXTENSION_DIR" ]; then
    echo "Note: the updater was set up for $(eval "printf '%s' $previous"); it now updates this folder instead."
  fi
fi

mkdir -p "$HOST_DIR"
cp "$EXTENSION_DIR/updater/orbit-updater.sh" "$HOST_DIR/orbit-updater.sh"
chmod 755 "$HOST_DIR/orbit-updater.sh"
{
  printf 'EXTENSION_DIR=%q\n' "$EXTENSION_DIR"
  printf 'KEY_PREFIX=%q\n' "${KEY:0:64}"
} >"$HOST_DIR/config.env"

host_manifest() {
  cat <<JSON
{
  "name": "$HOST_NAME",
  "description": "Orbit extension updater",
  "path": "$HOST_DIR/orbit-updater.sh",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
JSON
}

registered=0
for index in "${!BROWSER_DIRS[@]}"; do
  dir="${BROWSER_DIRS[$index]}"
  # Chrome is registered even before its first start; the others only where they exist.
  if [ "$index" -eq 0 ] || [ -d "$dir" ]; then
    mkdir -p "$dir/NativeMessagingHosts"
    host_manifest >"$dir/NativeMessagingHosts/$HOST_NAME.json"
    echo "Registered for $(basename "$dir")"
    registered=$((registered + 1))
  fi
done

echo
echo "Orbit updater installed."
echo "  extension folder: $EXTENSION_DIR"
echo "  extension id:     $EXTENSION_ID"
echo "Open the Orbit popup and press \"Check for updates\" to try it."
