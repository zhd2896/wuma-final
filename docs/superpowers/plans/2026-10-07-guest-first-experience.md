# 首次免登录体验实施计划

**Goal:** 首页免登录教学和电脑试玩，保存及联机时再登录。
**Architecture:** 公开首页与 guide 试玩页；临时草稿独立存储，真实规则重放恢复，登录后复用既有棋谱导入；私有导航在发请求前拦截。
**Tech Stack:** TypeScript、原生小程序、Node test、现有 RuleEngine/RandomAI/棋谱同步。

在 codex/staged-completion 顺序完成以下任务，不切换或合并分支。

- [x] 1. tests/guest-entry.test.mts：先验证首页启动、离线公开路由、带参数私有导航拦截、登录页不被循环重定向。实现 app.json、app.ts、auth-navigation.ts、navigation.ts、首页和登录入口。
- [x] 2. tests/trial.test.mts：验证用户与电脑轮流真实走棋、无效操作、重放草稿、认输和坏数据；实现 guide/trial-controller.ts。
- [x] 3. tests/trial-page.test.mts：验证游客无网络与历史写入、登录后保存原棋谱、保存失败冻结及重试、pending 禁止重开、成功可查看历史。实现 guide/pages/trial 的 ts/json/wxml/wxss 并注册公开路由和教学完成入口。
- [x] 4. 运行 `node --test tests/guest-entry.test.mts tests/trial.test.mts tests/trial-page.test.mts`、`npm run typecheck`、`npm run check`、`npm test`、`git diff --check`；修复并再次验证失败项。
- [x] 5. 独立审查，写验收记录，保存本地提交。真实微信/手机测试未执行时明确列为待验收。
