# 微信登录集成与启用步骤（2026-10-05）

## 当前阶段

**代码和隔离 MySQL 验证完成，独立代码审查通过；真实微信、开发者工具与两设备验收尚未完成，暂不能判定整体阶段验收通过。**

- 实施分支：`codex/wechat-login-integration`。
- 实施目录：`E:\C盘Doucment\ChatGPT\wuma最终版\.worktrees\wechat-login-integration`。
- 将原登录分支 `codex/wechat-login @ ed18a39` 集成到 `main @ aabb9af`，保留当前点位编号、玩法讲解、棋局操作、分析、教练和复盘改动。
- 这些改动尚未提交或合并 main。原主目录不是本次实现的运行入口。
- 原业务数据库、原后端服务和私密微信配置未被本次测试修改。测试实例使用临时目录和 55473 端口，验证后已经关闭。

## 已实现的功能

1. 独立登录页面。用户点击微信登录按钮才调用 `wx.login`；失败可重试，不自动生成演示身份。
2. 后端以 AppID/AppSecret 调用微信 code 换身份接口，不接受客户端自行提交的 OpenID 作为身份。AppSecret 和 session_key 不返回小程序。
3. 同一微信身份对应同一用户，各设备获得独立随机会话；数据库只存令牌摘要及到期时间，默认 7 天，可配置为 1～30 天。
4. 会话按 API 环境保存在本机；有效会话免重复进入登录页，过期或失效回到登录页。登录完成保留合法目标页面；不自动重放落子等业务请求。
5. 个人页退出登录清除本机会话，保留历史记录。后端个人数据和棋局接口继续检查归属。
6. 首次微信登录可迁移本机旧匿名凭证所属的棋局和训练记录；凭证成功迁移后撤销。离线本地历史仍在本机；无归属的旧数据不自动认领。
7. 玩法讲解允许游客浏览；游客开始 AI 对局或在冷启动讲解页返回时进入登录页。
8. 保留真正双人房间独立席位凭证及现有悔棋、认输逻辑。远程席位凭证不等于微信账号，也不在此次个人记录迁移范围。

## 集成审查与修复

- 旧请求的 401 不再清除新登录会话或把已有新会话的用户送回登录页；旧请求自身仍失败，业务请求只发一次。
- 对局操作联调脚本使用微信会话 `{token, expiresAt}`，在任何页面或业务写入前校验会话有效、测试库与 API 一致、夹具归属微信用户。
- 设置页新增点位编号开关后，脚本通过 `setting-legal-targets` 精确定位合法落点开关；不依赖开关排列顺序。
- 修复讲解页的游客返回兜底和开始 AI 入口；对应修复均先观察回归失败，再修改实现。
- 独立复审通过，两个修复的 8 项专项回归全部通过，未发现阻塞合入的代码问题。

## 验证结果及边界

| 项目 | 结果 |
| --- | --- |
| 前端 `npm test` | 450 通过，0 失败、0 跳过 |
| 前端类型检查 | `npm run typecheck` 通过 |
| 页面结构检查 | `npm run check` 通过，11 页面、18 组件 |
| 对局操作脚本语法 | `node --check scripts/game-operations-devtool-e2e.cjs` 通过 |
| 后端完整测试 | 200 通过，0 失败、0 跳过 |
| 其中真实 MySQL 测试 | 35 项，独立 MySQL 8.4 实例及专用 `*_test` 库 |
| 新库迁移 | 空库升级到唯一 head `0014_merge_auth_operations` 通过 |
| 旧登录分支数据库迁移 | 从 `0011_wechat_auth_sessions` 升级，已有用户、棋局、会话保留 |
| 旧棋局操作分支数据库迁移 | 从 `0013_remote_undo_revert_count` 升级，已有用户、棋局保留 |

测试覆盖令牌到期、账号迁移与合并、并发登录、重启恢复、棋局归属及原有对局操作。测试中的微信身份交换使用可控替身；**这些结果不代表真实微信接口、真机网络和两设备联机已经验收。** 原有开发者工具 E2E 脚本已适配，但本次没有执行真实开发者工具自动化。

前端完整结果位于 `results/wechat-login-integration-frontend.log`。历史文档中的旧测试数量、匿名凭证脚本示例和迁移阶段只描述当时状态，启用本次实现以本文为准。

## 在本机启用

### 本轮实际验收补记

后续已使用真实微信服务、开发者工具和专用 MySQL 执行本机验收：按钮登录、匿名迁移、退出/再次登录、免登录/过期、本地与 AI 操作、个人历史和终局复盘均取得通过证据。游客讲解开始 AI 的自动化跳转仍未通过，人工点击对照待确认；两设备和 HTTPS 环境尚未验收。

最新实际状态以 [本机真实微信验收记录](reviews/2026-10-05-wechat-live-acceptance.md) 为准。本轮读取了原目录私密微信配置到测试后端内存，没有复制该文件或迁移业务库；下文“没有读取私密配置”等叙述对应前一轮代码集成。

### 1. 打开正确目录

微信开发者工具导入上面的实施目录，确认 `project.config.json` 的 AppID 为 `wx698f21721461ccf5`，并与后端配置一致。使用有该小程序开发权限的微信账号。

### 2. 配置后端微信凭据

本次没有读取或复制原主目录的私密 `backend/wechat.local.toml`。可由你在本机将现有有效配置复制到实施目录，或者在实施目录执行以下命令建立模板，然后填写该 AppID 对应的真实 AppSecret：

```powershell
cd 'E:\C盘Doucment\ChatGPT\wuma最终版\.worktrees\wechat-login-integration'
if (-not (Test-Path -LiteralPath 'backend/wechat.local.toml')) {
    Copy-Item -LiteralPath 'backend/wechat.local.toml.example' -Destination 'backend/wechat.local.toml'
}
```

配置字段：`WECHAT_APP_ID`、`WECHAT_APP_SECRET`、`AUTH_SESSION_DAYS`。该文件已被 Git 和 Docker 构建忽略；环境变量优先于文件。AppSecret 只保存在后端私密配置中，无需发到聊天或写入前端。更改后重启后端。缺配置会明确返回 `WECHAT_NOT_CONFIGURED`。

### 3. 迁移成功后启动实施目录后端

若原后端占用 8000，在其原终端按 Ctrl+C 停止后再运行本次代码。以下步骤由你启用时执行，本次测试没有替你迁移业务库：

```powershell
cd 'E:\C盘Doucment\ChatGPT\wuma最终版\.worktrees\wechat-login-integration'
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '3306'
$env:DB_NAME = 'wuma'
$env:DB_USER = 'wuma'
$env:DB_PASSWORD = [System.Net.NetworkCredential]::new('', (Read-Host '请输入数据库密码' -AsSecureString)).Password

.\backend\.venv\Scripts\python.exe -m alembic -c backend/alembic.ini upgrade head
if ($LASTEXITCODE -ne 0) { throw '数据库迁移失败，停止启动后端' }
.\backend\.venv\Scripts\python.exe -m alembic -c backend/alembic.ini current
if ($LASTEXITCODE -ne 0) { throw '数据库版本检查失败，停止启动后端' }
.\backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

预期数据库版本是 `0014_merge_auth_operations (head)`。迁移失败时先解决报错，不使用 `stamp` 跳过迁移或删除旧记录。后端需要能访问微信的 `api.weixin.qq.com` 服务。

### 4. 区分开发者工具与手机地址

- 开发者工具本机测试：当前开发地址 `http://127.0.0.1:8000` 可连接本机后端。
- 手机预览、体验版和正式版：配置手机可访问的 HTTPS API，并在微信后台登记 request 合法域名；手机的 `127.0.0.1` 不指向电脑。
- `miniprogram/config/api.ts` 中体验版 `test` 和正式版 `production` 地址目前为空，发布前必须填写实际部署地址。不同环境使用独立缓存会话。
- 重新编译实施目录小程序，无需清空已有历史和房间凭证。

## 真实验收清单

使用测试账号和测试对局，记录微信开发者工具版本、后端版本、数据库 head、两设备环境及截图：

- [ ] 无会话打开小程序进入登录页；未点击按钮不自动登录；游客可打开玩法与点位讲解图。
- [ ] 点击登录实际成功；后端无微信配置或微信交换失败时显示可重试错误，不伪造成功。
- [ ] 有效会话重进免登录；退出、会话到期或后端失效后重新登录，历史记录保留。
- [ ] 登录后回到原来的合法业务页；从讲解开始 AI 时先登录再进入对局。
- [ ] 持有旧匿名凭证的测试账号首次登录后，原云端棋局和训练记录归属正确；重复登录不重复迁移。
- [ ] 两台设备同一微信账号能看到相同云端个人数据；不同微信账号不能读取对方私人棋局。本地离线历史不要求跨设备同步。
- [ ] 本地与 AI 对弈、历史、分析、教练、复盘、悔棋和认输在登录后正常工作。
- [ ] 真正双人两台设备建房/加入、席位重连、双方同意或拒绝悔棋、任一方认输和终局复盘通过；席位仍使用各自房间凭证。
- [ ] 体验版、真机使用正确 HTTPS 地址与合法域名；没有仅在本机开发者工具可用的情况。

## 建议

1. 先完成真实微信登录与旧数据迁移验收，再进行 main 集成和发布；不要把替身测试通过视为微信平台验收通过。
2. 使用当前“点击登录 + 服务端验身份 + 独立到期会话”方案；不以昵称、头像或客户端 OpenID 判断账号归属。
3. 昵称和头像后续作为可选个人资料编辑，不阻塞登录和下棋。
4. 手机验证优先准备可访问的 HTTPS 测试 API；AppID、后端凭据和小程序环境配置保持一致。
5. 向用户说明“云端账号记录”和“本地历史”的保存范围；真正双人席位凭证与微信会话分别管理。
