#!/usr/bin/env bash
# Runs once while deploy/functions.Dockerfile builds: starts the edge runtime, sends every function
# one request, so the runtime downloads each one's modules into its cache, and fails the build when
# a function does not start. The image has no curl; bash talks HTTP itself.
set -euo pipefail

port=9000
JWT_SECRET=build VERIFY_JWT=false edge-runtime start --port "$port" \
  --main-service /home/deno/functions/main >/tmp/edge-runtime.log 2>&1 &
runtime=$!

for _ in $(seq 1 60); do
  (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && break
  kill -0 "$runtime" 2>/dev/null || { cat /tmp/edge-runtime.log; exit 1; }
  sleep 1
done

# A bare OPTIONS: each function answers it with an empty 200 (deploy/orbit, warm_functions).
failed=()
for dir in /home/deno/functions/*/; do
  name="$(basename "$dir")"
  [[ "$name" == _* || "$name" == main ]] && continue
  status="$(
    exec 3<>"/dev/tcp/127.0.0.1/$port"
    printf 'OPTIONS /%s HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n' "$name" >&3
    timeout 300 head -1 <&3 | tr -d '\r'
  )" || true
  echo "$name: ${status:-no answer}"
  [[ "$status" == "HTTP/1.1 200"* ]] || failed+=("$name")
done

kill "$runtime"
wait "$runtime" 2>/dev/null || true
if ((${#failed[@]})); then
  cat /tmp/edge-runtime.log
  echo "These functions did not start: ${failed[*]}" >&2
  exit 1
fi
rm -f /tmp/edge-runtime.log
