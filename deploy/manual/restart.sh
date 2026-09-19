#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TARGET="${1:-all}"

case "$TARGET" in
  server|agent|all)
    ;;
  *)
    echo "Usage: $0 [server|agent|all]"
    exit 1
    ;;
esac

"$ROOT/deploy/manual/stop.sh" "$TARGET"
"$ROOT/deploy/manual/start.sh" "$TARGET"
