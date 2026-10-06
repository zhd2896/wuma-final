# 能力图表模式实施计划

**Goal:** 我的棋力中可切换雷达/条形/当前能力折线。
**Architecture:** 纯 skill-chart-model + 原生 skill-chart 组件；profile 页面管理模式偏好，原有账号评分及依据不变。
**Tech Stack:** TypeScript、原生 WXML/WXSS、Node test；不添加依赖。

- [x] 1. tests/skill-chart.test.mts 先验证分数坐标、缺值不绘零、雷达与折线断线、模式切换清理；实现 miniprogram/components/skill-chart/chart-model.ts 及组件 ts/json/wxml/wxss。
- [x] 2. tests/player-skill-page.test.mts 扩充模式切换、不发请求、偏好容错、换账号及退出清理。实现 profile.ts/json/wxml/wxss 中三按钮及图表，保留原评分依据。
- [x] 3. `node --test tests/skill-chart.test.mts tests/player-skill-page.test.mts` 红→绿；运行 `npm run typecheck`、`npm run check`、`npm test` 和 `git diff --check`。
- [x] 4. 独立只读审查，记录自动验证和待真机检查，在当前功能分支保存提交，主工作区 main 不变。
