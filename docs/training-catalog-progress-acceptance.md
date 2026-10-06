# 阶段三验收：精选残局、筛选、指定棋局学习与个人进度

实现范围只包含阶段三，未实现远程生成训练、玩家棋力、同步、回放或 AI 等级。阶段三新增迁移唯一 head 为 `0016_training_catalog`，衔接 `0015_remote_participants`。

## 已验证行为

统一模型增加 `sourceKind`、`title`、`catalogVersion`。精选题来源外键、原失误走法与类别均为空，无伪造棋局或复盘记录。旧 REVIEW 保留真实来源和评分配置；无 source 参数的旧列表仍默认 REVIEW。首页显式进入 CURATED，训练页可切换两种题源；复盘生成后携带 REVIEW 和来源棋局进入列表。

三道精选题使用规范 Engine 校验完整局面、全部合法候选、最佳走法与固定深度二评分，逐候选真实答题评分证明每题具有最佳和严格次优合法选择。公共读取仅暴露题源、描述、难度依据与本人进度，答案只在成功提交后返回。局面校验或评分超时/未达到保存深度时拒绝生成或保存，不产生假成功记录；错误路径测试只对真实 Engine 结果注入超时标记。

| 题目 | 固定 ID | 合法候选数 | 题库版本 |
| --- | --- | --- | --- |
| 夹击与调度 | `4a84ed7aed90902c05070a1ae9701833` | 14 | 1 |
| 化解夹击 | `8a518ff40ae52edbab716f326b2b3f96` | 13 | 1 |
| 独子脱困 | `41905710af0cb1a0ea74518ab6f4d3f7` | 16 | 1 |

难度为第一版引擎估计：合法候选数 ≤6 为 EASY，7–12 为 NORMAL，≥13 为 COMPLEX，基于保存的评分配置版本 1、深度 2、方法版本 1 可复算。当前三题均属于 COMPLEX，其他难度筛选返回准确的空结果；旧题保留 UNCALIBRATED。该标记没有宣称经过玩家实测。训练评分固定 10000ms 预算，与对弈 AI 预算独立。首次真实 MySQL 精选列表校验 1.334 秒，双服务并发加载 2.355 秒；前端列表预算 30 秒。

按用户与题目从真实 attempt 聚合最近结果、实际答题次数和任意一次正确完成。两用户共享精选题且进度隔离；重复请求不重复写入，重复正确不增加已完成题数，之后答错仍保留完成但显示最近 SUBOPTIMAL。个人页 training 为去重正确题数，trainingAttempts 为实际尝试数，正确率为 correct/trainingAttempts。

筛选覆盖 source、category、difficulty、completed、source_game_id，先过滤后分页，同一条件 total 一致，固定排序。REVIEW 只允许本人非 REMOTE 棋局，公开精选题未放开 REMOTE 通用接口。最终答题与生成事务先锁定并验证活跃账号，再复验私有题/棋局归属；真实账号合并在评分期间退休原账号时返回 AUTH_INVALID 且不写 attempt。

前端实际 picker 控件调用筛选 API，切换清空旧页并隔离过时列表及分页响应；答题同步列表进度。未完成筛选中正确题移除后使用缩小后的 items.length 作为后页 offset，21 题用例验证不漏第 21 题。下一题跳过已完成题、加载后续页并可回绕前方未完成题；无其他题回列表明确提示，加载期间重复操作受保护。网络重试保持同一 clientAttemptId。

## 数据与迁移

仅使用父任务创建的专用 mysqld，连接 `127.0.0.1:34365`，server UUID `79904ab3-c0d6-11f1-b2bb-088fc3774c8f` 与 `results/staged-mysql-20261006/auto.cnf` 一致。持久化测试使用 `staged_features_test`，每个测试按已有 fixture 依赖顺序清理记录；没有使用业务数据库或配置密钥。

最后迁移从新建空库 `phase3_20261006_014723_970297_test` 自动 upgrade head，建库 collation 为 utf8mb4_unicode_ci，所有字符串外键 collation 一致。先通过真实对局与 Engine 复盘生成旧 REVIEW，降级到 0015 并重新升级，逐列确认来源、原走法、答案评分与配置均保留；随后精选题可独立写入且 source_game_id 为空。存在精选题时明确拒绝有损降级，head 与全部旧/新题保留，不默默删除题目或答题记录。未执行 DROP DATABASE/SCHEMA。

## 最终验证证据

- `results/staged-phase3-backend-final-full.log`：234 passed，无 skip，真实 MySQL 持久化、合并退休竞态和新空库迁移均执行。
- `results/staged-phase3-frontend-final-full.log`：478 passed，无 skip，包含页面控件/路由、筛选代次、分页进度、下一题与旧功能回归。
- `results/staged-phase3-typecheck-final.log`：TypeScript 通过。
- `results/staged-phase3-check-final.log`：11 页面、18 组件，JSON/WXML/events/assets/routes 通过；picker 纳入微信原生控件白名单。
- `results/staged-phase3-mysql-green.log`：真实题库逐候选评分、并发加载、私有来源筛选的定向证据。
- `results/staged-phase3-migration-db-final.log` 与 `migration-url.txt`：专用实例身份、新空库与迁移目标。

早期 `results/staged-phase3-backend-full.log` 受到实现者并发启动第二个 MySQL 测试进程的 cleanup 干扰，作废。最终全量只运行一个后端测试进程，通过结果替代该中间轮。既有 Starlette/Alembic/Node 模块声明提醒保留，不影响验证结果。
