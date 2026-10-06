# 阶段9验收：个人资料、真实展示、发布配置和最终授权

当前：独立 SPEC 与 QUALITY 均 PASS；审查后前端527项、后端411项全量通过，均零失败零跳过，静态与只读数据库收尾检查通过。没有部署，没有调用真实微信服务，没有完成两账号两设备真机验收。

## 实现

- 当前账号主动编辑昵称（trim后1至24个Unicode字符、拒控制字符）与内置 `piece_v1_shi` / `piece_v1_ma` / `piece_v1_pao` 头像；严格POST契约、用户事务最终活跃检查、memory/SQL持久化一致。微信登录不会读取微信昵称头像或覆盖自定义资料；首次绑定保留来源资料，合并到已有目标优先保留目标资料。
- 实际个人页编辑/取消/保存；失败保留草稿与错误可重试；generation + root/token上下文隔离旧异步回复，hide/unload/logout不会污染页面。
- 微信登录明确展示联机席位冲突或同编号本地棋谱冲突；失败保留原记录与旧迁移凭据，不伪造会话，可显式重试。
- 公开API构建配置与 `check:release` / `configure:release`。原生校验不依赖Node/process/browser URL，保留部署path；拒localhost、IP（含十六进制）、userinfo、query、fragment和非法URL。错误不回显输入或credentials。开发地址和现有公开AppID保留，trial/release仍空；运行时安全返回登录页显示服务暂未开放，不发wx.login/request。
- 清demo状态、不可达fake hint。实际LOCAL/旧云端LOCAL提示进入真实analysis，AI仍三级教练；设备AI终局显示查看复盘，未同步本地局仍查看终局。README、历史13项审计快照与中文微信发布指南已更新。
- ordinary move/AI/undo/resign/analyze/review/explain/coach的HTTP授权actor传至最终store。最后事务复查active+owner，缓存返回同样复查。SQL按User→Game→Review，REMOTE专用学习的User→Room→Game→Review保持；require_auth=False/user_id=None引擎测试兼容。

## 已执行证据

| 验证 | 结果与日志 |
| --- | --- |
| 资料HTTP红→绿 | 初始12失败，profile/wechat/player-skill聚焦20通过；`staged-phase9-profile-red.log`、`staged-phase9-profile-green.log` |
| 实际资料Page红→绿 | `editProfile`缺失红，草稿/失败/重试/保存/取消/token/lifecycle测试绿；`staged-phase9-profile-page-red.log`、`staged-phase9-profile-pages-green.log`、`staged-phase9-page-build-green.log` |
| 登录冲突mapping | 原HEAD baseline在隔离临时目录运行新行为测试失败，生产文件未回退；`staged-phase9-login-conflict-red.log`；现实现微信auth聚焦绿 |
| 发布配置与runtime | 未配置/非法URL矩阵、有效公开输入、纯字符串十六进制IP拒绝、构建输出、前缀、实际login/App无请求；`staged-phase9-release-red.log`、`staged-phase9-hex-root-red.log`、`staged-phase9-release-green.log`、`staged-phase9-page-build-green.log` |
| 实际game hint | LOCAL/旧云端LOCAL真实路由、AI coach保持、无局反馈；`staged-phase9-display-red.log`、`staged-phase9-display-release-green.log` |
| ordinary actor红→绿 | 11个实际HTTP合并竞态初始11失败；operation/coach/explanation等聚焦72通过；`staged-phase9-actor-red.log`、`staged-phase9-actor-green.log`。首次绿候选因public create_review签名未同步出现29失败，修正后重跑；该中间输出已被同文件覆盖，不当作保留红证据 |
| 前端全量初次 | 524通过、0失败、0跳过；`staged-phase9-frontend-initial.log`，后续补强待最终全量 |
| 补强聚焦与静态检查 | frontend实际Page/build/App等15通过，typecheck与11pages/18components检查通过；`staged-phase9-frontend-focus-green.log`、`staged-phase9-types-green.log`、`staged-phase9-check-green.log`；actor记录计数不变与profile补强24通过，`staged-phase9-actor-profile-final-focus.log` |
| 实际公开发布命令 | development通过；trial/release当前空地址预期失败；release有效format-only公开输入通过，未保存示例；`staged-phase9-release-development.log`、`staged-phase9-release-trial.log`、`staged-phase9-release-production.log`、`staged-phase9-release-format.log` |
| 真MySQL迁移 | UUID `79904ab3-c0d6-11f1-b2bb-088fc3774c8f` / port34365与auto.cnf一致；新 `staged_phase9_profile_migration_test` 从empty迁到0018，旧昵称保留/0019默认avatar/custom降级拒绝/default降级再升通过；`staged-phase9-mysql-prepare.log` |
| 真MySQL普通actor/资料 | 新 `staged_phase9_features_test` 升head；11合并竞态、重启持久化/合并优先、真实锁顺序共14通过；`staged-phase9-mysql-fresh-features.log`、`staged-phase9-mysql-focus.log` |
| 真MySQL并发锁与资料finalactor | 两实际DB事务：merge持User锁，旧actor commit等待，merge后AUTH_INVALID、version0/空棋谱，目标正常落子；另memory/SQL profile最终活跃检查共3通过；`staged-phase9-mysql-concurrent.log` |
| 独立SPEC与QUALITY | SPEC PASS：memory24/Node15；QUALITY PASS：backend50/Node38；见 `docs/reviews/2026-10-06-profile-release-review.md` |
| 审查后前端最终全量 | 527通过、0失败、0跳过；typecheck与11pages/18components检查通过；`staged-phase9-frontend-final.log`、`staged-phase9-typecheck-final.log`、`staged-phase9-check-final.log` |
| 复盘事务测试替身红→绿 | 本次全新 `staged_phase9_finish_redgreen_20261006_test`；原替身拒绝新增user_id参数，红测1失败；显式接收并转发actor/token后1通过，第二条外键注入、两表回滚及后续正常保存断言保持；`staged-phase9-review-fixture-red.log`、`staged-phase9-review-fixture-green.log` |
| 审查后后端最终全量 | 仅新 `staged_phase9_finish_full_20261006_test` + 另一新empty `staged_phase9_finish_empty_20261006_test`；`python -m pytest backend/tests -q` 单进程exit0，411通过、0失败、0跳过、14条既有依赖弃用警告，428.69s；`staged-phase9-backend-final-green.log`。首次全量410通过/1替身参数失败证据仍完整保留 `staged-phase9-backend-final.log` |
| 全量后只读收尾 | 专用UUID/34365再次核对；features为0019/NOT NULL avatar；migration按私有owner有损降级拒绝测试最终停0018且private owners仍存在；`staged-phase9-finish-postfinal.log`。收尾脚本初版错误假设两个库均停head，修正仅脚本预期，原日志保留 `staged-phase9-finish-postfinal-assumption-failed.log` |

对旧 `staged_features_test` 跑清理型SQLfixture被自动审核拒绝：审核把“全新empty迁移库”要求理解为禁止复用所有阶段1至8测试库。原动作未执行；安全替代为新建隔离 `staged_phase9_features_test`，只对新库测试。未删除schema、未操作业务库。最终full另新建features及独立empty migration库，建库前均实际核对专用UUID与34365；见 `staged-phase9-finish-full-features-prepare.log`、`staged-phase9-finish-full-empty-prepare.log`。专用daemon曾拒绝连接，父代理恢复原隔离datadir实例后重新核验，无初始化或删除；连接失败证据见 `staged-phase9-finish-redgreen-prepare.log`，恢复后见 `staged-phase9-finish-redgreen-ready-prepare.log`。SQL验收及只读收尾已结束并释放给父代理关闭自己的专用进程。

## 环境待办与最终检查

trial/release公开地址为空，发布preflight预期FAIL，这是部署配置待办，不是业务测试失败。有效样例仅验证格式且未保存为生产配置；现有AppID未替换，未读取任何ignoredsecret。精选题目前三道全为引擎估计COMPLEX，未宣称人类校准或丰富全难度覆盖。

- [x] 独立SPEC审查（PASS；独立memory24/node15）
- [x] 独立QUALITY审查（PASS；独立backend50/Node38）
- [x] 审查后frontend全量、typecheck、check（527通过、无失败无跳过）
- [x] 新full MySQL features库 + 另一全新empty migrationDB的backend全量，411通过、零失败零跳过
- [x] tracked与untracked新增文件尾空白扫描、git diff --check（100个变更/新增文件检查，尾空白0，diff检查exit0；`staged-phase9-finish-whitespace.log`）

微信生产HTTPS、合法request域名/AppID/backend WECHAT配置与两账号两设备恢复/历史/复盘/私有训练人工验收按 `docs/wechat-release-guide.md` 执行，当前没有结果。

最终暂存检查另外发现四份类型检查日志末尾多余空行，已只规范这些日志的文件结尾，保留命令及完整结果。提交前对全部暂存文件再次执行 `git diff --cached --check`，不以仅检查未暂存改动代替新增文件检查。
