# 微信登录实现与验收（2026-10-04）

> 以下为原登录分支的历史记录。当前集成行为、迁移版本与验证结果以 [2026-10-05 集成验收记录](wechat-login-integration-acceptance-2026-10-05.md) 为准：唯一迁移 head 是 `0014_merge_auth_operations`，登录由用户点击按钮触发，不自动重放业务请求。

## 实现状态

微信登录代码已实现并完成本地回归，尚未部署及真机验收。本次用户批准微信登录与本机匿名记录迁移；此前匿名设备账号阶段中“微信登录不在范围”的说明由此次方案替代。

- 小程序自动 wx.login，后端 POST /api/v1/auth/wechat 使用服务端 AppID/AppSecret 验证临时 code。以 AppID + OpenID 的哈希识别用户，不信任前端提供的身份。
- 不同设备登录同一微信用户，沿用同一 users.id；各设备获取独立随机令牌，默认有效期 7 天，数据库仅存令牌摘要。
- 首次登录凭本机旧匿名令牌升级或合并账号，原子迁移棋局和训练答题；旧凭证失效，NULL 归属不认领。写入事务锁用户并拒绝已合并来源，防止迁移期间的旧请求制造失联记录。
- 登录缓存按 API 环境保存，到期重登；AUTH_INVALID/AUTH_REQUIRED 后重登并只重试一次。网络、403 和棋局冲突不重放业务写入。
- 个人中心显示微信账号，已有个人历史和统计继续按用户查询。微信昵称、头像采集及能力评分公式不在本次实现内。
- 更新 Compose 环境、Nginx 登录限流及现有 DevTools 联调脚本。

## 已执行验证

- backend/.venv/Scripts/python.exe -m pytest backend/tests -q：80 passed，24 skipped。跳过项均需专用 MySQL 测试库。
- npm run typecheck：通过。
- npm run check：9 个页面和 17 个组件通过。
- npm test：341 passed，0 failed。详细日志见 results/wechat-login-node-tests.log。
- 6 个修改过的 DevTools 脚本 node --check：通过。
- Alembic upgrade 0010_personal_history_indexes:head --sql：生成 auth_sessions 建表、外键和索引 SQL 成功；唯一迁移头为 0011_wechat_auth_sessions。
- git diff --check：通过。
- 独立代码审查复审：无阻塞问题；认证和持久化相关测试 7 项通过。SQLite 文件测试验证 SQL 用户合并、旧来源写入拒绝和重启恢复，不代替 MySQL 行锁、并发及迁移验收。

## 启用步骤

1. 后端配置 WECHAT_APP_ID=wx698f21721461ccf5（当前 project.config.json 的 AppID）、WECHAT_APP_SECRET 和 AUTH_SESSION_DAYS=7。AppSecret 仅放后端环境或本地不提交的 Compose .env。独立 Uvicorn 不自动加载 .env。
2. 在正确的业务数据库连接环境，从项目根目录执行 backend/.venv/Scripts/python.exe -m alembic -c backend/alembic.ini upgrade head，再启动更新后的后端。此次未对日常数据库执行迁移。
3. 在 miniprogram/config/api.ts 配置 test/production HTTPS API 地址，并在微信小程序后台设置对应 request 合法域名。后端需可连接 api.weixin.qq.com。
4. 在专用迁移好的 *_test MySQL 库配置 WUMA_TEST_DATABASE_URL，运行后端集成测试；不要使用日常库，因为测试会清理数据。
5. 微信开发者工具或真机验证首次登录、关闭重开、另一设备同微信用户恢复个人历史、不同微信用户隔离、匿名数据迁移、失败后重试。验证选定 Nginx 配置 nginx -t 及实际登录限流。

当前执行环境没有 WECHAT_APP_SECRET/WECHAT_APP_ID/WUMA_TEST_DATABASE_URL 环境配置；test/production API 地址为空。因此未调用真实微信，未运行真实 MySQL 集成、DevTools 联调或 Nginx 部署验证。

开发者工具历史复盘脚本改用 WUMA_HISTORY_E2E_TOKEN 和 WUMA_HISTORY_E2E_EXPIRES_AT（微信登录接口返回值），其他复盘/讲解/训练脚本通过模拟器真实 wx.login 共享会话。


## 2026-10-05 独立登录界面

用户确认改为显式登录：首次打开 pages/login/login，点击“微信账号登录”才调用 wx.login。有效本机会话直接进入首页；未登录深链及已失效登录返回登录页，登录后恢复安全的已注册目标页面。业务请求不再自动登录或重放写入。个人中心提供退出登录，清除本机登录状态并返回登录页，个人历史记录保留。

验证：前端完整套件348项通过，类型检查通过，页面检查10页17组件通过；登录界面相关8项行为用例通过，覆盖按钮重复点击、失败留页、有效会话跳过、深链保护及后台重开登录失效、退出保留记录。详细日志 results/wechat-login-page-tests.log。此变更替代前述自动登录及401重登重试策略；真实微信/DevTools视觉仍需验收。

审查发现并修复异步登录跳转竞争：导航进行中合并重复请求，保留首次返回目标，在完成或失败后释放。新增页面栈尚未切换时连续请求登录的回归测试。
