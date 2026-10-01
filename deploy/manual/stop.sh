#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-all}"

usage() { echo "Usage: $0 [server|h5|all]"; }
stop_h5() { echo "[SKIP] h5 is static content served by Nginx; nothing to stop"; }
stop_server() {
  command -v pm2 >/dev/null 2>&1 || { echo "[SKIP] pm2 is not installed"; return; }
  if pm2 describe fanto-server >/dev/null 2>&1; then
    echo "[STOP] fanto-server"
    pm2 stop fanto-server
    pm2 save --force >/dev/null
  else
    echo "[SKIP] fanto-server is not registered in PM2"
  fi
}

case "$TARGET" in
  server) stop_server ;;
  h5) stop_h5 ;;
  all)
    stop_h5
    stop_server
    ;;
  *) usage; exit 1 ;;
esac
