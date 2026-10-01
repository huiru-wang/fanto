#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm is required to install PM2" >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  echo "[SETUP] Installing PM2"
  npm install -g pm2
fi

if ! pm2 module:list 2>/dev/null | grep -q 'pm2-logrotate'; then
  echo "[SETUP] Installing pm2-logrotate"
  pm2 install pm2-logrotate
fi

pm2 set pm2-logrotate:max_size 100M >/dev/null
pm2 set pm2-logrotate:retain 14 >/dev/null
pm2 set pm2-logrotate:compress true >/dev/null
pm2 set pm2-logrotate:rotateInterval '0 0 * * *' >/dev/null

mkdir -p "$ROOT/logs"

if [[ "$(id -u)" -eq 0 ]] && command -v systemctl >/dev/null 2>&1; then
  echo "[SETUP] Enabling PM2 startup on boot"
  pm2 startup systemd -u root --hp /root >/dev/null
else
  echo "[WARN] Automatic boot setup skipped; run the PM2 startup command as the deployment user/root."
fi

pm2 save --force >/dev/null

echo "[DONE] PM2 runtime is ready"
