#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIST="$ROOT/apps/h5/dist"
TARGET="/var/www/fanto-h5"

cd "$ROOT"
pnpm build:h5

mkdir -p "$TARGET"
find "$TARGET" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -R "$DIST"/. "$TARGET"/

echo "[OK] H5 published to $TARGET"
