# PHASE 27 部署验收记录（2026-09-27）

【阶段】

PHASE 27：Docker 部署。

【已完成】

部署配置、数据库和 Engine 就绪检查、自动迁移启动链、Nginx 本机代理与真实证书 TLS 模板、独立 Docker 验收脚本、部署操作文档。主机环境的 API、MySQL 和微信回归通过。Docker 容器验收未运行，不能据此宣布本阶段通过。

【新增文件】

`.dockerignore`、`.env.example`、`backend/Dockerfile`、`compose.yml`、`deploy/scripts/backend-entrypoint.sh`、`deploy/scripts/wait-for-db.py`、`deploy/nginx/conf.d/local.conf`、`deploy/nginx/conf.d/tls.conf.example`、`deploy/nginx/empty-certs/.gitkeep`、`scripts/phase27-api-smoke.mjs`、`scripts/phase27-docker-e2e.mjs`、`docs/deployment.md`、本报告及设计/执行计划。

【修改文件】

`.gitignore`、`README.md`、`package.json`、`backend/app/main.py`、`backend/app/services/game_store.py`、`backend/app/db/repositories/mysql_store.py`、`backend/tests/test_api.py`。

【Docker 架构】

WeChat → Nginx → FastAPI → Node Worker → Canonical TypeScript Engine；FastAPI → MySQL。此为已配置架构，容器运行链尚未实测。

【镜像】

- backend base：`python:3.12.12-slim-bookworm`；Node 源阶段：`node:24.16.0-bookworm-slim`。
- Python：目标 3.12；Node：目标 24；镜像大小：NOT_RUN。
- runtime user：配置 UID 10001，容器内实测 NOT_RUN。
- build result / clean build result：NOT_RUN（当前主机无 Docker CLI 或可访问的守护进程）。

【Docker Compose】

已配置 `mysql`、`backend`、`nginx`，带健康检查与私有网络；YAML 静态解析通过。真实 health status：三者均 NOT_RUN。

【Migration】

- empty DB upgrade：Docker NOT_RUN。
- existing DB restart：Docker NOT_RUN。
- alembic current：主机隔离 MySQL 为 `0008_training (head)`；Docker NOT_RUN。
- alembic check：主机隔离 MySQL 报 `No new upgrade operations detected.`；Docker NOT_RUN。

【Persistence】

Docker game_id、重启前后版本、backend restart recovery、mysql restart recovery、compose down/up recovery：均 NOT_RUN。独立测试脚本已经包含这些检查，默认保留测试卷。

【Node Worker】

主机 API 验证 worker startup、AI move、analysis：PASS。Docker worker startup、重启恢复和 orphan process：NOT_RUN。

【Nginx】

HTTP reverse proxy、代理后的 health 和 game API：NOT_RUN。已配置上游连接超时 5 秒、发送/读取超时 120 秒，以及 Host、客户端地址、原始协议转发；仅完成配置审阅，尚未通过容器请求验证。

【HTTPS】

Production HTTPS: NOT_VERIFIED。当前没有真实域名、证书和微信后台合法域名配置；未使用自签证书代替生产验收。

【无 LLM Key】

主机 backend startup、review fallback、coach fallback：PASS。Docker 内相同链路：NOT_RUN。

【Docker E2E】

`npm run test:e2e:docker`：NOT_RUN，脚本输出 `Docker CLI and a reachable Docker daemon are required.` 通过 Nginx 的 health、create game、legal moves、human move、AI move、analysis、review、coach、training、database persistence、restart recovery 均待实测。相同 API 业务链在本机直接访问 FastAPI 已 PASS；其 game_id 为 `8f40e777af214f408e79fa6610d695c1`，版本 1，review_id 为 `6ae5a4a67e994f3db2cbb2df606d7bad`。

【安全检查】

- real secrets committed：没有新提交；新增配置中仅有占位密码。
- mysql public port：配置 false，容器实测 NOT_RUN。
- backend public port：配置 false，容器实测 NOT_RUN。
- env file copied into image：Dockerfile 无此 COPY 且 `.dockerignore` 排除 `.env`；镜像实测 NOT_RUN。

【测试结果】

- `npm test`：297 passed。
- `npm run check`：PASS。
- `npm run typecheck`：PASS。
- `backend/.venv/Scripts/python.exe -m pytest backend/tests -q`，使用隔离 MySQL 测试库：86 passed。
- `npm run test:e2e:wechat`、`review`、`llm-review`、`coach`、`training`：各 PASS（微信 DevTools 自动化端口 9421；需数据库的脚本使用独立 `_test` 库）。
- `node scripts/phase27-api-smoke.mjs http://127.0.0.1:8000`：PASS。
- `npm run test:e2e:docker`：NOT_RUN，Docker 不可用。

【部署文档】

`docs/deployment.md` 已写明 build、start、stop、restart、logs、migration、update、backup、restore、TLS、微信域名及 troubleshooting。

【当前已知问题】

核心 Docker 构建、Compose/Nginx、容器内 Node Worker、命名卷恢复、生产 TLS 均缺少运行证据。现有项目仍为单 Node Worker；第三方 LLM Provider 未做真实联通测试。

【是否满足 PHASE 27 验收】

否。Docker Deployment: NOT_VERIFIED；Production HTTPS Go-Live: NOT_VERIFIED。需要可访问的 Docker Engine 后运行 `npm run test:e2e:docker`、检查容器日志和实际镜像大小，再更新本记录。

【项目阶段状态】

PHASE 27 实现与主机回归已完成；Docker 验收未完成。未进入后续阶段。
