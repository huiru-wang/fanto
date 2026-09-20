# 动态上下文实施任务

方案：[design.md](design.md)。实施重点和关键触发点见 [implementation.md](implementation.md)。

## 1. 上下文入口与默认角色

- [x] 验证 Pi 的动态提示词、工具后刷新、压缩和用户消息来源路径。
- [ ] 建立轻量 `context/` 模块，并在 SessionManager 的本轮入口准备上下文。
- [ ] 将现有 Fanto Prompt 整理为 Core + 一个 `natural` Profile；不做多角色选择。

验收：动态数据不写入聊天历史；同一轮偏好写入后，下一次模型请求看到新快照。

## 2. 偏好记忆

- [ ] 新增 `user_preferences` 与 GET / POST / PATCH / DELETE。
- [ ] 加入用户隔离、容量、完全相同去重和 version 校验。
- [ ] 新增 `preference_manage`，仅 main 可用；保存来源原话，成功后刷新本轮偏好。
- [ ] 验证长期/临时表达、更新、删除、并发修改、读取或写入失败。

验收：用户在新会话中能看到明确保存的偏好生效；失败或结果不明时不假装已保存。

## 3. 自动记忆召回

- [ ] 将 `eventAt` 透传到现有 Search API、Client 和 Record Tool。
- [ ] 实现 Planner：当前消息 + 最近 2～4 轮 → 0～2 条查询。
- [ ] 复用现有 Record Search，过滤、去重后最多注入 3 条原始证据。
- [ ] 验证隐式关联、指代不足、无关近邻、时间冲突、超时与取消。

验收：相关记录能成为自然背景；检索失败仍正常聊天；不把召回结果写进偏好或会话历史。

## 4. 联合验收与文档

- [ ] 使用真实记录与模型测试偏好判断、召回质量、延迟与主模型输入量。
- [ ] 运行 Server/Agent 测试、构建和真实 HTTP smoke。
- [ ] 按最终实现更新 Current Docs、README、模块 AGENTS 与 docs/.checkpoint。

验收：文档只描述已接入能力，部署前明确已有 SQLite 数据库的升级方式。
