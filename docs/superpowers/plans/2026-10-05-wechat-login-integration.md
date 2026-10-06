# 微信登录集成实施计划

> 在当前会话按步骤执行，使用 executing-plans、test-driven-development 与 verification-before-completion；完成后按 requesting-code-review 进行独立审查。

**目标：** 将可用的微信登录集成至当前五马棋功能，修复审查问题，给出安全启用步骤与明确验收状态。

**架构：** 移植已验证的微信认证分支，使用共同祖先做三方文件合并；保留 main 的棋局操作和当前点位讲解改动。前端显式登录、后端真实 code 换身份、数据库存令牌摘要及到期时间。

**技术：** 微信原生 TypeScript/WXML、FastAPI/Pydantic、SQLAlchemy/Alembic、MySQL。

## 1. 隔离与基线

- [x] 新建 `codex/wechat-login-integration` 与 `.worktrees/wechat-login-integration`，main 保持原状。
- [x] 复制当前编号和讲解改动，排除 `backend/wechat.local.toml`；复用现有依赖。
- [x] 完成前后端基线；前端两处旧静态模板断言与新增编号属性不兼容，已适配并通过专项回归。未配置 MySQL 的后端基线为 156 通过、33 跳过，最终已补齐真实隔离 MySQL。

## 2. 移植现有登录与合并冲突

文件：登录分支涉及的后端 account/config/store/models/wechat_auth、前端 app/login/profile/device-auth/api-client/auth-navigation、测试与联调脚本。保留主分支迁移和棋局操作模型。

- [x] 先移植已有登录测试，运行 `node --test tests/login-page.test.mts tests/wechat-auth.test.mts` 观察当前匿名实现无法满足微信登录行为。
- [x] 用 `git show` 取共同祖先、main 当前文件和登录版本，三方合并后逐一检查冲突；`0011` 使用 main 修复版，模型导入合并两侧，README保留当前阶段记录。
- [x] 适配页面测试存储：`wuma:wechat-session:v1:<API>`，值为 `{token, expiresAt}`，而非旧匿名字符串。
- [x] 类型、页面和相关登录测试通过。

## 3. 新会话保护与静态讲解入口

文件：`tests/wechat-auth.test.mts`、`tests/login-page.test.mts`、`miniprogram/services/device-auth.ts`、`api-client.ts`、`auth-navigation.ts`、`app.ts`、`pages/login/`。

- [x] 添加回归：令牌 A 发出请求后保存 B，A 返回 401；断言 B 保留、无 reLaunch、业务只请求一次。先运行观察失败。
- [x] 失效处理改为有条件导航：
  ```ts
  clearWechatSession(root, token);
  if (!getSavedWechatToken(root)) showLogin();
  ```
- [x] 添加讲解安全返回路径与 App 未登录讲解访问回归，断言外部或未注册路径仍回首页；先观察失败。
- [x] 为 `/guide/pages/rules/rules` 增加精确允许规则，App 对该页面放行；登录页提供导航入口，沿用已存在静态图。
- [x] 重跑登录和编号/教练/分析/复盘相关测试。

## 4. 对局操作验收脚本适配

文件：`scripts/game-operations-devtool-e2e.cjs` 及其对应脚本测试。

- [x] 添加测试验证脚本拒绝已失效会话夹具、读写同一会话键、验证微信身份与夹具所有权。
- [x] 改为使用有效微信会话 token 和 expiresAt，保留 API与独立库校验、请求拦截、原存储保存恢复；若缺少有效会话，在页面或业务写入前退出。
- [x] 运行对应脚本测试和 `node --check scripts/game-operations-devtool-e2e.cjs`。

## 5. 完整验证与交付

- [x] `npm test`、`npm run typecheck`、`npm run check`、`git diff --check`。
- [x] `python -m pytest backend/tests -q`；真实MySQL使用独立实例与 *_test 数据库，不能使用用户业务库。
- [x] 验证迁移唯一 head 与账号升级/合并、会话过期、并发登录、重启恢复。
- [x] 独立代码审查，修复可复现问题后重跑对应回归。
- [x] 编写启用建议：开发者工具使用实施目录，后台 AppID/AppSecret、HTTPS与合法域名；区分代码验证与真实微信/两设备验收。

本次不更改业务数据库、私密微信配置或现有服务，不自动推送或合并 main。

## 执行结果

- 前端完整 450 项通过；类型及 11 页面/18 组件检查通过。
- 后端完整 200 项通过（含 35 项真实隔离 MySQL），无跳过。
- 新库、0011 登录分支、0013 操作分支升级到唯一 head 0014 均通过。
- 独立审查的两处 P2 已按回归修复：设置脚本按稳定 ID 切换；游客讲解返回和开始游戏按会话导航。8 项专项复审通过。
- 临时 MySQL 55473 实例已经关闭，原 3306 数据库及后端未被修改。
- 配置和人工验收见 `docs/wechat-login-integration-acceptance-2026-10-05.md`。真实微信/开发者工具/双设备验收仍未执行，属于阶段待验收事项；未合并 main。

## 后续执行补记

上述结果是首次代码集成记录。随后完成真实微信按钮登录、匿名迁移、会话处理、本地/AI 操作、个人历史、终局复盘和真实 MySQL 持久化实测；讲解页原始自动化跳转仍未通过，双设备/HTTPS 仍待验收。追加四项导航回归后，恢复默认 API 的完整前端 454 项通过。

用户随后明确授权直接合并 main，按该指令提交集成代码；保留主目录既有玩法与点位内容，私密微信配置不进入 Git。详细实际状态见 `docs/reviews/2026-10-05-wechat-live-acceptance.md`。
