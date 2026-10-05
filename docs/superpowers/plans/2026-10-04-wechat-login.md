# WeChat Login Implementation Plan

**Goal:** 微信用户登录，跨设备访问同一用户的历史与训练数据，并迁移本机匿名记录。
**Architecture:** wx.login → 后端微信验证 → users 身份 + auth_sessions 令牌 → 已有所有权鉴权。
**Tech Stack:** 微信原生 TypeScript、FastAPI、httpx、SQLAlchemy、Alembic、MySQL。

- [x] 在 backend/tests/test_wechat_auth.py 写 HTTP 登录、迁移、权限与过期用例；运行 backend/.venv/Scripts/python.exe -m pytest backend/tests/test_wechat_auth.py -q，确认因登录接口未实现而失败。
- [x] 在 backend/app/services/wechat_auth.py 实现受控微信网络请求；配置 backend/app/core/config.py，新增 auth_sessions 模型及 0011 迁移。令牌存储仅用 SHA-256，session_key 不持久化。
- [x] 增加内存与 MySQL login_wechat 存储方法，原子升级或合并匿名账号，复用 resolve_device 做兼容鉴权；在 account.py 增加 POST /auth/wechat 并注入验证服务到 main.py。
- [x] 在 tests/wechat-auth.test.mts 写小程序并发登录、迁移、缓存期限、失败和 AUTH_INVALID 恢复用例；运行 node --test tests/wechat-auth.test.mts，确认现有设备建号流程失败。
- [x] 实现 device-auth.ts 的微信凭证流程与 api-client.ts 的一次失效恢复；更新既有页面测试夹具为微信会话。
- [x] 增加 MySQL 双设备持久化和迁移集成测试；为 .env.example、compose.yml、Nginx 登录限流和 backend/README.md 补配置及上线步骤。
- [x] 运行后端内存完整套件、npm run typecheck、npm run check、npm test；生成 Alembic 离线迁移 SQL并检查 git diff --check。记录真实微信与 MySQL 未验证边界。


## 实际验证

2026-10-04：完整后端 80 passed、24 skipped（专用 MySQL 未配置）；前端 341 passed。类型和页面检查通过；6 个 DevTools 脚本语法检查通过，0011 离线 SQL 与唯一迁移头检查通过。独立审查发现的迁移并发写入问题已用失败用例复现并修复，复审通过。真实微信、MySQL 和 Nginx 部署未验收；完整阶段不标记已上线。
