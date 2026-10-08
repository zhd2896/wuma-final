# 弈智五马阿里云部署实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有微信小程序与阿里云 HTTPS 后端、MySQL 和真实微信登录打通，完成体验版、正式版发布及备份恢复验收。

**Architecture:** 初期复用仓库 Compose，在一台 Linux 服务器上运行 Nginx、FastAPI（内含 Node 24 引擎）和 MySQL 8.4。仅 Nginx 暴露 80/443，数据库与 API 保持容器内网。体验环境与正式环境使用不同 Compose 项目、数据库、卷及域名。

**Tech Stack:** 微信原生小程序 TypeScript、Python 3.12、FastAPI、SQLAlchemy、Alembic、Node 24、MySQL 8.4、Docker Compose v2、Nginx。

---

## 1. 适用范围与实际现状

本方案依据当前仓库代码制定；未登录阿里云，未连接服务器，未执行部署。服务器地域、系统、规格、域名和备案状态尚未提供。

本项目前端发布到微信，不需要把小程序页面当成网站部署。后端必须上传完整必要目录，不能只上传 backend：Dockerfile 还会复制 miniprogram/domain、miniprogram/ai 和 deploy/scripts。

现有文件职责：

| 文件 | 职责 |
| --- | --- |
| compose.yml | MySQL、后端与 Nginx 服务编排 |
| backend/Dockerfile | Python 与 Node 运行环境，复制共享棋规和 AI |
| deploy/scripts/backend-entrypoint.sh | 等数据库、迁移、启动单 Uvicorn 进程 |
| .env.example | Compose 环境变量模板 |
| deploy/nginx/conf.d/tls.conf.example | HTTPS、HTTP 跳转、登录限流、反向代理 |
| miniprogram/config/api-roots.ts | develop/trial/release 对应的公开 API 地址 |
| scripts/configure-release.mjs | 写入体验版或正式版 API 地址 |
| scripts/check-release.mjs | 发布配置格式预检 |

当前 test/production 地址为空。当前迁移目标为 0019_user_profiles，执行时仍以 alembic heads 输出为准。部分旧文档仍写 0014 或旧题库数量，不能据此判断当前状态。AI 走棋由现有搜索引擎实现；LLM 仅可选地生成教练/复盘文字，不配置也可使用确定性回退。

## 2. 总体架构与资源

链路：微信小程序 → https://api.你的域名 → ECS 443 → Nginx → backend:8000 → MySQL:3306；FastAPI 通过 Node Worker 调用同一套棋规和搜索代码。

初期建议沿用已购服务器：4 vCPU / 8 GB 内存 / 至少 60 GB SSD 可作为小规模试运行的规划起点；2 vCPU / 4 GB 可以先验证，构建和并发搜索余量更小。这些是资源预算建议，不代表已测吞吐量。核对实际公网带宽、剩余磁盘和是否有固定公网 IP/EIP。无需首期增加 Redis、Kubernetes 或负载均衡。

如已有 RDS，应改为 RDS 内网连接；不能仅设置 DATABASE_URL 就宣称已切换完成，因为当前 compose.yml 仍启动并依赖本地 mysql。需要另做 RDS 编排，移除 mysql 服务依赖，保留迁移及 /ready 检查，验证账号、字符集、网络与备份。

正式和测试最好分服务器。复用一台时使用 /opt/wuma 和 /opt/wuma-staging 两个独立目录、不同项目名和数据库卷；共用一个公网 Nginx 按域名转发，测试栈只把 HTTP 映射到 127.0.0.1:18080。不要让两个 Nginx 同时争用 80/443。需要单独编写双环境入口配置后再启用这种布局。

## 3. 任务一：云资源和微信前置条件

- [ ] 在阿里云控制台记录产品类型（ECS 或轻量应用服务器）、地域、OS、CPU/内存、磁盘、公网 IP、带宽及现有服务。已有业务服务器不得直接重装或覆盖 Docker 配置。
- [ ] 本文 Linux 命令以全新 Ubuntu 24.04 LTS 为执行示例；Alibaba Cloud Linux、Debian、Windows 必须先换对应安装步骤。
- [ ] 准备有管理权限的小程序 AppID，确认项目 AppID 与后端 WECHAT_APP_ID 一致。AppSecret 只在服务器输入，不进入前端或聊天。
- [ ] 准备域名 api.你的域名，A 记录指向服务器固定公网 IPv4；无可用 IPv6 入口时不添加 AAAA。
- [ ] 大陆服务器先核实并完成适用的域名 ICP 备案；同时在微信后台核对小程序备案、类目和主体资格，游戏相关类目按实际审核要求办理。域名备案与小程序备案分开处理。
- [ ] 申请覆盖 API 域名的受信任 TLS 证书，下载 Nginx 格式完整证书链及私钥；记录到期时间。
- [ ] 配置入站规则：443/TCP 公网开放，80/TCP 用于跳转；22/TCP 仅管理者公网 IP/CIDR。3306、8000、2375 不对公网开放。轻量服务器使用其防火墙入口设置同等规则。
- [ ] 检查出站 HTTPS 可达 api.weixin.qq.com、实际镜像仓库和 Python 包源；LLM 启用时另查其供应商出口。

来源：[阿里云安全组](https://www.alibabacloud.com/help/zh/ecs/user-guide/start-using-security-groups)、[阿里云备案与 DNS](https://www.alibabacloud.com/help/en/dns/icp-and-dns)、[微信网络说明](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)。地域免于网站 ICP 要求不能替代微信平台要求。

## 4. 任务二：服务器基础环境

以下在服务器 Bash 执行，使用有 sudo 权限的管理账号。先检查已有服务与端口：

```bash
cat /etc/os-release
uname -m
free -h
df -h
sudo ss -lntp
timedatectl status
docker --version
docker compose version
```

- [ ] 确认系统与空闲端口；80/443 被其他 Nginx 或宝塔占用时，选择接入现有代理或统一迁移入口，先保留旧服务配置。
- [ ] 全新 Ubuntu 按 Docker 官方 apt 仓库安装 Docker Engine 与 Compose 插件，勿把开发用便利脚本作为默认生产安装办法。官方完整步骤：[Docker Ubuntu 安装](https://docs.docker.com/engine/install/ubuntu/)。
- [ ] 安装成功后执行：

```bash
sudo systemctl enable --now docker
sudo docker run --rm hello-world
sudo docker compose version
sudo install -d -m 0750 /opt/wuma
```

后续命令假设管理账号已获得 /opt/wuma 写权限与 Docker 执行权限；否则用 sudo。Docker 用户组具有高权限，仅加入可信部署账号。

- [ ] 设置 Docker 日志轮转：在保留已有 /etc/docker/daemon.json 设置的基础上合并 log-driver=json-file 和 log-opts（max-size=10m、max-file=3）。已有容器需要重新创建才使用新设置；Docker 重启安排维护窗口。
- [ ] 镜像拉取失败时在可信构建机按实际服务器架构构建镜像，推送私有 ACR 或 docker save/load 离线交付。固定镜像标签无法拉取必须先排查标签和访问，不直接全部改成 latest。

## 5. 任务三：交付完整代码与配置

- [ ] 从审核过的版本交付完整仓库源码（去除 .env、密钥、node_modules、虚拟环境、结果文件）。无 Git 远程可用 tar.gz 上传，再在服务器解压到 /opt/wuma。记录提交号或交付包 SHA256。
- [ ] 核对以下文件存在：

```bash
cd /opt/wuma
test -f compose.yml
test -f backend/Dockerfile
test -f deploy/scripts/backend-entrypoint.sh
test -d miniprogram/domain
test -d miniprogram/ai
```

- [ ] 确认 shell 文件是 LF 换行；Windows CRLF 会导致容器入口执行错误。修改只针对部署脚本，不批量重写仓库。
- [ ] 创建私密配置并编辑：

```bash
umask 077
cp .env.example .env
chmod 600 .env
nano .env
```

至少设置如下内容；尖括号字段需替换实际值，不能原样使用：

```dotenv
COMPOSE_PROJECT_NAME=wuma
BACKEND_IMAGE=wuma-backend:release-20261007
WUMA_ENV=production
DATABASE_URL=
DB_NAME=wuma
DB_USER=wuma
DB_PASSWORD=<独立随机应用密码>
DB_ROOT_PASSWORD=<另一独立随机管理员密码>
NGINX_BIND_ADDRESS=0.0.0.0
HTTP_PORT=80
HTTPS_PORT=443
NGINX_CONFIG=./deploy/nginx/conf.d/tls.conf
TLS_CERT_DIR=./deploy/nginx/certs
WECHAT_APP_ID=<实际小程序AppID>
WECHAT_APP_SECRET=<仅服务器保存的AppSecret>
AUTH_SESSION_DAYS=7
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
```

随机密码可用 openssl rand -hex 32 在服务器生成，两次分别生成；十六进制可避开 Compose 插值及 URL 特殊字符问题。不要输出完整 docker compose config 到公开工单，它可能展开密钥。已有数据库卷改 .env 不会自动改数据库用户密码。

## 6. 任务四：HTTPS 配置

- [ ] 创建证书目录并上传实际证书文件：

```bash
cd /opt/wuma
install -d -m 0700 deploy/nginx/certs
cp deploy/nginx/conf.d/tls.conf.example deploy/nginx/conf.d/tls.conf
nano deploy/nginx/conf.d/tls.conf
chmod 600 deploy/nginx/certs/privkey.pem
chmod 644 deploy/nginx/certs/fullchain.pem
```

在两个 server 块中把 server_name _; 改为 server_name api.你的域名;。证书文件名必须为 fullchain.pem 和 privkey.pem，模板容器路径为 /etc/nginx/certs/。供应商下载的文件可以重命名，但不能把缺少中间证书的单张证书充当完整链。

- [ ] 初期直接使用域名根路径，客户端地址为 https://api.你的域名，避免额外 /wuma 前缀。保留模板中的微信登录限流与 120 秒代理读超时。
- [ ] 证书续期采用 DNS 验证或签发平台流程。模板 80 端口全部跳转 HTTPS，未配置 HTTP-01 challenge 文件路由，不能直接假设 Certbot 自动续签已打通。

## 7. 任务五：启动与数据库迁移

- [ ] 首次全新数据库执行：

```bash
cd /opt/wuma
docker compose config --quiet
docker compose pull mysql nginx
docker compose build backend
docker compose up -d --wait --wait-timeout 300
docker compose ps
docker compose exec -T nginx nginx -t
docker compose exec -T backend alembic -c /app/backend/alembic.ini current
docker compose exec -T backend alembic -c /app/backend/alembic.ini heads
```

预期：三个服务运行且健康，Nginx 语法检查成功，current 等于唯一 head。入口脚本自动等待数据库并运行 upgrade head，失败会阻止就绪。已有数据库必须先备份并在测试库验证迁移；不重复初始化或删除卷。

- [ ] 验证服务器本机 HTTPS 和外部访问：

```bash
curl --fail --resolve api.你的域名:443:127.0.0.1 https://api.你的域名/health
curl --fail --resolve api.你的域名:443:127.0.0.1 https://api.你的域名/ready
curl -I http://api.你的域名/ready
```

再在独立网络执行 curl --fail https://api.你的域名/ready。TLS 检查不使用 -k。/health 验证引擎；/ready 增加数据库连接检查，但不替代迁移和真实业务写入验收。

## 8. 任务六：微信接入和体验版

- [ ] 微信小程序后台添加 request 合法域名 https://api.你的域名，不包含 API 路径。本项目联机基于既有 HTTP 接口，先核实实际 wx.connectSocket 使用情况，不能因为有联机功能就默认配置 WebSocket。
- [ ] 核对后台实际 AppID、服务器 WECHAT_APP_ID 和 project.config.json。重启后端加载新的微信密钥；真实 wx.login code 一次性交由 /api/v1/auth/wechat 兑换，不写假身份。
- [ ] 在本地仓库根目录 PowerShell 执行：

```powershell
npm ci
npm run configure:release -- trial --api-root https://api.你的域名
npm run check:release -- trial
npm run typecheck
npm run check
npm test
```

试运行同一后端可以先把 trial 指向正式域名，但这不具备环境隔离；仅限初期受控验收。推荐准备独立 staging 域名/数据库后再开展自动化写入测试。

- [ ] 微信开发者工具导入根目录，启用合法域名校验（当前 project.config.json 的 urlCheck=false 需调整/确认）、确认实际环境地址，上传为体验版并添加体验成员。
- [ ] 在隔离环境运行 Python pytest：安装 backend/requirements.txt 后执行 python -m pytest backend/tests -q。真实 MySQL 集成用例需 WUMA_TEST_DATABASE_URL 指向迁移后的独立 *_test 库；记录跳过项。
- [ ] 不对生产库执行 test:e2e:docker、开发工具 fixture 或 phase27-api-smoke。旧 Docker smoke 使用匿名登录，不能代替真实微信登录验收。

## 9. 任务七：两账号、两设备完整验收

| 场景 | 操作 | 合格条件 |
| --- | --- | --- |
| 游客体验 | 未登录打开首页、教学、离线试玩 | 正常使用公开功能，云端功能按需登录 |
| 微信登录 | 两个账号登录、退出重登、过期会话 | 正确归属账号，过期回登录，不重复误提交 |
| 个人资料 | 修改昵称与版本化头像，同账号换设备 | 云端资料恢复，微信登录不覆盖自定义资料 |
| AI | 三档难度开局、走棋、退出恢复 | 合法走子、保存进度、历史一致 |
| 联机 | A 建房，B 加入；匹配；轮流落子 | 双端版本一致，不越权占席 |
| 联机异常 | 断网重连、重复操作、同账号换机 | 无重复走子，恢复本人席位 |
| 对局操作 | 悔棋同意/拒绝、认输、自然终局 | 双端结果及历史一致 |
| 复盘学习 | 时间轴、视角、解释、生成训练 | 与原棋谱一致，联机按本人视角 |
| 权限 | B 请求 A 私有训练/棋谱 | 私有数据不可越权读取 |
| 棋谱同步 | 本地完整棋谱同步，失败重试 | 保留本地记录，原账号原服务重试 |
| 学习记录 | 题库筛选、答题、我的棋力 | 进度可恢复，样本不足明确展示 |
| LLM 回退 | 未配置/模拟服务失败 | 仍显示确定性提示，不影响对弈 |
| 服务恢复 | 完成记录后重启后端与服务器 | 会话与棋局可按产品逻辑恢复 |

- [ ] 保存版本号、两账号匿名测试标识、设备型号、网络、请求时间、失败截图及结果，避免记录 code、token、OpenID 和 AppSecret。
- [ ] 记录 AI/分析/复盘的独立响应耗时与排队时间，逐步增加并发到预期试运行峰值；设上线目标后依据测量判断通过，不凭机器规格承诺人数。

## 10. 任务八：备份、恢复与监控

- [ ] 每日低峰执行事务一致性 SQL 备份，以下命令在服务器 Bash 执行，避免 Windows PowerShell 重定向编码问题：

```bash
cd /opt/wuma
umask 077
mkdir -p /opt/wuma-backups
backup_file="/opt/wuma-backups/wuma-$(date -u +%Y%m%dT%H%M%SZ).sql"
if docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF --databases "$MYSQL_DATABASE"' > "$backup_file"; then
  gzip "$backup_file"
  sha256sum "$backup_file.gz" > "$backup_file.gz.sha256"
else
  mv "$backup_file" "$backup_file.failed"
  exit 1
fi
```

事务备份期间不执行 DDL。备份须上传到独立、私有、加密存储（例如已配置的 OSS），不能只留在同一台 ECS。建议每日保留 7 份、每周 4 份、每月 3 份，按数据价值调整；密钥配置单独加密托管。

- [ ] 在独立恢复服务器/项目测试 SQL 导入，校验游戏、走棋、账号、资料和学习记录数量，完成真实登录和续局。恢复命令会写库，只能对已确认的恢复目标执行：

```bash
gunzip -c /secure/wuma-backup.sql.gz | docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'
```

该示例先在明确的恢复项目目录执行，目标需无业务写入；完整恢复以实际备份文件路径和退出码为准。

- [ ] 配置容器 restart 策略、Docker 自启动，设置 CPU、内存、磁盘、5xx、证书到期、备份失败和 /ready 故障告警。注意 unhealthy 状态本身不会触发 Docker restart，监控必须告警并制定处理步骤。
- [ ] 建议磁盘 70% 预警、85% 紧急告警，证书到期前 30/14/7 天提醒；不记录鉴权头或敏感登录响应。
- [ ] 设定恢复目标，例如每日备份对应最多约 24 小时数据窗口；实际恢复时长须经演练确认，不能先承诺。

## 11. 任务九：正式发布、更新与回退

- [ ] 体验版验收通过后，本地运行：

```powershell
npm run configure:release -- release --api-root https://api.你的域名
npm run check:release -- release
npm run typecheck
npm run check
npm test
```

- [ ] 核实正式后端、数据库、AppID、证书与微信域名；配置实际隐私说明、服务内容、版本说明和适用类目材料，上传、提交微信审核，通过后按后台流程发布。
- [ ] 后续后端更新：保存当前镜像标签、配置和源码版本 → SQL 备份 → 测试环境迁移/业务验收 → 将 BACKEND_IMAGE 设为新唯一标签 → 构建新镜像 → 维护窗口 up → 检查迁移、就绪与业务。版本标签不能覆盖旧镜像。

```bash
cd /opt/wuma
docker compose build backend
docker compose up -d --wait --wait-timeout 300
docker compose exec -T backend alembic -c /app/backend/alembic.ini current
curl --fail https://api.你的域名/ready
docker compose logs --tail=100 backend
```

- [ ] 回退应用时恢复旧 BACKEND_IMAGE 并执行 docker compose up -d --no-build --wait；仅在新数据库结构兼容旧代码时这样操作。迁移不兼容需停写、按经演练备份恢复，明确新写入数据损失窗口。不要自动 alembic downgrade。
- [ ] 不执行 docker compose down -v 或清理数据库卷作为故障解决办法。

## 12. 容量与后续演进

现有 Node Worker 串行计算，长复盘可能使 AI 请求等待。初期采用单后端实例，监测后再决定改造。不能直接把 Uvicorn --workers 调大当作已验证扩容。

扩容顺序：量化走棋/分析/复盘耗时 → 为昂贵操作制定配额与并发策略 → 设计持久化复盘任务和状态查询 → 验证 Worker 池隔离及超时取消 → 拆分一次性迁移任务 → 验证跨进程幂等与 MySQL 版本冲突 → 再启用多实例/负载均衡。需要新的设计和实现，首期方案不宣称已支持。

同网出口多个体验成员可能触发模板登录 5 次/分钟的 IP 限流，应区分 429 与登录失败，依据观测调整；不能为压测永久取消生产防护。

## 13. 常见故障

| 现象 | 核对方向 |
| --- | --- |
| 外网 HTTPS 超时 | DNS、公网 IP、安全组/轻量防火墙、443 映射、已有端口占用 |
| 证书不可信 | 域名匹配、中间链、到期、服务器时间，不能通过 -k 绕过验收 |
| 502 | backend 健康状态、迁移日志、Nginx upstream、Node 启动 |
| /health 成功而 /ready 失败 | 数据库连接、旧卷账号密码、磁盘、DATABASE_URL 覆盖 |
| 微信无法登录 | AppID 一致性、AppSecret、微信出口、真实 code、合法域名、微信错误码 |
| 体验版显示服务未开放 | test 地址为空/非法；trial 不使用 development |
| 重启后资料似乎消失 | Compose 项目名/卷改变、数据库切换、账号或环境变化 |
| AI 或复盘慢 | 单 Worker 排队、CPU、搜索预算、代理与客户端超时 |

## 14. 交付完成条件

- [ ] 公网有效 HTTPS；只有预期端口对外开放。
- [ ] 数据库当前版本等于唯一 head，真实微信业务读写通过。
- [ ] 体验版两账号两设备和同账号换机通过。
- [ ] 正式版使用 production 地址，后台域名与 AppID 一致。
- [ ] 备份已离机，恢复演练通过，监控和证书更新负责人明确。
- [ ] 记录服务器实际规格、版本/镜像、域名、验收结果及已知容量限制。

技术工作量估计：基础配置与首次部署约 0.5–1 个工作日，真机验收和修复约 1–3 个工作日，运维与恢复演练约 0.5–1 个工作日；这是条件具备时的规划估计，备案、证书和微信审核时间不包含在内。
