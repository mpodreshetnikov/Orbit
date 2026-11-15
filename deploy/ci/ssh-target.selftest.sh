#!/usr/bin/env bash
# Self-test for deploy/ci/ssh-target.sh (sourced by relative path — no argv path from callers).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ssh-target.sh
source "$here/ssh-target.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

expect_ok() {
  local host="$1" port_var="$2" want="$3"
  ORBIT_SSH_HOST="" ORBIT_SSH_PORT=""
  orbit_parse_ssh_target "$host" "$port_var" || fail "expected ok for host=${host@Q} port=${port_var@Q}"
  local got="${ORBIT_SSH_HOST} ${ORBIT_SSH_PORT}"
  [[ "$got" == "$want" ]] || fail "host=${host@Q} port=${port_var@Q}: got ${got@Q}, want ${want@Q}"
}

expect_err() {
  local host="$1" port_var="$2" pattern="$3" err
  ORBIT_SSH_HOST="" ORBIT_SSH_PORT=""
  if err="$(orbit_parse_ssh_target "$host" "$port_var" 2>&1)"; then
    fail "expected error for host=${host@Q} port=${port_var@Q}, got success ${ORBIT_SSH_HOST} ${ORBIT_SSH_PORT}"
  fi
  [[ "$err" =~ $pattern ]] || fail "host=${host@Q}: error ${err@Q} did not match ${pattern@Q}"
}

expect_ok "141.133.186.73" "" "141.133.186.73 22"
expect_ok "orbit.example" "" "orbit.example 22"
expect_ok "141.133.186.73:22222" "" "141.133.186.73 22222"
expect_ok "141.133.186.73" "22222" "141.133.186.73 22222"
expect_ok "141.133.186.73:22222" "22222" "141.133.186.73 22222"

expect_err "141.133.186.73:22222" "22" "disagrees"
expect_err "" "" "empty"
expect_err "host.example" "0" "ORBIT_SERVER_PORT"
expect_err "[2001:db8::1]:22" "" "IPv6"
expect_err "2001:db8::1" "" "IPv6|multi-colon"

# deploy.sh must call the function in-process (not under $(…)); vars must stick.
ORBIT_SSH_HOST="" ORBIT_SSH_PORT=""
orbit_parse_ssh_target "example.test" ""
[[ -n "${ORBIT_SSH_HOST-}" && -n "${ORBIT_SSH_PORT-}" ]] ||
  fail "ORBIT_SSH_HOST/PORT unset after in-shell parse (deploy.sh must not use command substitution)"

echo "ssh-target.selftest: ok"
