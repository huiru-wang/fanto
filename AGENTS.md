# 协作约定

- 只有用户明确要求执行、修改或修复时才编辑代码；排查和方案讨论不默认授权编辑。
- 技术方案超过五项任务时，将方案和任务分别保存到 `plan/<方案目录>/`；每个方案目录是一次独立变更，至少包含设计与任务文件。图表使用 Mermaid。
- 核心链路或模块重构时同步 docs/ 和本文件。

## Contemplate

- 当前工作流位于 apps/server/src/agent/workflows/contemplate/，版本为 contemplate-workflow-v2.2-simple。
- merge_record、create_topic、skip_record 统一使用非空、不重复的 recordIds；skip 的执行结果仍逐条记录 recordId。
- 规划阶段的 JSON、结构和业务校验共用一次修正额度。执行阶段不自动重跑，模型或输出截断错误直接失败。
- planningAttempts 保存每次完整规划输出、校验诊断、耗时、结束原因；不能仅依赖响应开头的日志预览排查错误。
- 候选 Topic 不是强制分类列表，禁止硬合并无关记录。原始 Record 是正文依据，不强制补写推断或探索章节。
- 记录状态恢复不等于 Topic 写入回滚。真实模型效果测试使用独立数据库副本，禁止直接重跑用户数据作为验证。

## HTTP 查询

- 真实 Topic 对话前后端均暂缓。现有消息读取只补用户/session 隔离，不扩展聊天运行时。正式认证和异步整理仍为后续范围。
- Record 列表/单条详情返回当前 topics，关联按页批量读取；POST/PATCH 返回基础实体。shared/api/dto.ts 区分读 DTO 和 View。
- Topic 列表使用 updatedAt/id 复合游标且仅返回 active，详情允许查询本用户归档 Topic。

- 当前 HTTP 接口与 curl 示例统一维护在 docs/api/http-api.md，接口变更时同步更新。
- GET /api/records 可按 topicId 过滤，按 createdAt、id 倒序。nextCursor 是复合游标，避免批量记录共享时间戳导致漏页；不要改回仅时间的游标。
- 按 Topic 查记录仍需校验 Record 和 Topic 的用户归属，使用 EXISTS 避免重复关联放大结果集。

## 整理摘要与修改

- records/topics.ext_data 存 JSON，实体/API 为 extData；organization 命名空间保存最近一次成功摘要。更新时只替换该命名空间，不覆盖其他扩展键。不增加反馈字段、接口或 Record tag。
- PATCH /api/records/:id 只接受 content，变化后 status=updated；processing 返回 409；相同内容不更新状态和时间。旧摘要在重整前保留。
- 整理成功后事务提交摘要和最终状态；重新规划替换本批关联，原、新 Topic 都根据当前有效记录重写，无记录 Topic 归档。失败恢复记录状态和原关联不等于 Topic 正文事务回滚。

## 前端 H5

- 独立 H5 前端位于 apps/h5，使用 Vite + React + TypeScript。未来原生小程序、Android、iOS 可在 apps 下独立建设，不要求共用 UI 或构建链路。
- 根目录 `pnpm dev` 只启动后端；`pnpm dev:h5` 启动独立 H5（默认 5174），`pnpm build:h5` 输出到 apps/h5/dist。
- apps/h5 只复用 @fanto/shared 接口契约；UI 遵循 docs/frontend/product-interactive-demo.html 的纸白底色、绿色点缀和底部三栏导航。
- H5 请求使用相对 `/api` 并由开发服务器代理到后端。前端固定开发用户不是正式认证，禁止在浏览器中放置模型密钥。
- Topic Markdown 使用 markdown-it 解析和 DOMPurify 清洗。真实 Topic 对话、录音、反馈、Record tag 和标签管理仍不实现。
- 浏览器自动化必须使用模拟或隔离 API，不得触发真实整理任务或修改用户数据库。

## iOS 底部交互层

- 当前 iOS 只读版只包含“记录 / 回声”两项原生 `TabView` 导航；禁止实现加号、创建入口、候选菜单、底栏 overlay 或自定义抽屉。
- 部署目标为 iOS 17；iOS 26 的 Liquid Glass 仅由系统 tab bar 自动提供，不覆盖系统 tab bar 的背景、尺寸、动画或命中区域。
- 页面内需要呈现内容时，使用各 tab 独立的 `NavigationStack`；不使用透明全屏点击层。
