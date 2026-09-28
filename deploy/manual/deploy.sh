#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVER_DIR="$ROOT/apps/server"
SERVER_ENV="$SERVER_DIR/.env"
DEFAULT_AGENT_CONFIG="$SERVER_DIR/agent.yaml"
NGINX_SOURCE="$ROOT/deploy/manual/nginx/fanto-ssl.conf"
NGINX_TARGET="${FANTO_NGINX_CONFIG:-/etc/nginx/nginx.conf}"
INSTALL_NGINX="${FANTO_DEPLOY_NGINX:-0}"
SERVER_PORT="${FANTO_SERVER_PORT:-3000}"
HEALTH_RETRIES="${FANTO_HEALTH_RETRIES:-30}"

usage() {
  cat <<'EOF'
Usage: deploy/manual/deploy.sh [--nginx]

Deploy Fanto production release:
  1. validate production config
  2. install dependencies
  3. build H5
  4. run PostgreSQL migrations
  5. restart Server (including Agent Runtime)
  6. publish H5
  7. optionally replace/reload Nginx
  8. verify health checks

Options:
  --nginx   replace /etc/nginx/nginx.conf with Fanto SSL config
EOF
}

case "${1:-}" in
  "")
    ;;
  --nginx)
    INSTALL_NGINX=1
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac

fail() {
  echo "[ERROR] $*" >&2
  exit 1
}

for command in node pnpm curl; do
  command -v "$command" >/dev/null 2>&1 || fail "missing required command: $command"
done

[[ -f "$SERVER_ENV" ]] || fail "missing server production env: $SERVER_ENV"

require_env_key() {
  local file="$1"
  local key="$2"
  grep -Eq "^${key}=.+" "$file" || fail "missing $key in $file"
}

agent_config_path() {
  local configured
  configured="$(sed -n 's/^AGENT_CONFIG_PATH=//p' "$SERVER_ENV" | tail -n 1)"
  if [[ -z "$configured" ]]; then
    printf '%s\n' "$DEFAULT_AGENT_CONFIG"
  elif [[ "$configured" = /* ]]; then
    printf '%s\n' "$configured"
  else
    printf '%s\n' "$ROOT/$configured"
  fi
}

for key in \
  DATABASE_URL \
  AUTH_JWT_ACTIVE_KID \
  AUTH_JWT_PRIVATE_KEY \
  AUTH_JWT_PUBLIC_KEYS \
  GOOGLE_ALLOWED_CLIENT_IDS \
  APPLE_ALLOWED_CLIENT_IDS \
  DEEPSEEK_API_KEY; do
  require_env_key "$SERVER_ENV" "$key"
done

AGENT_CONFIG="$(agent_config_path)"
[[ -f "$AGENT_CONFIG" ]] || fail "missing Agent config: $AGENT_CONFIG"

if [[ "$INSTALL_NGINX" == "1" ]]; then
  command -v nginx >/dev/null 2>&1 || fail "missing required command: nginx"
  [[ -f "$NGINX_SOURCE" ]] || fail "missing Nginx config: $NGINX_SOURCE"
fi

echo "[1/7] Installing dependencies"
cd "$ROOT"
pnpm install --frozen-lockfile

echo "[2/7] Building H5"
pnpm build:h5

echo "[3/7] Running database migrations"
(
  cd "$SERVER_DIR"
  node --env-file=.env --import tsx src/bootstrap/migrate.ts
)

echo "[4/7] Restarting Server"
"$ROOT/deploy/manual/stop.sh" server || true
"$ROOT/deploy/manual/start.sh" server

echo "[5/7] Publishing H5"
FANTO_SKIP_H5_BUILD=1 "$ROOT/deploy/manual/publish-h5.sh"

wait_health() {
  local name="$1"
  local url="$2"
  local log_file="$3"

  for ((i=1; i<=HEALTH_RETRIES; i++)); do
    if curl -fsS --max-time 2 "$url" >/dev/null; then
      echo "[OK] $name healthy: $url"
      return 0
    fi
    sleep 1
  done

  echo "[ERROR] $name health check failed: $url" >&2
  tail -n 100 "$log_file" 2>/dev/null || true
  return 1
}

echo "[6/7] Verifying application health"
wait_health "server" "http://127.0.0.1:${SERVER_PORT}/health" "$ROOT/logs/server.log"

echo "[7/7] Nginx"
if [[ "$INSTALL_NGINX" == "1" ]]; then
  backup="$(mktemp)"
  if [[ -f "$NGINX_TARGET" ]]; then
    cp "$NGINX_TARGET" "$backup"
  fi

  cp "$NGINX_SOURCE" "$NGINX_TARGET"
  if ! nginx -t -c "$NGINX_TARGET"; then
    if [[ -s "$backup" ]]; then
      cp "$backup" "$NGINX_TARGET"
    fi
    rm -f "$backup"
    fail "Nginx configuration validation failed; previous config restored"
  fi
  rm -f "$backup"

  if [[ -f /run/nginx.pid ]]; then
    nginx -s reload
  else
    nginx -c "$NGINX_TARGET"
  fi

  if ! curl -kfsS --max-time 5 --resolve fanto.robinverse.me:443:127.0.0.1 https://fanto.robinverse.me/health >/dev/null; then
    fail "Nginx local HTTPS health check failed"
  fi
  echo "[OK] nginx healthy: https://fanto.robinverse.me/health (local origin)"
else
  echo "[SKIP] Nginx unchanged (use --nginx when config must be replaced)"
fi

echo "[DONE] Fanto deployment completed"
