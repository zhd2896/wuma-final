# 阶段7：联机分析、解释与个人训练验收

## 已实现行为

- 实际联机对局页进入 `mode=online` 分析。恢复当前账号已绑定席位，以真实房间状态/version、席位token请求专用分析接口；支持进行中与结束局面，等待/取消/过期房间拒绝。界面显示自己的席位、分析方、真实A/B备用棋、候选路线及引擎风险。
- 联机复盘使用本人固定席位，读取或生成事实约束解释；无LLM使用既有规则解释，缓存不改变复盘事实。支持本人失误/严重失误生成训练，无失误明确提示不生成题目，有题进入本人棋局+player训练列表。
- 专用联机接口复用原分析、解释和训练服务。保存与返回前重验版本、当前账号、绑定席位及token，令牌轮换、账号合并、异步计算后的旧请求拒绝。普通Game接口继续拒绝REMOTE。
- 私有题保存独立账号owner，双方及第三账号的list/get/legal/answer/进度互相隔离，无需持久房间token；owner不进入公开question，答案保持隐藏。重复生成幂等，题目保留不可变来源、状态、配置、深度。合并迁移题目和进度，缓存答题及get/legal/list/空分页count最终读取也拒绝退休账号。
- 新增0018迁移，只增加可空owner/FK/index，继承真实用户主键排序规则。旧LOCAL/AI题继续按棋局归属，CURATED继续公开；已有私有owner时拒绝有损降级。
- 前端hide/unload、账号变化、席位轮换和请求代次隔离迟到数据与导航；权限变化清空旧复盘并允许重试。

## 实际证据

- 后端最初缺少路由、owner列及race漏洞分别见 `staged-phase7-backend-red.log`、`staged-phase7-schema-red.log`、`staged-phase7-races-red.log`、`staged-phase7-private-reads-red.log`。
- 质量审查发现解释与训练并发的Review/User锁顺序反转；真实MySQL事件回归先红后绿1 passed，见 `staged-phase7-lock-order-red.log`/`staged-phase7-lock-order-green.log`。专用保存统一User→Room→Game→Review，普通解释保持兼容。
- 前端真实Page/controller红绿见 `staged-phase7-pages-red.log`、`staged-phase7-pages-green.log`、`staged-phase7-lifecycle-red.log`、`staged-phase7-lifecycle-green.log`、`staged-phase7-reserve-red.log`、`staged-phase7-reserve-green.log`。
- 内存联机学习及最终读取聚焦：18 passed，0 failed/skip，见 `staged-phase7-private-reads-green.log`。
- 最终前端全套：514 passed，0 failed/skip，见 `staged-phase7-frontend-final.log`。Typecheck与check通过，check覆盖11个注册页面、18个组件。
- 真实MySQL初始联机合同与最终事务13项通过；迁移降级实红发现FK支撑index删除顺序，修正后前读取修复全量345 passed，见历史 `staged-phase7-backend-pre-read-fix.log`。这份历史日志不作为最终后端通过证据。
- 最终后端全量355 passed，0 failed/skip，耗时343.11秒，含真实MySQL最终读取、锁顺序及全新库迁移检查；见 `staged-phase7-backend-final.log`。输出14条既有Starlette/Alembic弃用警告，无测试失败。前锁序修复354 passed保留在 `staged-phase7-backend-pre-lock-fix.log`，仅为历史证据。

## 数据库与执行范围

SQL执行前核验专用实例UUID `79904ab3-c0d6-11f1-b2bb-088fc3774c8f`、端口34365及既有auto.cnf。仅升级专用 `staged_features_test` 至0018；最终迁移测试使用新建、断言不存在且空表的 `staged_phase7_quality_final_20261006_1830_test`，UTF8MB4/unicode_ci。准备脚本及日志保留，无初始化/删除现有库，无触碰业务数据库、密钥或系统MySQL。

SPEC与QUALITY独立复审均PASS，父代理记录审查结果。日志已清理行尾空白，git diff --check通过。未生成一次性编辑脚本，SQL准备脚本保留供后续阶段核验。

尚未部署。真实微信设备的双账号、跨设备和联机视觉验收未执行，不能以Node Page测试代替真机验收。本代理不提交、推送或部署。
