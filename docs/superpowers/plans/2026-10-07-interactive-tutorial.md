# 操作式教学实施计划

**Goal:** 完成三次实际走棋后进入入门 AI。
**Architecture:** guide 分包教学页复用棋盘及规则引擎；纯控制器管理关卡，页面保存本机检查点。AI 页面通过显式路由新建指定难度，正常恢复不变。
**Tech Stack:** 原生小程序、TypeScript、Node test。

本次在现有 codex/staged-completion 功能分支内顺序执行并审查。

- [x] 1. 新建 tests/tutorial.test.mts：用目标 P11→P12、P08→P13 验证三关实际吃子、备用棋消耗、错误和跳关、重练及完成状态；运行 `node --test tests/tutorial.test.mts` 观察功能缺失失败。
- [x] 2. 新建 miniprogram/guide/tutorial-controller.ts，实现三关局面和 TutorialController 的 tap/next/retry，使用 RuleEngine.executeTurn 和 captures 判定通过；重复运行上一命令。
- [x] 3. 新建 tests/tutorial-page.test.mts，通过 Page/wx 边界验证无账号教学、检查点恢复、结束后登录及 AI 参数；扩充 tests/ai-levels.test.mts 验证已有 ADVANCED 活动棋局时的 BEGINNER 新建与失败保留 ID；先观察失败。
- [x] 4. 新建 guide/pages/tutorial/tutorial 的 ts/json/wxml/wxss；注册分包及公开路径，在 app.onShow 先放行公开离线页；首页、登录及图解添加教学入口。页面显示编号、目标源与目标点、结果和下一步/重练。
- [x] 5. 修改 game.ts：校验 level 路由，new=1 且无 gameId 时使用初次空读取存储包装；新建成功后回到普通存储，失败不清除旧 ID。仅使用内存难度，不持久化默认偏好。
- [x] 6. 运行 `npm run typecheck`、`npm test`、`npm run check`、`git diff --check`；审查身份边界、备用棋及异常导航，记录验收结果及未执行的真机验收。
