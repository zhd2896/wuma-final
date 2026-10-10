# 五马棋项目用户体验审查

日期：2026-10-09。

范围：首页、登录与游客路径、规则与实操、电脑试玩、正式对局、联机、局面分析、教练、复盘、训练、历史与个人成长；并核对影响这些路径的存储、接口和服务端行为。

方法：代码与页面模板走查，关键行为交叉核对。未进行真机触控、实时页面视觉、两台设备联机或真人可用性测试。以下行为问题有代码依据；信息拥挤与触控风险需要实机验证。本次没有修改业务代码。

## 总体判断

已有功能较完整：免登录教学和离线电脑试玩、进度恢复、登录后保存原棋谱、对局记录、真实回放、关键失误、训练筛选、个性化任务和样本门槛均已存在。局面分析也已增加用户能理解的结论、依据、推荐用途和棋盘路线预览。

主要不足是不同页面之间的使用语义和状态不一致：用户学完操作未必知道胜负目标，保存试玩后身份发生变化，离开联机房间不代表结束对局，查看推荐路线再切换回放不一定仍在同一手。应先修复这些理解与操作问题，再简化信息和视觉表现。

优先级：P1 为会误导操作、造成进度损失或妨碍理解棋局的问题；P2 为流程效率、学习效果和可读性改进。优先级不表示安全漏洞。

## P1：优先改善

### 1. 教学没有实操胜负目标

- 现状：三关只有走棋、夹吃、挑吃，并且只接受指定路线。全方无合法走法判负已经写在规则页，但从教学进入试玩可以绕过该说明。
- 影响：新手把目标理解为一直吃子，无法理解棋子还在却输棋、孤棋进庙后怎样收网。
- 改进：增加一个短围堵关和一题独立练习；展示对手全部逃路、封锁前后的合法走法。备用棋不足、部分棋子受堵但仍能继续的情况也应有可操作示例。
- 验收：教学结束前，用户亲手完成一次围堵；能区分“部分棋子无路”与“全方无路”。
- 依据：[教学关卡](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/guide/tutorial-controller.ts:13)、[指定路线](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/guide/tutorial-controller.ts:67)、[已有胜负说明](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/guide/pages/rules/rules.wxml:20)。

### 2. “学习”入口实际上是当前棋局教练

- 现状：底部“学习”进入需要登录、依赖活动 AI 棋局的教练页。没有棋局时已有开始 AI 和历史按钮，但没有公开教学入口。
- 影响：想先学规则的人先被带去登录，登录后还可能面对“没有可指导的棋局”。
- 改进：学习入口聚合规则、实操、训练和当前棋局教练；公开内容直接可用。小幅调整可先将导航改为“教练”，并补充空态教学入口。
- 验收：首次游客点学习可直接进入公开教学；需要账号的具体操作才触发登录。
- 依据：[导航](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/components/bottom-nav/bottom-nav.wxml:1)、[登录拦截](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/utils/navigation.ts:4)、[教练空态](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/coach/coach.wxml:6)。

### 3. 重开行为缺少保护，试玩会覆盖唯一草稿

- 现状：试玩重开直接写入同一个草稿键，未保存的旧局没有归档；试玩认输也立即执行。正式对局重开直接切换新局，但旧局仍在历史中，并非删除。
- 影响：误触试玩重开会丢失旧草稿；正式对局误触后用户不知道旧局在哪里。
- 改进：有进度的试玩提供“继续当前局／保存／重开”，认输确认；正式对局说明“保留当前局并新开，旧局可从历史继续”。零手新局和已结束后的“再来一局”无需重复确认。
- 验收：取消重开后局面不变；确认后明确旧局是否可恢复以及入口。
- 依据：[试玩草稿与重开](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/guide/pages/trial/trial.ts:11)、[试玩认输](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/guide/pages/trial/trial.ts:60)、[正式重开](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/game/game.ts:280)。

### 4. 保存电脑试玩后变成双人局语义

- 现状：试玩页已有“保存后本次试玩结束”说明，但保存为 LOCAL 棋谱；历史显示本地双人或云端双人，进行中记录提供继续对弈，续局进入双人模式。
- 影响：原来与电脑下棋的用户无法从记录名称识别来源，继续后电脑不再接手。
- 改进：保存并保留“电脑试玩”来源。若产品定位为归档，按钮明确“保存试玩棋谱”，历史主操作为查看棋谱，并提供“新开正式入门 AI”；若允许续局，必须明示续局模式。
- 验收：登录保存前后来源名称一致；任何继续入口都与实际对手类型一致。
- 依据：[保存类型](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/guide/pages/trial/trial.ts:92)、[已有归档说明](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/guide/pages/trial/trial.wxml:11)、[历史命名](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/history/history.ts:45)、[续局跳转](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/history/history.ts:196)。

### 5. 联机刷新不显示对手上一手与吃子

- 现状：收到新版本时清空 lastMove 与 lastCapture；房间查询响应没有最近走法及吃子结果。
- 影响：对手吃子后棋盘突然变化，新手不知道哪枚棋移动、为什么棋子消失或换色。
- 改进：房间接口返回最近实际棋步及吃子结果；客户端保留起终点、吃子标记与简短说明。跨多个版本恢复时需说明已跳过若干手，不能把最终差异伪装成一手。
- 验收：两台设备上，对手普通走棋、夹吃、挑吃均能看到对应过程；断线恢复不误显示步骤。
- 依据：[刷新清除提示](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/online/online-game.ts:164)、[房间响应](E:/C盘Doucment/ChatGPT/wuma最终版/backend/app/schemas/remote.py:61)。

### 6. 联机离开与退出的含义不清楚

- 现状：返回大厅只清本机活动标记和内存状态，没有服务端退局行为。席位凭据仍保留，可以从历史恢复；对手的进行中棋局继续存在。
- 影响：用户以为已经退出，对手却一直等待；自动恢复入口也消失。
- 改进：区分“暂时离开，可继续”和“认输并退出”。暂时离开保留活动入口；等待中的房间明确取消。对手在线或离线提示需要真正的 presence 支持后再展示。
- 验收：不同操作对应不同服务端状态；暂离后回首页有继续入口；认输退出对手得到明确结果。
- 依据：[大厅按钮](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/online/online.wxml:36)、[leave 实现](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/online/online-game.ts:190)、[服务端过期规则](E:/C盘Doucment/ChatGPT/wuma最终版/backend/app/services/remote_service.py:61)。

### 7. 联机断网与等待对手容易混淆

- 现状：刷新失败保留旧棋盘和主要回合提示，错误在页面下方；部分辅助操作的可用性没有检查同步失败状态。
- 影响：用户看到等待对手，实际可能只是自己的设备没有收到更新。
- 改进：棋盘上方显示连接状态和最后成功同步时间。未确认的新局面只供查看，完成同步后再开放依赖当前版本的操作。保留已有请求编号、版本检查与原请求恢复。
- 验收：模拟断网、超时、后台回前台时，旧局面和待确认操作有清楚提示；恢复后状态与服务端一致。
- 依据：[刷新异常](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/online/online-game.ts:168)、[主要状态](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/online/online.ts:90)、[错误位置](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/online/online.wxml:38)。

### 8. 悔棋与认输确认没有按模式说明实际后果

- 现状：正式对局统一说撤销最近一手；AI 实际可能撤销人类一步及 AI 回应共两手。认输统一说当前行棋方，但 AI 模式服务端判人类认输。
- 影响：确认文字与实际结果不一致。
- 改进：AI 文案为“撤销你最近一步及 AI 随后的回应”，可计算时预告真实手数；AI 认输直接说“你将认输”。同机双人说明认输的是黑方或红方。
- 验收：AI 思考前后、不同人类执子方和双人模式，确认对象与撤销范围都准确。
- 依据：[确认文案](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/game/game.wxml:76)、[AI 悔棋](E:/C盘Doucment/ChatGPT/wuma最终版/backend/app/services/game_store.py:559)、[AI 认输](E:/C盘Doucment/ChatGPT/wuma最终版/backend/app/services/game_store.py:601)。

### 9. “同步棋谱”没有提前说明它会迁移进行中的对局

- 现状：点击后立即进入 pending 并冻结本机记录，由云端继续；说明主要在同步中或结果待确认时出现。
- 影响：用户以为只是备份，不预期自己的本机棋局不能再修改。
- 改进：进行中记录使用“转到云端继续”等明确名称，操作前说明账号、迁移后续局方式和原记录状态；已结束棋谱可以保留简洁的保存动作。待确认记录保持冻结，提供安全重试。
- 验收：用户点击前知道这是备份还是迁移；响应丢失时不会重复创建或破坏原棋谱。
- 依据：[同步入口](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/history/history.ts:159)、[冻结规则](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/services/device-history.ts:223)。

## P2：提升流程与学习体验

### 10. 首页不能直接继续已有进度

- 现状：首页只读固定功能和登录状态；已有教学检查点、试玩草稿、活动棋局未在首页呈现。登录后免登录试玩的主要按钮隐藏。
- 改进：首次进入主操作为新手实操；回访主操作为继续最近对局或教学，注明模式、手数、难度。保留登录用户试玩入口。统一模式名称为与电脑、同机双人、邀请朋友，云端存储状态单独说明。
- 验收：退出并返回后，一次点击能回到最近有效进度；新开与继续清楚区分。
- 依据：[首页状态](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/index/index.ts:6)、[试玩按钮条件](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/index/index.wxml:11)、[已有恢复](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/guide/pages/trial/trial.ts:24)。

### 11. 复盘切换没有保持同一手

- 现状：推荐路线更新 selectedTurn，但不更新 replayIndex；切回实际回放使用旧 replayIndex。
- 改进：切换时定位到选中手的实际走后局面，提供该手的走前、实际走后和推荐路线对照，并明确推荐路线是否只是预览。
- 验收：查看第 40 手推荐后切回实际，仍然是第 40 手附近；上一手、下一手承接当前选择。
- 依据：[实际回放入口](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/review/review.ts:159)、[路线选择](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/review/review.ts:165)。

### 12. 训练答案缺少棋盘上的推荐路线对照

- 现状：答后已有原因、推荐文字和再试，但棋盘继续表现提交路线，不能切换显示推荐路线。
- 改进：复用已存在的分析路线预览能力，增加“我的路线／推荐路线”对照；解题要点的简短结论直接展示，详细评分折叠。下一题承接本题主题或复盘问题。
- 验收：用户不用把 P 点编号重新映射到棋盘，也能看出两条路线差别；预览不改动题目原状态。
- 依据：[提交后棋盘](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/training/training.ts:57)、[答案区域](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/training/training.wxml:34)。

### 13. 历史页先显示空，再读取云端；部分失败缺少重试

- 现状：本机无记录时先进入 empty，随后加载云端；本机已有记录但云端失败时只出现提示文本。
- 改进：分别呈现本机加载、云端加载和云端失败；首次读取完成前不宣布最终为空。保留已加载列表，提供就地重试云端和用户可见的记录筛选。
- 验收：慢网下不短暂宣称没有记录；云端失败不影响查看本机记录，也能就地恢复。
- 依据：[加载顺序](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/history/history.ts:87)、[空态计算](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/history/history.ts:104)、[部分失败](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/history/history.ts:149)。

### 14. 匹配与邀请的等待状态没有区分

- 现状：公私房间一律提示等待另一台设备、30 分钟有效；已有 public、expires_at 未充分用于提示。
- 改进：匹配显示“正在寻找对手”，邀请显示“等待朋友加入”；按真实过期时间倒计时。关闭后就地重新匹配或建房；不要编造在线人数或预计匹配时间。
- 验收：用户知道自己是否需要发邀请码，旧房间剩余时间准确，失败后不用回首页重走路径。
- 依据：[等待与关闭提示](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/online/online.wxml:14)、[房间字段](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/services/online-api.ts:30)。

### 15. 实现术语和多重筛选占用主流程注意力

- 现状：教练直接展示 gameId、版本、A/B；训练列表展示校准账户数和多重筛选；成长页面出现“请升级服务”这种用户无法执行的动作。
- 改进：主界面回答轮到谁、该做什么、为什么；自己与对手优先用“你／电脑／朋友”，同机双人用黑方／红方。编号、版本、校准方法放详情。默认训练推荐一题，筛选按需展开；服务异常提供重试或基础练习。
- 验收：首次进入时不需要理解版本、校准和 A/B 才能完成核心操作；仍可在详情查阅真实依据。
- 依据：[教练元信息](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/coach/coach.wxml:14)、[训练筛选与说明](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/training/training.wxml:6)、[成长异常](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/profile/profile.wxml:22)。

### 16. 成长图只展示答对，没有体现练习尝试

- 现状：后端已有 attempted，图高只按 completed。尝试多题但全错时，会出现有活动却全零的图。样本不足已有计数说明，但能力指标缺少直接行动入口。
- 改进：同时展示“尝试 X 题／解出 Y 题”，鼓励继续未解题；按各项真实资格给下一步动作。跨时段趋势不能通过现在答题补过去缺口，应说明继续积累新的观察周期。
- 验收：全错但有尝试的用户能看到练习投入；样本进度不暗示训练数量就能保证棋力提高。
- 依据：[完成口径与图高](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/profile/growth-presentation.ts:17)、[活动口径](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/profile/growth-presentation.ts:25)、[样本说明](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/pages/profile/profile.wxml:43)。

### 17. 棋盘空点触控与辅助字样需要真机优化

- 现状：空点命中区 47rpx，棋子区域 55rpx，“可走”等标记 17rpx。375px 宽设备上 47rpx 约为 23.5px；这是代码尺寸风险，尚未测量实际误触率。
- 改进：扩充透明命中区域或按距离选择最近合法交点；避免相邻区域重叠造成误选。增加可选简洁高对比棋盘、大字提示和节点语义标签。
- 验收：小屏、大字体、单手操作测试中能稳定选择合法点；装饰、编号与路线不遮挡棋子和点击区域。
- 依据：[命中尺寸](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/components/chess-board/chess-board.wxss:19)、[棋子尺寸](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/components/chess-board/chess-board.wxss:30)、[辅助字体](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/components/chess-board/chess-board.wxss:45)。

## 面向真实用户发布的前提

当前代码的体验版、正式版 API 地址为空，开发地址为本机回环地址。这是明确的配置状态，不表示已部署服务宕机。云端登录、正式 AI、联机、成长等路径需要配置可由用户设备访问的 HTTPS 服务和微信合法域名，再做真机验收。公开离线教学与试玩不依赖这些接口。

依据：[API 地址](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/config/api-roots.ts:2)、[构建环境选择](E:/C盘Doucment/ChatGPT/wuma最终版/miniprogram/config/api.ts:7)。

## 建议实施顺序

1. 先保证操作含义准确：试玩草稿保护，试玩归档身份，悔棋与认输文字，同步迁移说明，联机暂离与退局。
2. 再保证棋局看得懂：联机上一手与吃子、连接状态、围堵胜负实操；这部分需要接口与页面共同改动。
3. 接通完整流程：首页继续入口与学习入口，复盘同手对照，训练推荐路线。
4. 最后简化主界面并做真机验证：隐藏实现术语，完善历史加载与成长激励，优化触控和等待状态。

建议观察首次用户完成“教学→试玩→保存”的比例、回访恢复对局成功率、联机断线恢复成功率、复盘后进入并完成针对训练的比例。当前没有这类实测数据，不能据此声称某项改动已提高留存。
