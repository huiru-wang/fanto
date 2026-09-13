#!/usr/bin/env bash
# 从 GitHub 的 main 分支更新、构建 H5、迁移数据库并平滑重载后端。
set -euo pipefail

readonly repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly branch="${FANTO_DEPLOY_BRANCH:-main}"
readonly env_file="${FANTO_ENV_FILE:-/etc/fanto/server.env}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令：$1" >&2
    exit 1
  }
}

for command in git pnpm pm2 curl; do
  require_command "$command"
done

if [[ ! -r "$env_file" ]]; then
  echo "缺少生产环境文件：$env_file" >&2
  exit 1
fi

cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "部署目录存在未提交修改；为避免覆盖服务器上的内容，已停止。" >&2
  exit 1
fi

git fetch origin "$branch"
git checkout "$branch"
git pull --ff-only origin "$branch"

set -a
# shellcheck disable=SC1090
source "$env_file"
set +a

mkdir -p "$(dirname "$SQLITE_PATH")"

pnpm install --frozen-lockfile
pnpm typecheck
pnpm build:h5
pnpm db:migrate

pm2 startOrReload "$repo_root/deploy/manual/ecosystem.config.cjs" --only fanto-server --update-env

if command -v nginx >/dev/null 2>&1; then
  sudo nginx -t
  sudo nginx -s reload
fi

for _ in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1:3000/health >/dev/null; then
    echo "部署完成：后端健康检查通过。"
    exit 0
  fi
  sleep 2
done

echo "后端健康检查失败，最近日志如下：" >&2
pm2 logs fanto-server --lines 100 --nostream >&2 || true
exit 1
