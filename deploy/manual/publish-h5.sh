#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="$ROOT/apps/h5/dist"
TARGET="${H5_DEPLOY_DIR:-/var/www/fanto-h5}"

cd "$ROOT"
pnpm build:h5

if [[ ! -f "$DIST/index.html" ]]; then
  echo "[ERROR] H5 build did not produce $DIST/index.html"
  exit 1
fi

PARENT="$(dirname "$TARGET")"
mkdir -p "$PARENT"
STAGING="$(mktemp -d "$PARENT/.fanto-h5.XXXXXX")"
cleanup() { rm -rf "$STAGING"; }
trap cleanup EXIT

cp -R "$DIST"/. "$STAGING"/
mkdir -p "$TARGET"
find "$TARGET" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -R "$STAGING"/. "$TARGET"/

echo "[OK] H5 published to $TARGET"
