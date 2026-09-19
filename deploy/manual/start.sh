#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:-all}"

LOG_DIR="$ROOT/logs"
RUN_DIR="$ROOT/run"
SERVER_DIR="$ROOT/apps/server"
AGENT_DIR="$ROOT/apps/agent"

mkdir -p "$LOG_DIR" "$RUN_DIR"

usage() {
  echo "Usage: $0 [server|agent|all]"
}

is_running() {
  local name="$1"
  local pid_file="$RUN_DIR/$name.pid"

  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi

  local pid
  pid="$(cat "$pid_file")"

  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  rm -f "$pid_file"
  return 1
}

require_env() {
  local name="$1"
  local env_file="$2"

  if [[ ! -f "$env_file" ]]; then
    echo "[ERROR] $name env file not found: $env_file"
    exit 1
  fi
}

start_server() {
  if is_running server; then
    echo "[SKIP] server already running (pid=$(cat "$RUN_DIR/server.pid"))"
    return
  fi

  local env_file="$SERVER_DIR/.env.production"
  require_env server "$env_file"

  echo "[START] server"

  (
    cd "$SERVER_DIR"
    nohup node --env-file=.env.production --import tsx src/bootstrap/main.ts       >> "$LOG_DIR/server.log" 2>&1 &
    echo $! > "$RUN_DIR/server.pid"
  )

  local pid
  pid="$(cat "$RUN_DIR/server.pid")"
  sleep 1

  if kill -0 "$pid" 2>/dev/null; then
    echo "[OK] server started (pid=$pid)"
  else
    rm -f "$RUN_DIR/server.pid"
    echo "[ERROR] server failed to start"
    tail -n 50 "$LOG_DIR/server.log" 2>/dev/null || true
    exit 1
  fi
}

start_agent() {
  if is_running agent; then
    echo "[SKIP] agent already running (pid=$(cat "$RUN_DIR/agent.pid"))"
    return
  fi

  local env_file="$AGENT_DIR/.env.production"
  require_env agent "$env_file"

  if [[ ! -f "$AGENT_DIR/dist/bootstrap/main.js" ]]; then
    echo "[ERROR] agent build output not found: $AGENT_DIR/dist/bootstrap/main.js"
    echo "        Run: pnpm --filter @fanto/agent build"
    exit 1
  fi

  echo "[START] agent"

  (
    cd "$AGENT_DIR"
    nohup node --env-file=.env.production dist/bootstrap/main.js       >> "$LOG_DIR/agent.log" 2>&1 &
    echo $! > "$RUN_DIR/agent.pid"
  )

  local pid
  pid="$(cat "$RUN_DIR/agent.pid")"
  sleep 1

  if kill -0 "$pid" 2>/dev/null; then
    echo "[OK] agent started (pid=$pid)"
  else
    rm -f "$RUN_DIR/agent.pid"
    echo "[ERROR] agent failed to start"
    tail -n 50 "$LOG_DIR/agent.log" 2>/dev/null || true
    exit 1
  fi
}

case "$TARGET" in
  server)
    start_server
    ;;
  agent)
    start_agent
    ;;
  all)
    start_server
    start_agent
    ;;
  *)
    usage
    exit 1
    ;;
esac
