# 弈智五马：启动与开发手册

微信原生小程序（TypeScript）+ FastAPI + MySQL 的五马棋项目。棋规和 AI 搜索位于 `miniprogram/domain/`、`miniprogram/ai/`；后端通过 Node worker 调用同一引擎，并将联网棋局、复盘、教练提示和训练记录保存到 MySQL。

本项目的提交内容见 [更新记录](CHANGELOG.md)。完整的 FastAPI、Node Worker、MySQL 与 Nginx 容器部署步骤见 [Docker 部署手册](docs/deployment.md)；本手册继续说明本机开发流程。

> 根目录没有 `start`/`dev` 脚本：前端在**微信开发者工具**中编译运行，API 用 **Uvicorn** 启动。本手册以当前仓库代码为准。

## 功能与依赖

| 入口 | 需要后端和 MySQL | 当前行为 |
| --- | --- | --- |
| 首页、教学、离线电脑试玩 | 否 | 首次进入公开首页，可完成三关实操教学或与随机合法走子的电脑试玩；临时棋谱只存在本机，保存个人棋谱、联机和正式 AI 对局时再登录。 |
| 本地双人对弈及历史 | 首次微信登录需要；有效会话下本地对局可离线 | 本地双人模式使用真实棋规；棋局和走棋状态保存在本机，可从历史记录继续。 |
| AI 对弈、远程双人 | 是 | AI 棋局关联微信账号，支持入门、标准、进阶三档搜索预算；远程双人支持私人房间和公开匹配，两台设备各执一方。 |
| AI 对弈中的局面分析、分级教练提示 | 是 | 引擎计算分析；教练文字可选用 LLM，未配置时使用确定性文案。 |
| 精选训练题 | 是 | 15 道题，新增吃子、防守、孤棋三个主题各 2 道入门与 2 道进阶题；支持主题、难度与进度组合筛选。显示教学目标和答题后解题要点；首次答题满 20 个不同账号后显示试玩难度建议，真人试玩尚待执行。见 [题库与试玩说明](docs/training-content-playtest.md)。 |
| 已结束棋局的复盘、复盘解说、训练题 | 是 | 复盘可按保存棋谱前后/首尾/滑块回放，并保留走前路线对照；云端 LOCAL 可选 A/B 视角，AI 固定人类方、联机固定本人席位。复盘解释和生成训练对应当前视角，训练列表按来源棋局及玩家过滤。联机私有题绑定账号且仅本人可见，首次生成复盘可能较慢。 |
| 历史记录 | 有效会话下浏览本机记录可离线；云端历史、继续云端棋局和复盘需要 | 展示本机记录及当前微信账号的云端棋局；再次微信登录可读取同账号云端记录。新本地棋局保存完整棋谱，可在历史页显式“同步棋谱”到当前账号；待确认记录冻结并按原账号/服务重试，成功后从云端续局或复盘。旧快照缺少完整棋谱无法同步；两设备真实验收仍待完成。 |
| 独立的局面分析、AI 教练、我的棋力页面 | 云端与联机局面分析、AI 教练和我的棋力需要；本地局面分析不需要 | 独立局面分析读取真实本地存档、云端或联机房间的权威版本，显示真实双方备用棋；本地断网仍可分析。AI 教练绑定当前 AI 棋局并按权威版本逐级请求真实提示；我的棋力按 `player_skill_v1` 展示真实六项指标、完整样本门槛和动态等级，单项样本不足显示“数据不足”。 |

## 环境准备

个人页支持主动修改昵称和选择版本化士/馬/炮头像，保存在当前账号中，重登与换设备可读取；微信登录不会读取微信昵称头像或覆盖自定义资料。数据库需迁移至 `0019_user_profiles`。发布尚未进行，开发地址保持本机，体验版/正式版地址仍空；`npm run check:release -- trial` / `release` 的配置失败是待部署提示，不是业务测试失败。配置格式检查不证明微信后台配置、HTTPS 服务在线或真机验收已完成。

- Node.js **24+**、npm（后端 Node worker 需要 Node 24 的 TypeScript 运行能力）。
- Python **3.12+**、MySQL **8**（随仓库提供的 Compose 文件使用 MySQL 8.4）。
- 微信开发者工具；可选装 Docker Desktop 和 Docker Compose 来启动开发数据库。
- 以下命令在**仓库根目录**执行，示例终端为 Windows PowerShell。macOS/Linux 把虚拟环境的 Python 路径换为 `backend/.venv/bin/python`，环境变量改用 `export NAME=value`。

```powershell
node --version
npm --version
python --version
docker compose version # 仅 Docker 方案需要
```

## 本地完整启动（PowerShell）

### 1. 安装依赖

```powershell
npm ci
python -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
```

`npm ci` 按 `package-lock.json` 安装开发依赖。小程序由微信开发者工具编译，无须运行 `npm start`。

### 2. 启动 MySQL

**Docker 方案**：在同一个 PowerShell 窗口设置本地开发密码并启动容器；请替换示例密码。

```powershell
$env:DB_PASSWORD = 'replace-with-local-password'
$env:DB_ROOT_PASSWORD = 'replace-with-local-root-password'
docker compose -f backend/docker-compose.mysql.yml up -d
docker compose -f backend/docker-compose.mysql.yml ps
```

Compose 创建数据库 `wuma` 和同名用户，并映射到本机 `3306` 端口。首次启动要等 MySQL 就绪再执行迁移。若本机已有 MySQL 8，可跳过 Docker，提前创建数据库 `wuma` 和有权访问该库的用户，并设置下面的连接变量。

| 变量 | 默认值 / 用途 |
| --- | --- |
| `DB_HOST` | `127.0.0.1` |
| `DB_PORT` | `3306` |
| `DB_USER` | `wuma` |
| `DB_PASSWORD` | 无默认密码；Docker 方案须与创建容器时的密码一致。 |
| `DB_NAME` | `wuma` |
| `DATABASE_URL` | 可选的完整 `mysql+pymysql://...` 连接串；**设置后覆盖上述 `DB_*` 变量**。 |

配置样例在 `backend/.env.example`。后端**不会自动读取** `.env` 文件；请在迁移与启动后端的终端中设置环境变量，或通过自己的进程管理器注入。PowerShell 的 `$env:` 变量只在当前终端会话及其子进程中有效。不要把密码提交到仓库。

### 3. 迁移数据库并启动 API

继续使用设置了 `DB_PASSWORD` 的终端：

```powershell
.\backend\.venv\Scripts\python.exe -m alembic -c backend/alembic.ini upgrade head
if ($LASTEXITCODE -ne 0) { throw '数据库迁移失败，请先处理错误；不要继续启动后端' }
.\backend\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

Uvicorn 命令会持续运行，保留此终端。若改用已有 MySQL，先在此终端设置匹配的 `DB_HOST`、`DB_PORT`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`；若设置了 `DATABASE_URL`，请确认它指向**开发库**。当前迁移唯一最终版本为 `0019_user_profiles`。历史合并节点 `0014_merge_auth_operations` 保留对局操作与微信会话两条分支，后续迁移依次增加联机账号归属、训练题源、本地棋谱同步、私有训练归属和个人资料；已有库执行 `upgrade head` 补齐迁移，不重建已有会话或棋局。2026-10-05 本机业务库恢复和数据保留验证见 [兼容修复记录](docs/database-migration-compatibility-repair-2026-10-05.md)。

在另一 PowerShell 窗口确认引擎和数据库都可用：

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod -Method Post http://127.0.0.1:8000/api/v1/game `
  -ContentType 'application/json' `
  -Body '{"first_player":"A","mode":"LOCAL"}'
```

`/health` 只检查 Node 引擎；第二条命令实际创建棋局，可同时检查 MySQL 写入。交互式接口文档：<http://127.0.0.1:8000/docs>。

### 4. 在微信开发者工具中运行

1. 导入**仓库根目录**，即含 `project.config.json` 的目录；其中已指定 `miniprogramRoot: "miniprogram/"` 和 TypeScript 编译插件。
2. 在开发者工具中使用可用的测试/自有 AppID。仓库配置带有现成 AppID；无使用权限时，在工具内切换自己的 AppID。
3. 确认开发环境的 API 地址为 `miniprogram/config/api-roots.ts` 中的 `http://127.0.0.1:8000`，然后点击“编译”。本地调试若遇请求域名校验，检查开发者工具的“不校验合法域名”设置；仓库项目配置的 `urlCheck` 为 `false`。
4. 从首页进入“AI 对弈”或“远程双人”检查接口链路；“双人对战”可只用前端运行。远程双人可创建私人房间并分享 8 位房间码，另一台设备加入后各执一方；也可使用“匹配对手”。联机终局可从历史进入本人复盘、时间轴回放与私有训练；AI 终局同样可进入真实复盘。

`127.0.0.1` 只适用于**运行后端的同一台电脑上的开发者工具模拟器**。真机、体验版和正式版的微信登录及云端功能需要可访问的 HTTPS API、微信小程序后台的合法 request 域名配置，并修改 `miniprogram/config/api-roots.ts` 中相应地址。`trial` 使用 `test` 地址，`release` 使用 `production` 地址；两者当前都是空字符串。空或非法配置仍可体验公开首页、教学和离线电脑试玩；进入云端功能或微信登录时显示“服务暂未开放，请稍后再试”，不发登录或业务请求。发布检查与公开地址构建命令见 [微信发布指南](docs/wechat-release-guide.md)。若后端和模拟器不在同一台电脑，也要把 `development` 地址改成模拟器可访问的地址。

远程双人席位绑定微信账号；同账号在另一设备重新登录可恢复本人席位与云端历史。仅有房间码不能认领他人席位。REMOTE 以房间 host/guest 记录参与者，普通 Game.user_id 允许为空。两台真机验收前必须先配置两台设备都可访问的 HTTPS API，并将测试后端连接到已迁移的独立 `*_test` MySQL 库；本机 `127.0.0.1` 地址无法完成真机联机验收。阶段结果见 [远程双人验收记录](docs/remote-multiplayer-acceptance.md)。

## 可选的 LLM 解说与教练提示

不配置 LLM 也能运行棋局、复盘与训练；复盘解说和教练提示会使用后端的确定性回退文案。要接入兼容 OpenAI Chat Completions 的服务，在**后端进程启动前**设置：

```powershell
$env:LLM_API_KEY = 'your-key'
$env:LLM_BASE_URL = 'https://your-provider.example/v1'
$env:LLM_MODEL = 'your-model'
```

后端会在 `LLM_BASE_URL` 后追加 `/chat/completions`。可选变量 `LLM_PROVIDER`、`LLM_TIMEOUT_SECONDS`、`LLM_TOTAL_TIMEOUT_SECONDS`、`LLM_TEMPERATURE` 的示例见 `backend/.env.example`。密钥只放在后端环境中。请求失败、超时或结果校验失败时仍会回退到确定性文案。

## 检查与测试

在仓库根目录运行：

```powershell
npm run typecheck
npm run check
npm test
.\backend\.venv\Scripts\python.exe -m pytest backend/tests -q
```

后端测试中的真实 MySQL 用例只有设置 `WUMA_TEST_DATABASE_URL` 后才运行。该 URL 必须指向**已迁移、名称以 `_test` 结尾的独立 MySQL 库**；不设置时这些用例会跳过。不要把开发库或生产库当作测试库。

微信开发者工具自动化 E2E 需开启工具的自动化接口。`npm run test:e2e:history` 只验证本地双人历史，并在结束时恢复原本机历史存储；设置 `WUMA_WECHAT_AUTO_ENDPOINT`（默认 `ws://127.0.0.1:9420`）后即可运行。其他 E2E 还需启动后端并连接隔离测试库：设置 `WUMA_TEST_DATABASE_URL`，必要时设置 `WUMA_PYTHON`，再按需运行 `npm run test:e2e:wechat`、`npm run test:e2e:review`、`npm run test:e2e:llm-review`、`npm run test:e2e:coach` 或 `npm run test:e2e:training`。这些脚本会创建并检查真实棋局数据，不适合连接日常开发库。

历史页到复盘页的隔离验收使用 `npm run test:e2e:history-review`。先将 `WUMA_TEST_DATABASE_URL` 指向已迁移的独立 `*_test` MySQL 库、让小程序所用后端连接同一库，并设置 `WUMA_HISTORY_E2E_GAME_ID` 为该库中一局已经结束的服务器 `LOCAL` 棋局 ID。脚本先比较测试库与后端返回的棋局状态，再从历史页导入并打开真实复盘；结束时恢复原本机历史与活动棋局 ID。未提供这些变量时脚本不会创建棋局或修改本机存储。

首页复盘卡片的无可复盘棋局状态可运行 `npm run test:e2e:home-review`：脚本在微信开发者工具中完成一局真实本地双人对局，确认它保留在普通历史、但不会误入只显示 AI/服务器终局的复盘列表，随后恢复本机存储。`test:e2e:history-review` 还会从首页实际点击复盘卡片，再验证服务器终局的复盘链路。

搜索与自对弈基准的命令和数据口径见 [Benchmark 指南](docs/phase25-benchmark.md)；最近性能优化验收见 [PHASE 26 报告](docs/phase26-performance.md)。

## 常见问题与停止服务

| 现象 | 检查方法 |
| --- | --- |
| `docker` 命令不存在或 3306 端口被占用 | 安装/启动 Docker Desktop，或改用已有 MySQL；若已有服务占用 3306，调整 Compose 端口映射并同步设置 `DB_PORT`。 |
| 迁移报连接失败、访问被拒绝 | 等待 MySQL 就绪；确认当前终端中的 `DB_PASSWORD` 与容器创建时一致；检查是否有旧的 `DATABASE_URL` 覆盖 `DB_*`。已创建的数据卷不会因修改环境变量而重置用户密码。 |
| `/health` 返回 503 或 `ENGINE_UNAVAILABLE` | 检查 `node --version` 是否为 24+，以及 `backend/engine_worker.mjs` 能被后端读取；后端可用 `WUMA_NODE_EXECUTABLE` 指定 Node 可执行文件。 |
| `/health` 正常但创建棋局失败 | 检查 MySQL 连接、数据库迁移和后端日志；健康检查本身不验证数据库。 |
| 小程序请求失败 | 确认 Uvicorn 正在运行，地址与端口和 `miniprogram/config/api.ts` 一致，并检查开发者工具的请求域名设置。真机不能用 `127.0.0.1` 连接电脑上的 API。 |
| 独立复盘页提示缺少棋局，AI 教练提示没有当前棋局，或训练页没有题目 | 训练页可直接选择“精选残局”，按吃子、防守、孤棋练习入门及进阶题；筛选无结果时可清除筛选。个人复盘题需从历史中的**已结束后端棋局**生成复盘后创建。独立局面分析从对局的“分析”入口打开；AI 教练需要先开始或恢复一局轮到玩家落子的 AI 对弈。 |

停止 API：在运行 Uvicorn 的终端按 `Ctrl+C`。停止 Docker 开发数据库：

```powershell
docker compose -f backend/docker-compose.mysql.yml down
```

此命令保留数据库卷，供下次启动继续使用。

## 目录索引

| 目录 / 文件 | 内容 |
| --- | --- |
| `miniprogram/` | 微信小程序页面、棋规、AI、组件与 API 客户端。 |
| `miniprogram/config/api.ts` | 开发、体验、正式环境的 API 地址。 |
| `backend/app/` | FastAPI 路由、服务、MySQL 持久化。 |
| `backend/engine_worker.mjs` | 后端到 TypeScript 棋规/AI 的 Node 桥接进程。 |
| `backend/alembic/` | 数据库迁移。 |
| `backend/.env.example` | 后端环境变量样例；不会自动加载。 |
| `scripts/`、`tests/`、`backend/tests/` | 检查、自动化、基准与测试。 |
| `docs/`、`results/` | 阶段说明与基准实验结果。 |

后端接口、数据存储及复盘说明见 [后端文档](backend/README.md)。


## 对局操作阶段记录（2026-10-04）

**代码完成，尚未满足验收条件。** 本阶段没有整体完成，不能据此进入下一产品阶段。以下为本实现工作树的结果，既有阶段记录保留各自当时的验收状态。

已实现：本地悔棋回退最近一手并保存可恢复快照；AI 悔棋按人类决策回退相应棋步；旧服务器 `LOCAL` 悔棋回退一手；真正联机 `REMOTE` 由对方同意后回退 1 或 2 手，待处理申请阻止落子，拒绝后可继续。认输写入真实 `RESIGN` 胜负，终局不再接受落子。服务端操作使用版本校验、幂等请求和事务；手数使用有效 `ply_count`，与单调递增版本分开。历史/结构化复盘排除撤销棋步，支持零手认输及远程席位鉴权。设置保存可走位置、吃子提示、振动和新 AI 局先手，重进页面保留；先手修改在下一新局生效。

| 2026-10-04 实跑检查 | 结果 |
| --- | --- |
| `npm test` | 421 passed，0 failed，0 skipped（已有 Node 模块类型警告）。 |
| `npm run typecheck`、`npm run check` | 通过；9 个注册页面、18 个组件静态检查。 |
| `python -m pytest backend/tests -q` | 138 passed、32 skipped；跳过项都是未配置独立库的真实 MySQL 用例。 |
| `node --test scripts/game-operations-devtool-e2e.test.cjs`、`node --check scripts/game-operations-devtool-e2e.cjs` | 10 项脚本安全/超时及主流程隔离/清理回归通过，语法检查通过；不是 IDE 端到端证据。 |
| `python -m alembic -c backend/alembic.ini heads` | 唯一 head：`0013_remote_undo_revert_count`。 |
| `python -m alembic -c backend/alembic.ini upgrade head --sql` | 离线 SQL 生成通过，包含 0011→0012→0013；没有对真实数据库执行迁移。 |
| `npm run test:e2e:game-operations` | exit 1：首先被未配置 `WUMA_TEST_DATABASE_URL` 阻止，未操作数据库或小程序存储。 |

本机同时缺少 IDE 自动化和 API 服务：默认 9420、8000 均未监听，`WUMA_WECHAT_AUTO_ENDPOINT` 未配置。本机 3306 虽有监听，默认后端配置的只读连接检查返回 `OperationalError`；没有猜测数据库凭证或操作该库。因此真实 MySQL 32 项、开发者工具端到端、两设备联机均未验收。

### 隔离环境复跑

**2026-10-05 补测更新**：前端 422 项、后端 181 项全量通过，均无失败或跳过；后端已包含此前跳过的 32 项真实 MySQL 测试与全新数据库迁移。真实开发者工具 `test:e2e:game-operations` 主流程 exit 0。真实迁移暴露的字符集不一致及 IDE 脚本连接上下文问题已修复。补充测试验证了 AI 历史/复盘和远程认输/席位复盘，但复盘返回/跳转出现超时，补充脚本整体失败，尚需复核；两台真机及真实断网重试仍未验收。阶段仍为“代码完成，尚未满足验收条件”。详见 [最新测试报告](docs/game-operations-test-report-2026-10-05.md) 和附带日志；上表保留 2026-10-04 当时结果。

微信开发者工具必须打开并编译**包含本阶段提交的项目目录**。2026-10-05 已按用户要求将 `codex/game-operations` 快进合并到 `main`，现在可以使用主项目目录；`.worktrees/game-operations` 仍保留用于后续验收，运行后端前需同步最新的 0014 兼容迁移。后端应从同一代码版本的目录启动。小程序 `miniprogram/config/api.ts` 的开发 API 地址必须与 `WUMA_GAME_OPERATIONS_API` 一致（默认 `http://127.0.0.1:8000`）。

在该工作树的 PowerShell 中，使用现有 Python 环境（`WUMA_PYTHON` 指向可运行后端的解释器），把 `WUMA_TEST_DATABASE_URL` 设置为自己有权限的独立 MySQL `*_test` 库。不要使用开发库或生产库。URL 可含 `charset=utf8mb4` 和连接/读写超时参数，不接受覆盖 database/host 等参数。

```powershell
# 先自行设置 WUMA_PYTHON 与 WUMA_TEST_DATABASE_URL，不把凭证写入仓库
if (-not $env:WUMA_TEST_DATABASE_URL) { throw '需要已授权的独立 MySQL *_test 数据库' }
$env:DATABASE_URL = $env:WUMA_TEST_DATABASE_URL
& $env:WUMA_PYTHON -m alembic -c backend/alembic.ini upgrade head
& $env:WUMA_PYTHON -m pytest backend/tests/test_mysql_persistence.py -q
# 必须 32 项真实通过，不能把 SKIP 当成功；保留本终端运行后端
& $env:WUMA_PYTHON -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

另开终端，在同一工作树启动微信 IDE 自动化：`cli.bat auto --project <本实现工作树绝对路径> --auto-port 9420 --trust-project`。准备一个隔离测试账号及其 `LOCAL` 探针棋局（也可提供已有测试账号/棋局），再运行：

```powershell
# 这些环境变量也须在本终端设置：WUMA_PYTHON、WUMA_TEST_DATABASE_URL
$env:WUMA_WECHAT_AUTO_ENDPOINT = 'ws://127.0.0.1:9420'
$env:WUMA_GAME_OPERATIONS_API = 'http://127.0.0.1:8000'
$probeAccount = Invoke-RestMethod -Method Post -Uri "$env:WUMA_GAME_OPERATIONS_API/api/v1/auth/device"
$env:WUMA_GAME_OPERATIONS_DEVICE_TOKEN = $probeAccount.data.token
$probeHeaders = @{ Authorization = "Bearer $env:WUMA_GAME_OPERATIONS_DEVICE_TOKEN" }
$probeGame = Invoke-RestMethod -Method Post -Uri "$env:WUMA_GAME_OPERATIONS_API/api/v1/game" -Headers $probeHeaders -ContentType 'application/json' -Body '{"mode":"LOCAL","first_player":"A"}'
$env:WUMA_GAME_OPERATIONS_PROBE_GAME_ID = $probeGame.data.game_id
npm run test:e2e:game-operations
```

脚本在写入前只读对比探针在数据库与 API 中的版本和棋盘，避免混用测试库与其他服务。随后在首个页面/后端写入前安装真实 `wx.request` 目的地白名单，仅转发已核验测试 API 的请求给原函数；IDE 编译地址不同会被拦截并返回非零，安装失败也不打开页面。退出时恢复原请求函数。它使用棋盘组件与可见按钮验证本地走一步/悔棋/重进/认输、真实 AI 应手/悔棋/认输、设置开关与重进持久化，以及真实联机页面两席位申请/重连/同意状态。联机部分在同一模拟器切换新测试房间的两个令牌，明确输出 `SIMULATED`，不代表双设备验收。连接和断言失败返回非零，超时会报告操作名称。脚本只删除自身新建的本机历史行/测试席位键，恢复自身改变的活动 ID、测试账号键和设置（页面加载前保存原值及键存在状态，坏设置自动修复后即使加载失败也恢复原值）；不清空用户历史或既有席位/设备凭证。测试库中的探针、AI 局与房间保留供复核。

### 仍需完成的验收门槛

补齐真实 MySQL 32 项（含迁移到 0013）、本工作树 IDE 端到端通过，然后在能访问同一 HTTPS 测试 API 的两台独立设备执行并记录以下六项：

1. A 刚落子申请，B 同意；双方回退 1 手且版本一致。
2. A 落子、B 应手后，A 申请、B 同意；双方回退 2 手。
3. 对方拒绝后，双方继续合法落子。
4. 申请期间退出重进，双方恢复同一待处理申请。
5. A、B 各认输一次；双方终局、历史与复盘一致。
6. 断网后以原请求编号重试，不出现重复落子、重复悔棋或重复终局。

上述门槛没有全部通过前，本阶段保持“代码完成，尚未满足验收条件”。

## 微信登录集成（2026-10-05）

来源分支为 `codex/wechat-login-integration`，已按用户要求合并到本地主分支 main，合并提交 `60e6db8`。当前运行入口为项目主目录。微信按钮登录、服务端身份验证、到期会话、退出登录与旧匿名数据迁移已接入，保留现有棋局操作、点位编号及游客可访问的玩法讲解。

合并后验证：前端 454 项通过，微信认证与配置专项 8 项通过，类型及 11 页/18 组件检查通过。前一轮后端完整 200 项通过，包含 35 项真实隔离 MySQL；三条迁移路径均能升级到唯一 head `0014_merge_auth_operations`。本轮真实微信按钮登录、迁移、会话、对局操作、历史和复盘已通过本机实测；游客讲解开始 AI 的原始自动化跳转及两设备/HTTPS 验收仍未完成。

当前启用步骤、配置建议和验收清单见 [微信登录集成与启用步骤](docs/wechat-login-integration-acceptance-2026-10-05.md)，合并记录见 [main 登录合并记录](docs/wechat-login-main-merge-2026-10-05.md)。重启主目录后端并在微信开发者工具普通编译主目录后加载新代码。本节之前的测试数量、匿名凭证脚本示例及旧迁移阶段属于历史记录。

**阶段判定：已按授权合并 main；完整验收尚未完成，暂不能进入下一阶段。**
