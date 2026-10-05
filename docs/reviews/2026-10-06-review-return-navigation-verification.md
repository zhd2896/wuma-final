# 复盘返回导航验证（2026-10-06）

## 变更与诊断

复盘页先检查页面栈；有上一页继续 `navigateBack(delta: 1)`，保留历史筛选和游戏实例。没有上一页、SDK 失败或同步抛错时，转到可复盘历史。有有效微信会话才直接进入历史，否则复用 `showLogin` 并保存该历史目的地。修复只涉及 `miniprogram/pages/review/review.ts`。

已检查历史→复盘、游戏→复盘和远程房间→复盘入口，以及返回按钮在加载/错误/成功状态均存在。没有证据支持另外修改第一阶段对局操作代码。

## 自动验证

- 先写并运行 `node --test tests/review-navigation.test.mts`：正常返回 3 项通过，缺页/失败/同步抛错/缺失与过期会话 8 项因原实现缺少恢复而失败（exit 1）。
- 修复后运行 `node --test tests/review-navigation.test.mts tests/review-page.test.mts tests/auth-navigation.test.mts tests/rules-auth.test.mts`：21 项通过，0 失败/跳过（exit 0）。
- `npm test`：465 项通过，0 失败/跳过（exit 0），日志 `results/staged-review-navigation-frontend.log`。父任务先前基线 454 项，本次新增 11 项。
- `npm run typecheck`：通过（exit 0）。
- `npm run check`：11 个注册页面、18 个组件通过（exit 0）。
- `git diff --check`：通过。

Node 仍输出仓库已有 `MODULE_TYPELESS_PACKAGE_JSON` 提示，没有为此调整项目模块配置。本次没有后端变更，不重跑后端；父任务负责其他阶段与后端总体验证。

## 未完成的外部验收

2026-10-05 日志说明开发者工具返回成功但页面栈未变化，还出现退出首页超时。这与本次可重复的无页面栈/失败回调缺口不同；当前修复未验证该 IDE 现象已恢复，也未添加猜测性定时重启。

仍需在微信开发者工具检查历史/本局/联机房间进入复盘后的实际返回，以及直接进入复盘后的历史回退和过期会话登录。两台独立真机联机、真实断网后使用相同请求 ID 重试也仍待执行，不由 SDK 单元适配器测试替代。

代码未提交，交主任务审查。全局阶段路线图由主任务维护。
