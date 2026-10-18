# 用户个人资料

`domain/users/profile-service.ts` 的 UserProfileService 管理当前用户本人资料；认证和登录身份仍由 AuthService 管理。资料不复用 Fanto 角色设置，不自动注入角色 Prompt。

## 存储与写入

user_profiles 以 user_id 为主键并级联用户删除，包含 nickname、signature、avatar_media_id、cover_media_id、version、updated_at。joinedAt 从 users.created_at 读取。未建立资料行时返回昵称“你”、空签名和头像、version=0。

Profile PATCH 锁定用户后校验 expectedVersion，首次创建也序列化；只合并提交字段，有效变化递增版本，无变化保持版本。本人头像外键在事务提交检查，支持用户级联删除。接口仅使用 JWT 身份，不接受客户端 userId；资料请求 / 响应不记录到 access log。字段与错误见 [HTTP API](../api/http-api.md#用户个人资料)。

## 用户头像与背景图

客户端使用 purpose=user_avatar 上传已确认的方形裁切 JPEG（128–512像素、最多512 KiB），对象路径为 `users/<userId>/profile/avatar/<mediaId>.jpg`。Server 接受已有图片 MIME、解码校验静态方形与实际大小，只保存一个对象，original / thumbnail 都读取该对象。不保留源图。

背景图使用 purpose=user_cover，只上传确认裁切的4:3静态图片，宽640–1600像素、最高1200像素、最多2 MiB，路径为 `users/<userId>/profile/cover/<mediaId>.jpg`。同样只保存一份，original / thumbnail 指向同一个对象。恢复默认背景以 coverMediaId=null 保存。

用户头像和背景图只能绑定本人资料，且不能互换用途；与 fanto_avatar、Record、Project 图片用途隔离。上传和 complete 不会修改用户资料；iOS 在裁切上传完成后立即按版本 PATCH 当前头像或背景图字段，收到确认后才结束裁切。资料首页没有统一保存按钮；昵称、签名在各自二级页只提交当前字段。遗漏字段保持原值，清除背景图显式提交 coverMediaId=null；未保存文本只属于当前单项编辑页。头像上传后未绑定、替换下来的旧头像，由现有头像清理命令回收。

清理命令仍为 `cleanup-fanto-avatars.ts`，现在同时处理 user_avatar、fanto_avatar 和 user_cover，保留24小时且无角色头像、用户头像或背景图引用的资产才可认领删除；默认 dry-run，每批最多100条，失败认领十分钟后可重试。具体机制见 [Media](media.md#fanto-头像)。

## 设备偏好与退出

iOS 外观与强调色保存在设备 UserDefaults，账号切换保留选择，不作为用户资料字段或跨设备同步能力。账号页读取 AuthService.me 返回的有效登录方式；退出清理本机 Keychain 和账号缓存，Token 刷新有代次检查，不能在退出后恢复凭据。没有新增服务端 Token 撤销、导出、注销或记忆管理接口。
