# Fanto 设置

`domain/fanto` 的 FantoService 统一管理基本资料和主对话角色；旧 Character HTTP 接口仅作适配，不再有独立 CharacterService。客户端的主入口是主对话左上头像与昵称，iOS 不保留右上设置图标。

## 数据与写入

`user_fanto_settings` 以 fanto_id UUID 为主键，user_id 为归属外键并级联用户删除；同一用户可存多个角色。当前产品仅创建和操作首个默认角色（created_at、fanto_id 升序），不开放多角色创建与切换。其余字段包含 nickname、description、avatar_media_id、session_id、role_config JSONB、version、created_at、updated_at。角色、场景、交流规则和示例对话保存在 role_config 的 character、scenario、instructions、exampleDialogues 中；后续扩展无需增加列。PATCH 当前只接受已支持键，合并时保留已有未知 JSON 键。头像外键延迟至事务提交检查，支持用户级联删除。

未创建行时读取默认资料，fantoId/sessionId 为空且 version=0；首次写入生成并固定 fantoId，后续修改或更换会话不改变角色身份。角色为空时主对话使用代码默认风格。保存按 expectedVersion 校验，只提交变化字段，roleConfig 按子字段合并。更新锁定用户和设置行，首次创建也遵守同一版本边界；有效变更递增版本，无变化保持版本。昵称/简介仅为资料，简介不注入 Prompt。CharacterProvider 每轮读取一次昵称和角色，读取失败中止 Run，不静默退回默认角色；新设置下一轮生效。

客户端文字草稿与已保存版本分离。iOS 设置首页不提供统一保存，昵称和四个角色字段进入各自二级页单独确认；角色只提交 roleConfig 中当前子键。头像裁切后立即保存只提交 avatarMediaId；成功响应写回共享资料缓存，同字段远端变更要求明确选择。409 后刷新版本并提示确认，不自动覆盖远端。网络响应不确定时读取确认，未确认前保留草稿和上传阶段。HTTP 字段限制见 [HTTP API](../api/http-api.md#fanto-设置)。

## 当前会话与清除

session_id 指向当前角色使用的本人 main Agent Session。iOS“清除对话记录”经中央弹窗确认后，先通过 Agent API 创建空白 Session，再仅 PATCH sessionId；归属校验与设置 version 冲突检查沿用设置接口。只有绑定被确认后才重置当前消息、草稿、分页与恢复状态，并将完整设置响应写回共享内存 / 磁盘缓存。启动及再次进入主对话从设置读取 sessionId，不以 Keychain 的旧指针作为依据。

清除是更换当前会话，不物理删除旧 Session；旧会话仍可从历史对话访问。角色、记忆、Record 均保持原状。回复、停止或恢复期间禁止清除，清除期间禁止继续发送；失败保留原对话，创建成功但绑定未确认的 Session ID 仅供当前运行态显式重试，丢失绑定响应时按设置保存规则查询确认。旧会话分页响应不能重新填入新会话。

## 头像处理

点击设置头像始终选择新图片，进入圆形遮罩预览；拖动/缩放调整取景，取消不上传。圆形只用于展示，保存为方形 JPEG，最多 512×512、最小 128×128、最多 512 KiB，透明区域铺白并去除源图元数据。客户端源文件上限 20 MiB、解码上限 4000 万像素，工作图最长边不超过 4096。只上传裁切结果，不保存原图或裁切参数，不提供下载与再次裁切旧头像入口。

链路为申请 purpose=fanto_avatar 上传凭据 → PUT 裁切图片 → complete 校验 → PATCH 绑定头像。只存一份小图，专用对象路径为 `users/<userId>/fanto/avatar/<mediaId>.<extension>`；当前客户端使用 jpg。读取使用现有受保护 Media URL API，两个 variant 指向同一对象。不在设置中持久化签名 URL。上传失败不自动重试，用户再次保存时复用已确认的阶段。Media 用途隔离与校验见 [Media](media.md#fanto-头像)。

## 清理与迁移

替换头像、恢复默认或上传后未绑定留下的资产，通过运维命令清理。默认 dry-run，只列举超过 24 小时且无设置引用的 fanto_avatar / user_avatar / user_cover 资产，每批最多 100 项；加 --apply 才删除。逐项锁定媒体并再次核对引用后认领，认领后禁止新绑定，删除单个 OSS 对象后再删除元数据。失败保留认领，可在十分钟后再次执行；无后台定时任务。当前头像始终受 user_fanto_settings 与 user_profiles 的引用检查保护。

```bash
pnpm --filter @fanto/server exec tsx src/bootstrap/cleanup-fanto-avatars.ts
pnpm --filter @fanto/server exec tsx src/bootstrap/cleanup-fanto-avatars.ts --apply
```

当前空库从 `create_current_schema_20261019.ts` 基线执行，再应用 `fanto_identity_20261019.ts`：为现有行生成 fanto_id、将其设为主键，保留 user_id 外键并增加归属排序索引，main_session_id 重命名为 session_id。角色、头像、版本和现有会话指针不变。停止旧进程后执行 `pnpm db:migrate`，再启动配套版本；不支持新旧字段混用。迁移只做前向升级。部署方式见 [本地开发](../engineering/local-development.md)。
