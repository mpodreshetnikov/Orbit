# Parse ORBIT_SERVER_HOST (+ optional ORBIT_SERVER_PORT) into SSH host and port.
# Sourced by deploy/ci/deploy.sh. IPv6 forms are unsupported (reject clearly).
#
# Sets: ORBIT_SSH_HOST, ORBIT_SSH_PORT
# Usage: orbit_parse_ssh_target <host_raw> <port_raw_or_empty>

orbit_parse_ssh_target() {
  local raw="${1-}" port_var="${2-}" host port

  raw="${raw#"${raw%%[![:space:]]*}"}"
  raw="${raw%"${raw##*[![:space:]]}"}"
  port_var="${port_var#"${port_var%%[![:space:]]*}"}"
  port_var="${port_var%"${port_var##*[![:space:]]}"}"

  if [[ -z "$raw" ]]; then
    echo "ORBIT_SERVER_HOST is empty." >&2
    return 1
  fi

  # Bracketed IPv6 ([addr] or [addr]:port) is not supported.
  if [[ "$raw" == \[* ]]; then
    echo "ORBIT_SERVER_HOST IPv6 bracket form is not supported; use an IPv4 address or hostname, optionally with :port (e.g. 141.133.186.73:22222)." >&2
    return 1
  fi

  host="$raw"
  port=""

  if [[ "$raw" == *:* ]]; then
    local maybe_port="${raw##*:}"
    local maybe_host="${raw%:*}"
    if [[ "$maybe_port" =~ ^[0-9]+$ ]] && ((10#$maybe_port >= 1 && 10#$maybe_port <= 65535)); then
      if [[ "$maybe_host" == *:* ]]; then
        echo "ORBIT_SERVER_HOST IPv6 / multi-colon forms are not supported; use an IPv4 address or hostname with optional :port." >&2
        return 1
      fi
      if [[ -z "$maybe_host" ]]; then
        echo "ORBIT_SERVER_HOST host part before :port is empty." >&2
        return 1
      fi
      host="$maybe_host"
      port="$maybe_port"
    else
      echo "ORBIT_SERVER_HOST IPv6 / multi-colon forms are not supported; use an IPv4 address or hostname with optional :port (1-65535)." >&2
      return 1
    fi
  fi

  if [[ -n "$port_var" ]]; then
    if [[ ! "$port_var" =~ ^[0-9]+$ ]] || ((10#$port_var < 1 || 10#$port_var > 65535)); then
      echo "ORBIT_SERVER_PORT must be an integer 1-65535 (got: ${port_var})." >&2
      return 1
    fi
    if [[ -n "$port" && "$port" != "$port_var" ]]; then
      echo "ORBIT_SERVER_HOST port (${port}) disagrees with ORBIT_SERVER_PORT (${port_var})." >&2
      return 1
    fi
    port="$port_var"
  fi

  if [[ -z "$port" ]]; then
    port=22
  fi

  ORBIT_SSH_HOST="$host"
  ORBIT_SSH_PORT="$port"
  return 0
}
