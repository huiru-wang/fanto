# 本地开发

## 前置条件

- Node.js 与 pnpm（仓库要求 pnpm 10.11.0）
- SQLite 依赖会由 `better-sqlite3` 安装
- 需要图片理解、音频转写或向量索引时，配置相应的 DashScope、OSS 与 Embedding 凭据

## 初始化与启动

```bash
pnpm install
cp apps/server/.env.example apps/server/.env
pnpm db:migrate
pnpm dev:server
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `pnpm dev:server` | 启动 Hono 服务 |
| `pnpm typecheck` | 所有 workspace TypeScript 检查 |
| `pnpm test` | 所有 workspace 测试 |
| `pnpm db:migrate` | 执行数据库迁移 |
| `pnpm vector:rebuild` | 重建记录向量索引 |
| `pnpm --filter @fanto/server seed:creation-demo` | 写入脉络演示数据 |

## 关键环境变量

| 变量 | 默认值 / 说明 |
| --- | --- |
| `PORT` / `HOST` | `3000` / `0.0.0.0` |
| `SQLITE_PATH` | `../../data/fanto.sqlite` |
| `OSS_*` | OSS 区域、桶、访问凭据；对象地址必须可公开读取给模型与客户端 |
| `DASHSCOPE_API_KEY` | 图片理解和音频转写凭据 |
| `EMBEDDING_API_KEY` | 向量索引凭据，可回退到 `OPENAI_API_KEY` |
| `EMBEDDING_DIMENSION` | 必须为 `1536` |

服务启动时自动迁移数据库，也会确保存在 `default-user`。脉络演示数据使用另一个用户 `creation-demo-user`，调用它的接口时必须传同名 Header。

当前工作区的 `apps/h5` 已删除，因此尽管根目录仍保留 `dev:h5`、`build:h5` 脚本，它们没有可运行目标。H5 重建完成前请不要把这些命令用于本地验证。

## 最小验证

```bash
curl http://127.0.0.1:3000/health
curl -H 'x-user-id: creation-demo-user' http://127.0.0.1:3000/api/creations/overview
```
