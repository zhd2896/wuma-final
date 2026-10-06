# 阶段7联机学习实现计划

1. 先增加真实联机分析、自己的复盘解释与训练API失败测试，覆盖账号、席位、版本、终局和拒绝状态。
2. 通过受控内部入口复用原分析/解释/训练服务；最终事务校验席位token、绑定账号及版本，独立保存私有训练owner。
3. 前端增加明确online source、恢复席位、生命周期隔离，实际game和review页联机学习入口。
4. 增加内存与真实MySQL隔离、轮换/合并及迟到请求测试，保持普通接口REMOTE拒绝与旧LOCAL/AI行为。
5. 保存实际红绿日志，运行完整前后端、typecheck/check及diff检查，写中文验收，交给父代理SPEC/QUALITY审查。

## 执行记录

全部步骤完成。原模型缺少训练题owner，按实测schema增加0018迁移；真实MySQL迁移降级与锁次序红回归推动修正。SPEC复现的private get/legal/list/count合并迟到读取漏洞已通过最终账号/owner校验修复。

最终后端355 passed、前端514 passed，无失败或跳过；typecheck/check通过，页面检查11页18组件。SPEC与QUALITY独立复审均PASS。详细范围、红绿日志、唯一专用MySQL实例/新空迁移库和未执行真机验收见 `results/staged-phase7-acceptance.md`。提交与后续阶段交由父代理。
