# 微信登录分支合并审查

日期：2026-10-05。

## 范围与结论

- 登录分支：`codex/wechat-login`，`ed18a3976f177025381f2baed9905bf5036d22bb`。
- 主分支：`main`，`aabb9aff1711d085b66c1678a68ab7b1aa8a4ef0`。
- 共同祖先：`9e2c6a3d93d7ba36709545b5a5bb24381678062b`。
- 另检查了主工作区尚未提交的点位编号和玩法讲解改动的集成要求。

**判定：需要修复和完成集成验证后合并；当前不建议直接合入 main。** 本次仅审查，没有 checkout、merge、commit 或 push，没有读取私密微信配置、操作业务数据库或停止现有服务。

## 发现的问题

### P2：旧请求的 401 会中断已成功的新登录

登录分支 `miniprogram/services/api-client.ts:134–139`。

当携带旧令牌 A 的业务请求尚未结束、用户已经保存新有效令牌 B 时，旧请求后来返回 `AUTH_INVALID`。`clearWechatSession(root, token)` 正确保留 B，但随后的 `showLogin()` 仍无条件执行，使用 `wx.reLaunch` 关闭当前页面。这会让已登录用户进入新棋局或其他页面后再次跳转，丢失当前页面的临时选择。

已在隔离分支快照复现：A 发请求 → 保存 B → A 返回 401。B 保留，仍产生 `/pages/login/login?next=...` 跳转。

建议让失效处理返回“是否确实撤销当前会话”，仅当前会话被撤销或当前已无有效会话时导航；当前存在不同的新有效令牌时只拒绝旧请求。补充同时断言新令牌保留、无登录跳转、无业务写入重放的回归。

### P2：main 的对局操作验收脚本与新认证不兼容

主分支 `scripts/game-operations-devtool-e2e.cjs:119`、`:184`；登录分支 `miniprogram/services/api-client.ts:96–105`。

对局操作验收脚本只保存旧键 `wuma:device-account-token:v1:<API>`，新 API 客户端只读取 `wuma:wechat-session:v1:<API>`。在干净模拟器运行合并后的脚本，会跳到登录页而无法开始棋局；若模拟器残留另一微信会话，则页面身份与脚本服务器夹具身份不一致。现有脚本未保存和恢复新会话键。

建议沿用分支其他脚本的微信会话策略，确保隔离夹具与模拟器共用同一微信用户、有效 token 和 expiresAt；备份并恢复新会话键，保留 API 目的地址检查、测试库检查和请求拦截。同步适配 main 新增页面回归中的匿名凭证夹具，再执行合并结果的测试。

## 必须处理的合并条件

### 迁移与 SQL 存储冲突

只读 `git merge-tree` 预览发现 4 个冲突文件：

1. `README.md`。
2. `backend/alembic/versions/0011_wechat_auth_sessions.py`。
3. `backend/app/db/repositories/mysql_store.py`。
4. `backend/tests/test_mysql_persistence.py`。

登录分支尚未包含 main 后续的棋局操作与迁移兼容修复。解决冲突时须保留两边能力，不能整份选取登录版本：

- 保留 main 的 `0011_wechat_auth_sessions` 建表 `mysql_charset="utf8mb4"`。登录版本第 17 行缺少它，默认字符集不同的数据库可能使 `auth_sessions.user_id` 与 `users.id` 外键不兼容。独立审查用双方源码离线生成 MySQL DDL，确认登录版无 CHARSET、main 版有 CHARSET=utf8mb4。这是 main 已修复的条件，不是合并后必然存在的缺陷。
- 保留 `0014_merge_auth_operations` 及其两个父节点，最终仍应为唯一迁移 head。不要改写业务库版本记录或把文档最终版本退回 `0011`。
- SQL 存储导入同时保留 `AuthSessionModel` 和 main 的棋步、悔棋、终局及远程申请模型；保留 main 的操作事务、有效棋步和版本处理。
- MySQL 测试同时保留新认证、棋局操作测试以及隔离库保护。
- 保留 main 的 `require_game_owner` 对 REMOTE 模式使用房间专属接口的检查。

### 玩法讲解与编号改动

当前主工作区这些改动未提交，不能在合并时覆盖。`app.json` 需同时保留登录页和 guide 分包；`scripts/check.cjs` 需同时保留登录页校验、radio 等原生组件和分包检查。

登录分支 `miniprogram/services/auth-navigation.ts:4–9` 的返回白名单不含 `/guide/pages/rules/rules`。集成后从讲解页登录失效再登录会落回首页。应为已注册讲解页增加明确安全返回路径并补回归，无需开放任意路径。保留编号、复盘走前快照及设置兼容逻辑。

## 本次验证

测试在从指定登录提交导出的独立临时目录执行，未切换或改写工作区。

| 检查 | 本次结果 |
| --- | --- |
| 登录分支前端全量 `npm test` | 348 passed，0 failed |
| `npm run typecheck` | 通过 |
| `npm run check` | 10 页面、17 组件通过 |
| 登录分支后端全量 `pytest backend/tests -q` | 82 passed，24 skipped |
| 旧 401 与新会话竞争复现 | 新令牌仍在，但发生不应有的登录跳转 |
| 分支合并预览 | 4 文件冲突，未真实合并 |
| 独立后端审查 | 未发现新的认证或数据归属阻塞缺陷；确认迁移与权限检查保留条件 |

24 个跳过项需要真实独立 MySQL 测试库。本次显式移除测试子进程的 `WUMA_TEST_DATABASE_URL`，避免继承连接并清理数据库。SQLite 和内存测试不能代替 MySQL 行锁、并发及迁移验收。

服务器 code 换取身份、随机会话令牌摘要保存、到期检查、匿名升级或合并、归属迁移及旧凭证失效均有代码和回归覆盖。真实微信登录、跨设备同用户历史恢复和微信界面仍需验收，不能用本次单元测试替代。

## 合并前顺序

1. 保存当前编号和讲解工作；在独立集成分支同步 main，解决冲突并保留两边功能。
2. 修复旧 401 导航竞争，适配对局操作脚本、相关测试与讲解返回路径。
3. 对集成结果运行前后端完整回归及类型、页面检查。此次登录旧基线的测试结果不代表集成后的结果。
4. 在独立 MySQL 测试库验证唯一迁移 head、新库和两个已有迁移分支升级；验证微信身份首次登录、匿名迁移、并发登录及重启恢复。
5. 开发者工具和真实微信验证成功/失败/退出/到期、同用户跨设备恢复、不同用户隔离；回归本地、AI、远程双人的悔棋、认输、历史、复盘和编号显示。

完成修复与验证后重新判定是否可以合并。
