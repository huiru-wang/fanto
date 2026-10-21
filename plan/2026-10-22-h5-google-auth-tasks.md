# H5 Google 登录执行任务

状态：待执行。前置方案：`2026-10-22-h5-google-auth-design.md`。本清单不代表代码已变更。

| 顺序 | 任务 | 主要范围 | 依赖 | 完成标准 |
| --- | --- | --- | --- | --- |
| 1 | 核对 Web Client ID 和环境，替换测试认证配置 | H5 config/vite-env/.env.example，Server 配置，Google Cloud，部署检查 | 无 | Web ID 与 Server audience 一致且保留 iOS audience；实际来源已保存；生产不再注入固定测试 token；确认协议页面的发布安排 |
| 2 | 实现通用 AuthSession 与原始认证 API | auth/session、auth API、api/http.ts、api/agent.ts | 1 | restore/install/refresh/signOut；刷新去重；sessionStorage 新 key；401 一次重试；暂时故障不退出；generation 拒绝旧响应；旧测试 key 清理；不扩大业务写入自动重试 |
| 3 | 接入 Google GIS 官方按钮 | SDK loader、Google button 与登录尝试状态 | 1、2 | SDK 加载去重；intent 在按钮前准备；nonce 绑定；credential 一次消费；过期/取消/超时可重新开始；不引入 Client Secret 或授权码交换 |
| 4 | 实现参考 iOS 的未登录首页与品牌启动页 | 登录/启动组件、认证页局部样式、复用品牌资源 | 3 | 精灵+标语+渐变；Google 为唯一主操作；小屏可滚动；真实加载状态和错误；Google 按钮样式符合官方能力；低动态与键盘可访问 |
| 5 | 接入 AuthGate、首次角色准备与本机退出 | main.tsx、App.tsx、FantoContext.tsx、FantoListPage | 2、4 | React 立即挂载；无身份不发业务请求；身份与准备分离；默认角色校验完成才挂聊天；初始化失败可重试；站内深链恢复；退出清理并隔离旧 SSE/刷新/用户树 |
| 6 | 补齐后端 Google 验证边界与临时故障语义 | Google Provider、AuthError、routes、认证测试 | 可在 1 后独立执行 | exp 必填；错误签名/issuer/aud/nonce/sub/expiry 覆盖；JWKS 临时故障可识别并返回 503；保持 sub 主身份和联系方式现有契约 |
| 7 | 完成自动化与真实浏览器验收 | H5 状态/请求测试、Server 认证测试、隔离 PG、浏览器 | 2–6 | typecheck/test/build 通过；登录恢复/退出竞态/跨用户隔离/失败恢复通过；真实 Google 首次与已有用户登录通过；375/390/1280 视觉检查；不以 mock 冒充线上验收 |
| 8 | 同步当前文档并执行发布检查 | H5 AGENTS、clients/h5、configuration、local-development、current-scope、overview、必要时 README/http-api | 7 | 文档与最终代码一致；H5 重建、Server 重启；线上域名来源/CSP/COOP/Google 可达性与 token audience 实测；协议隐私链接真实可读；明确本机退出与标签页会话边界；不自动推进 docs/.checkpoint |

发布依赖与风险：

- Google Cloud 配置需操作者保存，Audience 需包含验收账号或已正确发布；尚未验证的控制台状态不能由本地代码替代。
- 线上入口上一轮只读检查得到 403，需在最终发布验收确认原因与可达性；它不证明认证代码有问题。
- `/terms`、`/privacy` 当前仅有约定地址，实际内容应在公开发布前落实，不借用 SPA fallback 充当页面。
- 同一标签页刷新保留会话，关闭后重新登录；需要跨标签页或长期设备登录时另行评审存储方案。
- 旧 Refresh 不因刷新或本机退出立即撤销；跨设备注销和 Refresh 重用检测属于后续能力。
- 编辑前重新读取工作区最新差异，保留聊天与 LiquidGlass 的现有未提交工作；只局部调整启动门禁，不改聊天视觉设计。
