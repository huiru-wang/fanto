# H5「记录 / 脉络」实施任务

对应设计：[design.md](design.md)。按依赖顺序执行。

## 0. 服务端读取能力

- [ ] 为 `GET /api/records` 增加可选自然日查询（`date`、`timezone`），保持旧游标语义兼容。
- [ ] 设计并实现月度有记录日期的轻量聚合响应，或明确月历只显示已加载数据；补充 Repository 与路由测试。
- [ ] 补齐 / 校正共享 DTO：Record Read 的媒体字段、Creation Overview / Detail / SourceRecord 的读取契约。

## 1. H5 数据与路由重构

- [ ] 将 API client 拆为 records、uploads、creations 三个模块，并集中开发用户配置与 snake_case 映射。
- [ ] 移除失效的 Topic / Contemplate 查询，新增 Creation 概览、详情和来源记录分页 Query。
- [ ] 将 Hash 路由迁移为 records / creations / 详情 / 编辑路径，并为旧 topic 地址添加兼容重定向。

## 2. 应用框架与响应式导航

- [ ] 新建响应式应用壳：移动端底部导航、平板与桌面侧栏导航、统一的新建入口。
- [ ] 建立视觉 token、断点、内容列宽度、safe-area、可访问焦点样式与 reduced-motion 规则。
- [ ] 完成 375px、768px、1440px 布局截图基线。

## 3. 记录日历与 Timeline

- [ ] 实现以周日为首日的日期工具、单一 selectedDate 状态、周 / 月锚点。
- [ ] 实现单容器周 / 月日历切换、周翻页 / 月翻页、记录点和中文日期标签。
- [ ] 实现按日 Timeline 查询、加载 / 空 / 错误态与记录行媒体展示。
- [ ] 实现桌面双栏与移动单列的布局切换，不复制数据状态。

## 4. 记录创建、媒体和编辑

- [ ] 用 Sheet / Dialog 重写新建记录，支持文本草稿与图片、音频文件选择。
- [ ] 接入 upload URL、直传、complete、Record 创建，并处理进度、重试、取消与草稿保留。
- [ ] 在详情与编辑页展示并保留既有媒体；正确处理 `expectedVersion` 冲突。

## 5. 脉络概览与详情

- [ ] 实现概览的 skeleton、空态、失败重试、继续跟踪列表和类型目录。
- [ ] 实现 Creation 详情的 Markdown 安全渲染、状态与更新时间。
- [ ] 实现来源记录分页；桌面辅助栏与移动端正文下方布局。

## 6. 质量与发布准备

- [ ] 为日期边界、路由兼容、API mapper、上传状态、分页游标编写单元测试。
- [ ] 用 Playwright 覆盖移动与桌面主流程、无障碍焦点和主要空 / 错误态。
- [ ] 执行 typecheck、H5 build、服务端测试；对真实 OSS 测试上传后再合并。
- [ ] 更新 `docs/` 中 H5、HTTP API、记录与脉络文档，去除已完成的限制说明。
