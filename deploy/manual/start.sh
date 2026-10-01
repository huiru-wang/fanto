#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:-all}"
SERVER_ENV="$ROOT/apps/server/.env"
PUBLISH_H5="$ROOT/deploy/manual/publish-h5.sh"
PM2_CONFIG="$ROOT/ecosystem.config.cjs"

usage() {
  echo "Usage: $0 [server|h5|all]"
}

require_pm2() {
  command -v pm2 >/dev/null 2>&1 || {
    echo "[ERROR] pm2 is not installed. Run: $ROOT/deploy/manual/setup-runtime.sh" >&2
    exit 1
  }
}

start_server() {
  [[ -f "$SERVER_ENV" ]] || { echo "[ERROR] server env file not found: $SERVER_ENV" >&2; exit 1; }
  [[ -f "$PM2_CONFIG" ]] || { echo "[ERROR] PM2 config not found: $PM2_CONFIG" >&2; exit 1; }
  require_pm2
  mkdir -p "$ROOT/logs"
  echo "[START] fanto-server via PM2"
  pm2 startOrReload "$PM2_CONFIG" --only fanto-server --update-env
  pm2 save --force >/dev/null
  echo "[OK] fanto-server managed by PM2"
}

start_h5() {
  "$PUBLISH_H5"
}

case "$TARGET" in
  server) start_server ;;
  h5) start_h5 ;;
  all)
    start_server
    start_h5
    ;;
  *)
    usage
    exit 1
    ;;
esac
