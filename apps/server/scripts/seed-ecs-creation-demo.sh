#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DATABASE_PATH="/var/lib/fanto/fanto.sqlite"

if [[ ! -d "/var/lib/fanto" ]]; then
  echo "Missing /var/lib/fanto; create and grant the service user write access first." >&2
  exit 1
fi

cd "$PROJECT_ROOT"
export SQLITE_PATH="$DATABASE_PATH"

pnpm --filter @fanto/server db:migrate
pnpm --filter @fanto/server seed:creation-demo

echo "Creation demo data is ready for user: creation-demo-user"
