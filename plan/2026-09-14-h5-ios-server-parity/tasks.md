# H5「记录 / 脉络」iOS 与服务端对齐任务

对应设计：[design.md](design.md)。以下按依赖顺序实施。

## 1. 重建工程骨架

- [ ] 恢复 `apps/h5` 的 Vite、React、TypeScript 包定义和开发代理；沿用根目录 pnpm workspace 与 `dev:h5` / `build:h5` 脚本。
- [ ] 配置 TanStack Query、Hash Router、全局错误边界、开发用户配置和相对 `/api` 客户端。
- [ ] 移除旧 Topic / Contemplate 页面假设，为旧 hash 地址加入到 creations 的兼容重定向。

## 2. 契约与 API 层

- [ ] 定义 Record、Media、Upload、Creation、Proposal 的 H5 DTO / View Model 及严格 mapper。
- [ ] 实现标准响应信封、超时、取消、错误映射与写入“状态未确认”提示。
- [ ] 实现 records、uploads、creations、proposals API 模块和完整 Query key / 失效策略。
- [ ] 为 content / summary 解析、snake_case 映射、游标和错误映射增加单元测试。

## 3. 应用壳与视觉基础

- [ ] 建立纸白、绿色点缀、时间线和层级排版 tokens，以及响应式栅格、safe-area、焦点、reduced-motion 样式。
- [ ] 实现移动底部两栏导航、平板/桌面侧栏及统一的新建记录入口。
- [ ] 实现路由过渡、Sheet / Dialog 呈现基础与无障碍焦点管理。

## 4. 记录浏览

- [ ] 实现周日首日的日期工具，确保 selectedDate、weekAnchor、monthAnchor 和 calendarMode 的单一所有权。
- [ ] 实现同一容器中的周历 / 月历、翻页、选中回落、已加载记录点和完整中文日期标签。
- [ ] 实现按所选日筛选的 Timeline、图片缩略图、原生音频播放、加载/空/失败/重试状态。
- [ ] 实现移动单列与桌面 sticky 日历 + Timeline 双栏；接入首批 100 条和按游标的后续记录分页。

## 5. 记录写入与媒体

- [ ] 实现新建记录草稿、文本校验、移动 Sheet / 桌面 Dialog、草稿保留和成功后的查询更新。
- [ ] 实现图片 / 现有音频文件的“申请上传凭据—直传—complete—mediaId 提交”状态机、进度、移除、取消与失败重试。
- [ ] 实现记录详情与编辑，保留既有媒体并正确处理 `expectedVersion` 冲突和刷新。

## 6. 脉络概览与 Proposal

- [ ] 实现 Creation overview 的加载、空、失败、刷新、继续跟踪与类型目录。
- [ ] 实现 Proposal pending 查询、至多三层视觉卡组、单一拖动分类、按钮/键盘/屏幕阅读器等价操作。
- [ ] 实现 Proposal 详情和 confirm / reject；按服务端结果刷新或移除并处理失败。
- [ ] 实现类型列表路由，调用已注册的 `GET /api/creations?kindId`，避免本地假数据。

## 7. Creation 详情

- [ ] 并行加载详情与首批来源记录，安全渲染 Markdown、状态和更新时间。
- [ ] 实现来源 Timeline 的游标分页、异常显示、桌面辅助栏和移动回落布局。

## 8. 验证与文档

- [ ] 为日期边界、上传状态、路由重定向、版本冲突、Proposal 决策和来源游标增加单元测试。
- [ ] 用隔离 API 的 Playwright 覆盖 375px、768px、1440px 主流程、焦点、空/错态和 reduced-motion；不调用真实整理或用户数据库。
- [ ] 执行 H5 typecheck/build 与服务端相关测试，修复实际失败。
- [ ] 更新 `docs/clients/h5.md`、`docs/api/http-api.md` 和必要的记录 / 脉络文档，反映已实现能力与仍存在的接口边界。
