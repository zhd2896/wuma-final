# 阶段三实现计划与证据

设计依据：`docs/superpowers/specs/2026-10-06-training-catalog-progress-design.md`。

1. 先新增真实 Engine 的题库、答案隐藏、双用户进度与筛选验收测试，确认缺少题库时失败。
2. 扩展统一模型与 0016 迁移；旧 REVIEW 外键数据保留，CURATED 无伪造棋局。精选题固定版本、稳定 ID、独立深度二评分配置，以合法候选数产生明确的引擎估计难度。
3. 列表先筛选再分页；公开精选题、私有复盘题；实际答题聚合最近结果、次数、去重完成数；最终答题事务复验账号与题目归属。
4. 前端真实筛选、切换代次、答题进度与跨页下一题；复盘入口限定棋局，首页明确精选题。保留重试请求号。
5. 专用 MySQL 实测并跑后端/前端全量回归；新建空库验证自动迁移和旧数据升级、无精选数据时降级再升级；有精选数据则明确拒绝降级，要求备份处理。

验收：新账号能读答三个有区分度的合法残局；读取无答案；两个账号进度隔离；重复请求幂等、重复正确不累加完成；筛选总数分页一致；旧权限与评分配置不漂移；前端过时响应隔离和下一题可见结束提示。

红绿证据：`results/staged-phase3-backend-red.log` 首次新账号精选总数为 0；`backend-green.log` 真实引擎题库、逐候选评分与双用户进度通过。`frontend-red.log` 捕获缺失筛选方法及完成进度；`frontend-green.log` 控制器与页面交互通过。`review-progress-red.log` 捕获重新生成题目时进度错误为 false；`review-progress-green.log` 修复后通过。

最终验证：`results/staged-phase3-backend-final-full.log` 234 passed，无跳过；`frontend-final-full.log` 478 passed，无跳过；`typecheck-final.log` 与 `check-final.log` 通过，检查 11 个页面与 18 个组件。专用业务测试库只有一个后端测试进程运行，迁移使用每次新建的唯一空库。早期 `backend-full.log` 曾因实现者误启动第二个 MySQL 测试进程触发清理竞态，已作废；最后独占顺序全量替代该证据。
