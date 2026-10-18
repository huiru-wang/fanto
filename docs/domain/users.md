# 用户个人资料

`domain/users/profile-service.ts` 的 UserProfileService 管理当前用户本人资料；认证和登录身份仍由 AuthService 管理。资料不复用 Fanto 角色设置，不自动注入角色 Prompt。

## 存储与写入

user_profiles 以 user_id 为主键并级联用户删除，包含 nickname、signature、avatar_media_id、version、updated_at。joinedAt 从 users.created_at 读取。未建立资料行时返回昵称“你”、空签名和头像、version=0。

Profile PATCH 锁定用户后校验 expectedVersion，首次创建也序列化；只合并提交字段，有效变化递增版本，无变化保持版本。本人头像外键在事务提交检查，支持用户级联删除。接口仅使用 JWT 身份，不接受客户端 userId；资料请求 / 响应不记录到 access log。字段与错误见 [HTTP API](../api/http-api.md#用户个人资料)。

## 用户头像

客户端使用 purpose=user_avatar 上传已确认的方形裁切 JPEG（128–512像素、最多512 KiB），对象路径为 `users/<userId>/profile/avatar/<mediaId>.jpg`。Server 接受已有图片 MIME、解码校验静态方形与实际大小，只保存一个对象，original / thumbnail 都读取该对象。不保留源图。

用户头像只能绑定本人资料；与 fanto_avatar、Record、Project 图片用途隔离。上传和 complete 不会修改用户资料；iOS 编辑页点击保存后，才按版本统一提交头像、昵称和签名。离开未保存编辑只保留本账号运行态草稿。头像上传后未绑定、替换下来的旧头像，由现有头像清理命令回收。

清理命令仍为 `cleanup-fanto-avatars.ts`，现在同时处理 user_avatar 和 fanto_avatar，保留24小时且无两类资料引用的资产才可认领删除；默认 dry-run，每批最多100条，失败认领十分钟后可重试。具体机制见 [Media](media.md#fanto-头像)。

## 设备偏好与退出

iOS 外观与强调色保存在设备 UserDefaults，账号切换保留选择，不作为用户资料字段或跨设备同步能力。账号页读取 AuthService.me 返回的有效登录方式；退出清理本机 Keychain 和账号缓存，Token 刷新有代次检查，不能在退出后恢复凭据。没有新增服务端 Token 撤销、导出、注销或记忆管理接口。
