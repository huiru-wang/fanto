#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:-all}"
RUN_DIR="$ROOT/run"

usage() {
  echo "Usage: $0 [server|agent|h5|all]"
}

stop_h5() {
  echo "[SKIP] h5 is static content served by Nginx; nothing to stop"
}

stop_process() {
  local name="$1"
  local pid_file="$RUN_DIR/$name.pid"

  if [[ ! -f "$pid_file" ]]; then
    echo "[SKIP] $name not running"
    return
  fi

  local pid
  pid="$(cat "$pid_file")"

  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_file"
    echo "[SKIP] $name already stopped"
    return
  fi

  echo "[STOP] $name (pid=$pid)"
  kill "$pid"

  for _ in {1..10}; do
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$pid_file"
      echo "[OK] $name stopped"
      return
    fi
    sleep 1
  done

  echo "[WARN] $name graceful shutdown timed out; force killing"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$pid_file"
  echo "[OK] $name stopped"
}

case "$TARGET" in
  server)
    stop_process server
    ;;
  agent)
    stop_process agent
    ;;
  h5)
    stop_h5
    ;;
  all)
    stop_h5
    stop_process agent
    stop_process server
    ;;
  *)
    usage
    exit 1
    ;;
esac
