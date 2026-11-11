#!/usr/bin/env bash
# Wire Cursor Cloud agent-hooks to each checkout's .githooks (T-261106-kp8).
# Call from the environment install/start script after Cursor has created
# ~/.cursor/agent-hooks/<id>/. Safe when Orbit is missing or the dispatcher is not ready yet.
set -euo pipefail

find_orbit_root() {
  local candidate
  for candidate in \
    "${ORBIT_ROOT:-}" \
    "${PWD}" \
    "${PWD}/repos/Orbit" \
    /agent/repos/Orbit \
    /workspace/repos/Orbit \
    /workspace \
    /home/user/Orbit
  do
    if [[ -n "${candidate}" && -f "${candidate}/scripts/just/cursor-agent-git-hooks.cjs" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

ORBIT="$(find_orbit_root || true)"
if [[ -z "${ORBIT}" ]]; then
  echo "configure-cursor-agent-hooks: Orbit checkout not found; skipping" >&2
  exit 0
fi

node "${ORBIT}/scripts/just/cursor-agent-git-hooks.cjs" "${ORBIT}" || true

for registry in \
  "${REGISTRY_ROOT:-}" \
  "${ORBIT}/../orbit-tasks" \
  /agent/repos/orbit-tasks \
  /workspace/repos/orbit-tasks
do
  if [[ -n "${registry}" && -d "${registry}/.githooks" ]]; then
    node "${ORBIT}/scripts/just/cursor-agent-git-hooks.cjs" "${registry}" || true
    break
  fi
done
