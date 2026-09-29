# 弈智五马：PHASE 27 Docker 部署

此部署运行现有 FastAPI、Node 24 TypeScript Engine、MySQL 8.4 和 Nginx。所有对外 API 请求先经过 Nginx；数据库和后端没有宿主机端口。当前只有一个 Node Worker，搜索请求由它串行处理。

## 前置条件

- Docker Engine 与 Docker Compose v2，足够的内存和磁盘空间；可拉取 `python:3.12.12-slim-bookworm`、`node:24.16.0-bookworm-slim`、`mysql:8.4.11` 和 `nginx:1.30.5-alpine3.24-slim`。
- 以本仓库根目录为当前目录。Windows PowerShell 的复制命令见下；Linux/macOS 可用 `cp .env.example .env`。
- 首次启动需可访问镜像仓库和 Python 包源。服务器时钟和防火墙应正确配置。
- 生产发布还需真实域名、有效证书、HTTPS 入口以及微信小程序后台配置的合法 request 域名。

## 配置和首次启动

```powershell
Copy-Item .env.example .env
# 编辑 .env，至少替换 DB_PASSWORD 与 DB_ROOT_PASSWORD
docker compose config --quiet
docker compose build
docker compose up -d --wait
docker compose ps
curl.exe http://127.0.0.1:8080/health
curl.exe http://127.0.0.1:8080/ready
```

`.env` 被 Git 和 Docker 构建上下文排除。示例密码只是占位，不能用于生产。`DB_USER` 和 `DB_NAME` 可改；默认 `DATABASE_URL` 为空，后端使用 `DB_*` 连接 Compose 内的 `mysql:3306`。若提供完整 `DATABASE_URL`，它优先于 `DB_*`，必须指向同一个数据库且妥善处理特殊字符。已有 MySQL 卷的账号密码不会因修改 `.env` 自动更新：应在数据库内先改密码，再同步配置。

默认 Nginx 只绑定 `127.0.0.1:8080`，用于本机验证；`8443` 宿主映射存在，但本地 Nginx 配置没有 TLS 监听。不要把这个 HTTP 配置作为微信生产入口。后端端口 8000 和 MySQL 3306 只在 Compose 私有网络内。`/health` 检查 Engine；`/ready` 同时检查 Engine 和 MySQL，容器健康检查使用 `/ready`。

## 日常运维

```powershell
docker compose ps
docker compose logs --tail=100 backend
docker compose logs --tail=100 nginx
docker compose logs --tail=100 mysql
docker compose logs -f backend
docker compose restart backend
docker compose restart mysql
docker compose down
docker compose up -d --wait
```

`docker compose down` 保留命名数据库卷；不要在常规停机或更新中加 `-v`。后端启动脚本先等待 MySQL 连接，再执行 `alembic upgrade head`，最后启动单个 Uvicorn 进程。数据库迁移失败会阻止后端就绪。检查迁移版本：

```powershell
docker compose exec -T backend alembic -c /app/backend/alembic.ini current
docker compose exec -T backend alembic -c /app/backend/alembic.ini heads
docker compose exec -T backend alembic -c /app/backend/alembic.ini check
```

`current` 应位于 `heads`，`check` 应没有待生成的迁移。当前自动迁移适合单后端实例；不要同时部署多个会竞争迁移的后端副本。

## 更新和回退

先做备份，再获取新代码（本仓库可能尚无 Git 提交，可复制已审核的新文件），审阅迁移，然后执行：

```powershell
docker compose build
docker compose up -d --wait
docker compose ps
curl.exe http://127.0.0.1:8080/ready
```

保留上一版镜像或构建材料以便恢复应用代码。应用镜像回退与数据库迁移回退是两件事；不要把 `alembic downgrade` 设为自动回退。若新版本的迁移不能与旧代码兼容，先停止服务并按备份恢复数据库，确认数据损失边界后再启动旧镜像。

## 备份与恢复

以下 PowerShell 示例在仓库外生成 SQL 文件。备份时尽量让应用停止写入，至少在维护窗口执行。备份文件包含用户数据和密码散列，应加密保存，且定期在独立环境演练恢复。

```powershell
$backup = Join-Path $HOME "wuma-$(Get-Date -Format yyyyMMdd-HHmmss).sql"
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers --databases "$MYSQL_DATABASE"' | Set-Content -LiteralPath $backup -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'mysqldump failed' }
```

恢复会覆盖/合并目标库内容。先停后端写入、确认目标项目名和备份，再在目标 MySQL 容器内导入；不要对正在使用的生产库直接演练：

```powershell
docker compose stop nginx backend
docker compose cp 'C:\secure\wuma-backup.sql' mysql:/tmp/wuma-restore.sql
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot < /tmp/wuma-restore.sql'
if ($LASTEXITCODE -ne 0) { throw 'restore failed' }
docker compose exec -T mysql rm /tmp/wuma-restore.sql
docker compose up -d --wait
```

恢复前应另做当前卷快照。MySQL 8.4 恢复到不同版本需先验证兼容性。

## TLS 与微信合法域名

获得真实域名和对应的受信任证书后，把完整证书链和私钥放在仅部署机可读的目录，例如 `deploy/nginx/certs/fullchain.pem` 与 `privkey.pem`。复制 `deploy/nginx/conf.d/tls.conf.example` 为 `tls.conf`，把 `server_name _` 换成实际域名；设置 `.env`：

```text
NGINX_BIND_ADDRESS=0.0.0.0
HTTP_PORT=80
HTTPS_PORT=443
NGINX_CONFIG=./deploy/nginx/conf.d/tls.conf
TLS_CERT_DIR=./deploy/nginx/certs
```

然后执行 `docker compose up -d --wait`，在外网验证证书链、域名匹配、HTTP 重定向及 `https://<域名>/ready`。证书到期前轮换并重启 Nginx。示例 TLS 配置提供 TLS 1.2/1.3 与 80→443 跳转；证书签发、DNS、防火墙、微信后台的合法 request 域名和小程序发布仍由实际部署环境配置。发布小程序前将 `miniprogram/config/api.ts` 的生产 API 地址设置为该 HTTPS 域名，并在微信后台添加同一合法域名。不要使用自签证书宣称微信生产 HTTPS 通过。

## 验收与故障排查

主机回归：`npm test`、`npm run check`、`npm run typecheck`、`python -m pytest backend/tests -q`。有微信开发者工具连接及相应 API 环境时，再运行五组既有 `test:e2e:wechat`、`review`、`llm-review`、`coach`、`training`。Docker 独立验收运行 `npm run test:e2e:docker`；脚本会分配独立 Compose 项目、随机测试密码、独立端口与卷，通过 Nginx 测 API，并检查重启恢复。测试容器退出后保留卷；根据打印的项目名手工决定是否删除。

- `docker compose config --quiet` 失败：检查 `.env` 必填变量、路径和端口；不要把真实密钥粘贴到工单。
- MySQL 一直不健康：看 `docker compose logs mysql`，检查磁盘、卷权限、密码和旧卷对应的账号；旧卷不会重新初始化用户。
- 后端不健康：看 `docker compose logs backend`；确认 Alembic 成功、`/ready` 可访问、Node Worker 能启动。`/health` 成功而 `/ready` 失败通常是数据库连接问题。
- Nginx 不健康或 502：看 `docker compose logs nginx backend`、容器健康状态和代理配置；TLS 模式还需检查证书路径、私钥权限、证书域名。
- 迁移失败：保持服务停止，核对 `alembic current` 与日志，先备份再人工处理；不要反复修改迁移历史或删除卷。
- AI、分析、复盘响应慢：单个 Node Worker 串行处理，Nginx 上游读写超时为 120 秒；检查后端和 Worker 日志。不要通过启动多个 Uvicorn Worker 绕开现有一致性设计。

本项目的无 LLM Key 模式可使用 Review 和 Coach 的确定性回退文案；第三方 Provider 的真实联通需另行验证。
