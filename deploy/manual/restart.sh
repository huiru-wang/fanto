#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:-all}"
PM2_CONFIG="$ROOT/ecosystem.config.cjs"

restart_server() {
  command -v pm2 >/dev/null 2>&1 || { echo "[ERROR] pm2 is not installed. Run: $ROOT/deploy/manual/setup-runtime.sh" >&2; exit 1; }
  if pm2 describe fanto-server >/dev/null 2>&1; then
    pm2 restart fanto-server --update-env
  else
    pm2 start "$PM2_CONFIG" --only fanto-server --update-env
  fi
  pm2 save --force >/dev/null
}

case "$TARGET" in
  server) restart_server ;;
  h5) "$ROOT/deploy/manual/publish-h5.sh" ;;
  all)
    restart_server
    "$ROOT/deploy/manual/publish-h5.sh"
    ;;
  *) echo "Usage: $0 [server|h5|all]"; exit 1 ;;
esac
