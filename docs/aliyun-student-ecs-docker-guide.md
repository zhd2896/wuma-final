# 弈智五马：阿里云学生 ECS 部署与 Docker 使用手册

编写日期：2026-10-07。本文以本次实际部署过程和当前项目配置为依据，适用于开发测试。命令区分「ECS 终端」和「Windows PowerShell」，请勿混用。

## 目录

1. [当前环境与部署结果](#1-当前环境与部署结果)
2. [Docker 与项目架构](#2-docker-与项目架构)
3. [服务器环境安装](#3-服务器环境安装)
4. [从 GitHub 拉取项目](#4-从-github-拉取项目)
5. [获取镜像及离线传输](#5-获取镜像及离线传输)
6. [配置项目环境变量](#6-配置项目环境变量)
7. [构建后端及启动服务](#7-构建后端及启动服务)
8. [安全组与公网访问](#8-安全组与公网访问)
9. [微信开发者工具接入](#9-微信开发者工具接入)
10. [AI 和联机测试](#10-ai-和联机测试)
11. [下次启动与日常 Docker 操作](#11-下次启动与日常-docker-操作)
12. [更新、备份及恢复](#12-更新备份及恢复)
13. [本次故障与处理记录](#13-本次故障与处理记录)
14. [验收清单与后续上线](#14-验收清单与后续上线)

## 1. 当前环境与部署结果

| 项目 | 当前值 |
| --- | --- |
| 云服务器 | 阿里云学生 ECS |
| 系统 | CentOS Linux 7.9.2009 |
| 架构 / 内核 | x86_64 / 3.10.0-1160.119.1.el7.x86_64 |
| 公网 IP | 47.114.56.132，后续以控制台实际值为准 |
| 后端入口 | http://47.114.56.132:8080 |
| 服务器项目目录 | /opt/wuma |
| 本地项目目录 | E:\C盘Doucment\ChatGPT\wuma最终版 |
| GitHub 仓库 | https://github.com/zhd2896/wuma-final.git |
| Docker Engine / Compose | 26.1.4 / 2.27.1 |
| Compose 项目名 | wuma-dev |
| 数据库 / 用户 | wuma_dev / wuma |
| 后端镜像 | wuma-backend:dev-20261007 |
| MySQL 镜像 | mysql:8.4.11 |
| 最终 Nginx 镜像 | nginx:1.30.5，Debian 版 |
| 域名、证书 | 未配置，当前使用 HTTP/IP 开发调试 |
| 小程序地址 | development 已设置公网地址，test/production 仍空 |

依据用户提供的终端日志，三个容器已健康，服务器本机 /ready 返回成功；修正安全组绑定后，本地 TCP 8080 测试成功。微信环境已确认 develop。完整 AI 登录、续局及双账号联机验收尚未提供通过记录，不能仅凭部署成功视为业务验收完成。

CentOS 7 于 2024-06-30 停止维护，本环境用于受控开发测试；正式上线应迁移到受支持系统。[CentOS 官方生命周期](https://www.centos.org/centos-linux/)

本文不包含真实密码、AppSecret 或 GitHub 访问令牌。本次曾在聊天中暴露的 GitHub 令牌应在 GitHub 中撤销；撤销不会删除已拉取的代码。

## 2. Docker 与项目架构

### 2.1 请求如何流转

```text
电脑模拟器 / 手机开发调试
           |
           | HTTP 47.114.56.132:8080
           v
阿里云安全组 → ECS Docker 端口映射
           |
           v
Nginx 容器：80
           |
           v
FastAPI 容器：8000 ──→ Node 24 棋规与 AI Worker
           |
           v
MySQL 容器：3306 → 持久化数据库卷
```

对公网只需要开放 Nginx 的 8080。后端 8000 和 MySQL 3306 没有宿主机端口映射。当前 Compose 还映射 8443→443，但 HTTP 配置没有 TLS 监听，无须在安全组开放 8443。

小程序代码在微信开发者工具编译并运行；ECS 不托管小程序界面。LLM 服务仅用于可选文字解说，留空不会阻止现有搜索 AI 对战。

### 2.2 Docker 中的几个概念

| 概念 | 本项目实例 | 用途 |
| --- | --- | --- |
| 镜像 Image | mysql:8.4.11、wuma-backend:dev-20261007 | 程序及其运行环境的打包模板 |
| 容器 Container | wuma-dev-backend-1 | 从镜像启动的运行实例 |
| Dockerfile | backend/Dockerfile | 定义后端镜像如何构建 |
| Compose | compose.yml | 管理服务、依赖、端口、网络和卷 |
| 覆盖配置 | compose.override.yml | 为本服务器替换 Nginx 镜像和健康检查 |
| 网络 Network | wuma-dev_app_net | 让容器通过 backend/mysql 服务名通信 |
| 数据卷 Volume | wuma-dev_mysql_data | 容器重建后仍保留数据库文件 |
| 文件挂载 Bind mount | local.conf → default.conf | 将服务器配置提供给 Nginx |
| 健康检查 | /ready、SQL SELECT 1 | 检查服务是否满足配置的就绪条件 |

端口 8080:80 中，左边是 ECS 端口，右边是容器端口。0.0.0.0 表示监听所有 IPv4 网卡；127.0.0.1 只允许服务器自身访问。

backend 镜像同时包含 Python 和 Node，不需要在 CentOS 上单独安装 Python 3.12、Node 24 或 MySQL。镜像内为 Debian，所以构建时运行 apt-get 正常；宿主机仍使用 yum。

当前只有一个 Node Worker 串行执行引擎请求，长复盘可能造成排队。不能仅凭容器数量或机器规格承诺并发人数。

## 3. 服务器环境安装

本节用于重建环境。已安装成功的当前服务器直接跳过，不重复安装。

### 3.1 核对系统

**ECS 终端：**

```bash
cat /etc/centos-release
uname -r
uname -m
free -h
df -h
```

本节仅针对 CentOS 7.9 x86_64。不要使用前期误认为 CentOS 9 时的 dnf 命令，也不要安装 EL9 RPM。

### 3.2 安装工具和 Docker

本次以 root 登录，以下不需要 sudo：

```bash
yum install -y yum-utils git curl openssl nano
yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
yum makecache
yum list docker-ce docker-ce-cli docker-compose-plugin --showduplicates
```

确认实际源列出这些 EL7 版本后：

```bash
yum install -y \
  docker-ce-26.1.4-1.el7 \
  docker-ce-cli-26.1.4-1.el7 \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin-2.27.1-1.el7
systemctl enable --now docker
docker version
docker compose version
```

Docker 官方 EL7 存档保留这些包，但旧包可下载不代表系统仍受安全维护。[Docker EL7 包列表](https://download.docker.com/linux/centos/7/x86_64/stable/Packages/)

本次基础 yum 源正常。其他服务器如提示 mirrorlist.centos.org 或 No valid baseurl，先备份 /etc/yum.repos.d 并修复适用的 CentOS 7 归档源，不关闭 GPG 校验或替换成 EL9 源。

### 3.3 镜像加速器

Docker Hub 直连在当前 ECS 上超时。本次使用账号提供的 ACR 镜像加速地址。

```bash
mkdir -p /etc/docker
nano /etc/docker/daemon.json
```

首次无配置文件时填写：

```json
{
  "registry-mirrors": [
    "https://ee1vknzp.mirror.aliyuncs.com"
  ]
}
```

其他账号应从 ACR 控制台「镜像工具 → 镜像加速器」取得自己的地址。已有 daemon.json 时合并字段，不能覆盖现有配置。

```bash
systemctl restart docker
docker info --format '{{json .RegistryConfig.Mirrors}}'
docker run --rm hello-world
```

改文件后必须重启 Docker，否则 Mirrors 仍可能为 null。本次 hello-world 成功，但项目固定版本镜像仍失败。

阿里云说明加速器已停止同步最新镜像，因此不能把 hello-world 成功当作所有版本可下载的证明。[ACR 官方说明](https://help.aliyun.com/zh/acr/user-guide/accelerate-the-pulls-of-docker-official-images)

## 4. 从 GitHub 拉取项目

**ECS 终端：**

```bash
git clone https://github.com/zhd2896/wuma-final.git /opt/wuma
cd /opt/wuma
git log -1 --oneline
git status --short
ls -a
```

目标目录须为空；已成功 clone 的当前环境不再次 clone。

私有仓库提示用户名时填写 GitHub 用户名；密码位置填写具备所需仓库读取权限的 PAT，不是 GitHub 登录密码。不将令牌嵌入 URL、命令文件、截图或文档。也可使用只读 Deploy Key。

本项目构建依赖以下目录，不能只上传 backend：

```text
backend/
miniprogram/domain/
miniprogram/ai/
deploy/scripts/
package.json
compose.yml
```

本地未提交或未推送的改动不会通过 clone 到达服务器。发布前记录提交号并确认本地小程序与后端接口兼容。

## 5. 获取镜像及离线传输

### 5.1 最终需要的镜像

| 镜像 | 作用 |
| --- | --- |
| python:3.12.12-slim-bookworm | 后端构建基础环境 |
| node:24.16.0-bookworm-slim | 提供 Node 引擎运行时 |
| mysql:8.4.11 | 数据库 |
| nginx:1.30.5 | 最终采用的 Debian Nginx |

本次最初使用 nginx:1.30.5-alpine3.24-slim，因旧环境兼容错误而替换。重建部署直接准备上表镜像即可，不必再下载故障版本。

### 5.2 Windows 安装 Docker Desktop

下载 [Docker Desktop Windows 安装包](https://docs.docker.com/desktop/setup/install/windows-install/)，普通 Intel/AMD 电脑选择 x86_64。采用 Per-user 安装和 WSL 2 Linux 容器后端。

如未安装 WSL，在管理员 PowerShell 执行 wsl --install，按提示重启；已有 WSL 可用 wsl --update。[微软 WSL 安装说明](https://learn.microsoft.com/en-us/windows/wsl/install)

安装后打开 Docker Desktop，完成欢迎流程，等待引擎启动。本次 per-user 的命令文件位于：

```text
C:\Users\86175\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe
```

若 PowerShell 找不到 docker，执行：

```powershell
& 'C:\Users\86175\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe' version
$env:Path = 'C:\Users\86175\AppData\Local\Programs\DockerDesktop\resources\bin;' + $env:Path
docker version
```

PATH 这条只作用于当前终端。以后可重新执行，或通过 Windows 用户环境变量界面将该目录加入 Path；不同账号/安装方式以实际文件位置为准。

### 5.3 下载和导出

**Windows PowerShell：**

```powershell
docker pull --platform linux/amd64 python:3.12.12-slim-bookworm
docker pull --platform linux/amd64 node:24.16.0-bookworm-slim
docker pull --platform linux/amd64 mysql:8.4.11
docker pull --platform linux/amd64 nginx:1.30.5
New-Item -ItemType Directory -Force -Path 'E:\wuma-images'
docker image save -o 'E:\wuma-images\wuma-base-images.tar' python:3.12.12-slim-bookworm node:24.16.0-bookworm-slim mysql:8.4.11 nginx:1.30.5
Get-Item 'E:\wuma-images\wuma-base-images.tar' | Select-Object FullName, Length
Get-FileHash 'E:\wuma-images\wuma-base-images.tar' -Algorithm SHA256
```

save 使用 -o 输出文件，不使用 PowerShell 文本重定向保存镜像。指定 linux/amd64 与服务器架构一致。

### 5.4 上传和导入

**Windows PowerShell：**

```powershell
scp 'E:\wuma-images\wuma-base-images.tar' root@47.114.56.132:/opt/wuma/
```

首次 SSH 确认指纹前核对服务器身份。密码输入不显示字符，正常。上传时安全组 TCP 22 须允许管理电脑来源。

**ECS 终端：**

```bash
sha256sum /opt/wuma/wuma-base-images.tar
docker load -i /opt/wuma/wuma-base-images.tar
docker image ls
```

核对两端 SHA256 一致。导入只提供基础镜像；构建时 apt/pip 依赖仍需网络。本次 ECS 已成功下载依赖并完成构建。如果以后依赖下载受阻，可以在可信本地构建完整后端镜像再 save/load，且需保持源码版本、架构与标签对应。

## 6. 配置项目环境变量

### 6.1 创建并编辑

**ECS 终端：**

```bash
cd /opt/wuma
umask 077
cp -n .env.example .env
chmod 600 .env
openssl rand -hex 24
openssl rand -hex 24
nano .env
```

两个随机输出分别用于两个数据库密码。nano 中 Ctrl+O、回车保存，Ctrl+X 退出。

配置内容如下，尖括号内容替换实际值，不能原样填写：

```dotenv
COMPOSE_PROJECT_NAME=wuma-dev
BACKEND_IMAGE=wuma-backend:dev-20261007
WUMA_ENV=development
DATABASE_URL=
DB_NAME=wuma_dev
DB_USER=wuma
DB_PASSWORD=<第一个随机密码>
DB_ROOT_PASSWORD=<第二个随机密码>

NGINX_BIND_ADDRESS=0.0.0.0
HTTP_PORT=8080
HTTPS_PORT=8443
NGINX_CONFIG=./deploy/nginx/conf.d/local.conf
TLS_CERT_DIR=./deploy/nginx/empty-certs

WECHAT_APP_ID=<实际小程序AppID>
WECHAT_APP_SECRET=<同一小程序的AppSecret>
AUTH_SESSION_DAYS=7

LLM_PROVIDER=configured
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
LLM_TIMEOUT_SECONDS=8
LLM_TOTAL_TIMEOUT_SECONDS=30
LLM_TEMPERATURE=0.1
```

### 6.2 关键设置说明

- DATABASE_URL 留空，后端使用 DB_* 配置；非空时覆盖这些连接设置。
- DB_HOST 在 Compose 内配置为 mysql，容器内不能用 127.0.0.1 代指数据库容器。
- WECHAT_APP_ID 与本地 project.config.json、实际微信身份验证服务必须一致。
- AppSecret 仅在服务器使用，不能放在小程序、GitHub 或聊天中。
- WUMA_ENV=development 不会改变微信 envVersion；微信 develop/trial/release 由客户端运行环境决定。
- 初期无 LLM Key 时仍提供确定性教练/复盘文案。
- COMPOSE_PROJECT_NAME 决定本项目资源命名；已有数据库后不要随意更改，否则可能启动一个新的空数据库卷。
- 已初始化的 MySQL 卷不会因修改 .env 自动更改库用户密码，需在库内执行受控密码变更并同步配置。

检查配置只执行：

```bash
docker compose config --quiet
```

不把完整 docker compose config 输出公开，它可能展开密钥。

## 7. 构建后端及启动服务

### 7.1 构建

```bash
cd /opt/wuma
docker compose build --pull=false backend
```

Dockerfile 从 Python 镜像构建，复制 Node 二进制，安装依赖，复制共享棋规、AI 和后端源码。构建会使用 apt-get 和 pip，耗时取决于服务器网络；本次约 795 秒。

FINISHED 且 naming to ... wuma-backend:dev-20261007 表示镜像构建完成，不代表业务服务已启动。

### 7.2 创建 CentOS 7 专用 Nginx 覆盖文件

当前基础 compose.yml 仍默认 Alpine 镜像。必须创建以下覆盖文件，后续在同一目录运行 Compose 会自动合并它：

```bash
cd /opt/wuma
cat > compose.override.yml <<'EOF'
services:
  nginx:
    image: nginx:1.30.5
    healthcheck:
      test: ["CMD", "curl", "--fail", "--silent", "--max-time", "5", "http://127.0.0.1/health"]
EOF
docker compose config --quiet
```

Nginx 改为 Debian 版，健康检查也改为 curl。不要删除该文件后继续套用原配置；如果使用 -f 显式指定文件，则必须同时指定 compose.yml 与 compose.override.yml。

### 7.3 启动和检查

```bash
docker compose up -d --no-build --pull never --wait --wait-timeout 300
docker compose ps
docker compose exec -T nginx nginx -t
curl --fail http://127.0.0.1:8080/health
curl --fail http://127.0.0.1:8080/ready
```

三个服务最终应 healthy。health: starting 是初始状态，可以短暂等待；Restarting 表示进程退出，要查日志。

后端启动脚本会依次等待 MySQL、执行 Alembic upgrade head、启动单 Uvicorn 进程。迁移失败会阻止后端就绪。

```bash
docker compose exec -T backend alembic -c /app/backend/alembic.ini current
docker compose exec -T backend alembic -c /app/backend/alembic.ini heads
```

current 应与唯一 head 一致；部署时以服务器实际源码版本为准。本文编写时项目 head 为 0019_user_profiles。

/health 检查 Node 引擎，/ready 还检查数据库连接。它们不替代迁移版本确认、真实微信登录与业务写入测试。

## 8. 安全组与公网访问

### 8.1 云侧规则

从「当前 ECS 实例详情 → 安全组」进入，确认修改的组确实绑定该实例：

| 端口 | 规则 |
| --- | --- |
| 22/TCP | 仅管理员来源，用于 SSH/SCP |
| 8080/TCP | 测试者来源；手机出口不固定时可受控临时放宽 |
| 3306/8000 | 不对公网开放 |
| 8443 | 当前无 HTTPS，不开放 |

设置入方向、允许、自定义 TCP、8080/8080，保存。本次公网失败的最终原因是修改了错误绑定关系的安全组；保存规则并不等于它作用于目标实例。[阿里云安全组说明](https://help.aliyun.com/zh/ecs/user-guide/start-using-security-groups)

### 8.2 本地验证

**Windows PowerShell：**

```powershell
Test-NetConnection 47.114.56.132 -Port 8080
curl.exe --fail --connect-timeout 10 --max-time 20 http://47.114.56.132:8080/ready
```

预期 TcpTestSucceeded=True，接口 code=0、status=ok。公网端口可连接不等同于 HTTP 接口成功。

本机成功、公网失败时检查：公网 IP、实例绑定安全组、云侧访问控制、客户端网络，然后检查宿主机 iptables。不要直接关闭或清空防火墙。

## 9. 微信开发者工具接入

### 9.1 本地配置

**Windows PowerShell，在本地项目目录：**

```powershell
Set-Location 'E:\C盘Doucment\ChatGPT\wuma最终版'
npm ci
```

本地开发需要适用的 Node/npm。Docker 内的 Node 不自动提供 Windows 的 npm 命令。

miniprogram/config/api-roots.ts：

```typescript
export const API_BASE_URLS = {
  development: 'http://47.114.56.132:8080',
  test: '',
  production: '',
} as const;
```

地址不加 /api/v1，调用代码会拼接业务路径。手机与开发工具使用公网 IP，而不是手机自身的 127.0.0.1。

### 9.2 编译和 Console

1. 导入含 project.config.json 的仓库根目录。
2. 确认使用有权限的 AppID，与后端一致。
3. 在「详情 → 本地设置」勾选跳过合法域名、TLS 和 HTTPS 证书校验。
4. 保存文件，点击编译；本次工具界面对应右上「普通编译」旁的圆形箭头。
5. 下方面板选择「调试器 → Console」，不是编辑器的「调试控制台」。
6. 输入以下表达式，返回值应为 develop：

```javascript
wx.getAccountInfoSync().miniProgram.envVersion
```

可额外检查请求：

```javascript
wx.request({
  url: 'http://47.114.56.132:8080/ready',
  success: res => console.log(res.statusCode, res.data),
  fail: err => console.error(err)
})
```

预期 HTTP 200。随后用项目登录按钮完成真实 wx.login 流程，不能用假 code 冒充登录。

### 9.3 开发环境边界

项目运行地址映射为 develop→development、trial→test、release→production。项目自身仅允许 development 使用 HTTP/IP；trial/release 必须合法 HTTPS DNS 地址，即使微信跳过校验也不能绕过项目校验。

手机必须使用开发调试会话；电脑勾选不代表所有手机模式自动豁免。手机报域名错误时核对调试模式与实际 envVersion。本文不将当前 IP 方案作为体验版/正式版上线方法。[微信网络文档](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)

HTTP 登录令牌未加密，仅用于受控测试，不使用真实敏感资料。

## 10. AI 和联机测试

### 10.1 AI 基础验收

1. 首页进入 AI 对弈，按需微信登录。
2. 入门难度开局，走 3–5 步，确认 AI 能回应。
3. 截图棋盘，通过小程序返回首页。
4. 从历史打开未结束对局，确认棋盘与轮次一致，继续走一步。
5. 检查其他难度、教练提示及终局复盘；无 LLM 时检查回退文字。

### 10.2 双账号联机

前提是两个不同微信身份，两端同 AppID、同 API 地址、兼容代码版本。复制窗口不保证是不同账号。

常规注册小程序由管理员在微信公众平台添加项目成员开发权限，B 再用自己的微信登录开发工具。个人主体注册小程序与工具生成的个人测试号不同：测试号没有相同团队协作流程，不能假定 B 可使用它。需实际核实预览/调试授权；如 B 被拒绝，应准备可管理成员的实际小程序 AppID。不能让 B 换另一个测试号后直接复用当前单 AppID 后端。

测试步骤：

1. A 登录、远程双人、创建私人房间，记录 8 位房间码。
2. B 用自己的微信身份登录，输入码加入。
3. 按界面行棋方轮流操作，完成 3–5 轮，核对棋盘、备用棋及轮次。
4. 测试悔棋拒绝和同意，检查两端一致。
5. 暂时断开 B 的测试设备网络，恢复后检查同步与续局。
6. 重开小程序恢复本人席位；同账号换设备作为另一个恢复测试。
7. 认输或自然终局，检查双方历史及本人视角复盘。
8. 私人房间通过后再测试公开匹配。

手机可从开发工具「真机调试」扫码进入；第二账号是否被允许需按当前账号类型与工具规则验证。

## 11. 下次启动与日常 Docker 操作

### 11.1 服务是否一直运行

ECS 保持运行、容器未被停止时，关闭电脑/SSH/开发工具不会停止后端。服务器本次启用了 Docker 自启动，服务使用 restart: unless-stopped。

手动停止过的容器不会仅凭重启 Docker 自动恢复，需再次执行 compose up。unhealthy 不等于进程退出，Docker 不会仅因 unhealthy 自动重启。

ECS 控制台停机后先启动实例，再核对公网 IP；若 IP 改变，客户端地址也要改。是否产生费用以实例计费方式和云控制台为准，停止项目容器不等于停止云资源计费。

### 11.2 每次连接和检查

**Windows PowerShell：**

```powershell
ssh root@47.114.56.132
```

**ECS 终端：**

```bash
cd /opt/wuma
docker compose ps
curl --fail http://127.0.0.1:8080/ready
```

服务正常则直接打开微信项目编译测试，不重装、不重建。

### 11.3 停止后恢复

```bash
systemctl start docker
cd /opt/wuma
docker compose up -d --no-build --pull never --wait --wait-timeout 300
```

### 11.4 常用命令速查

在 /opt/wuma 目录执行：

| 命令 | 用途 |
| --- | --- |
| docker compose ps | 查看本项目服务状态 |
| docker compose logs --tail=100 backend | 看后端最近日志 |
| docker compose logs --tail=100 nginx | 看 Nginx 错误 |
| docker compose logs --tail=100 mysql | 看数据库日志 |
| docker compose logs -f --tail=100 backend | 跟踪后端；Ctrl+C 仅退出查看 |
| docker stats --no-stream | 查看 CPU/内存等资源 |
| docker image ls | 查看本机镜像 |
| docker volume ls | 查看卷列表 |
| docker compose restart backend | 重启现有容器，不重新读取 .env |
| docker compose stop | 停止本项目容器，保留容器和卷 |
| docker compose down | 删除本项目容器/网络，默认保留命名卷 |
| docker compose exec -T nginx nginx -t | 检查代理配置 |

不要使用 docker compose down -v 或 docker volume prune 作为常规清理，它们可能删除数据库。docker image save/load 只处理镜像，不备份数据库卷或 .env。

### 11.5 更改配置后如何生效

- 修改后端 .env：docker compose up -d --no-deps --no-build --pull never --force-recreate backend。
- 修改 Nginx local.conf：先 nginx -t 成功，再 docker compose exec -T nginx nginx -s reload。
- 修改覆盖文件镜像/healthcheck：docker compose up -d --no-deps --no-build --pull never --force-recreate nginx。
- 修改后端源码：重新 build 后 compose up，单纯 restart 不会更新镜像内的源码。
- 修改数据库账号密码：需要数据库内同步修改，不能只改 .env。

## 12. 更新、备份及恢复

### 12.1 后端代码更新

先确认代码已审核并推送、备份完成；保留旧镜像，给新版本使用唯一标签。已有 compose.override.yml 也应备份保留，不被部署包覆盖。

```bash
cd /opt/wuma
git status --short
git pull --ff-only
```

如果有本地冲突先解决，不用 reset --hard 丢弃文件。记录 git log -1 --oneline；审阅数据库迁移。在 .env 中更换 BACKEND_IMAGE 为新的唯一版本，例如 wuma-backend:dev-20261008，再执行：

```bash
docker compose config --quiet
docker compose build --pull=false backend
docker compose up -d --no-build --pull never --wait --wait-timeout 300
docker compose ps
curl --fail http://127.0.0.1:8080/ready
docker compose exec -T backend alembic -c /app/backend/alembic.ini current
```

然后执行真实登录与续局抽查。客户端源码也需更新为兼容版本。

应用回退只在数据库兼容旧代码时可恢复旧 BACKEND_IMAGE 并 up；迁移不兼容需维护窗口停写、按经演练备份恢复，不能自动 downgrade。

### 12.2 数据库备份

以下为服务器 Bash，SQL 备份不经过 Windows 文本重定向：

```bash
cd /opt/wuma
umask 077
mkdir -p /opt/wuma-backups
backup_file="/opt/wuma-backups/wuma-$(date -u +%Y%m%dT%H%M%SZ).sql"
if docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF --databases "$MYSQL_DATABASE"' > "$backup_file"; then
  gzip "$backup_file"
  sha256sum "$backup_file.gz"
else
  mv "$backup_file" "$backup_file.failed"
  exit 1
fi
```

事务备份期间不执行 DDL。备份用户、棋局与学习数据，应限制读取并保留离机副本；同一 ECS 的卷和备份可能同时丢失。每日/每周保留策略按数据价值设置，本次尚未配置自动备份任务。

.env 和服务器覆盖配置需单独保密备份，SQL 不包含部署密钥。

### 12.3 恢复

先在独立恢复环境演练。导入会写入/替换备份所描述的库，不能对正在使用的生产库随意执行。

1. 核对目标 Compose 项目、数据库名称和备份 SHA256。
2. 备份当前数据，停止应用写入：docker compose stop nginx backend。
3. 保持 MySQL 运行，从已确认备份恢复：

```bash
set -o pipefail
gunzip -c /opt/wuma-backups/已确认的备份文件.sql.gz | docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'
```

4. 检查命令退出码；失败不继续启动应用。
5. 用匹配的代码/镜像启动，确认迁移版本与真实业务记录。

### 12.4 运维监控

关注磁盘、CPU、内存、接口错误、证书（以后使用 HTTPS 时）和备份失败。建议在 Docker daemon.json 合并日志轮转配置 max-size=10m/max-file=3；已有容器须重建才使用新日志设置。重启 Docker 会影响运行服务，应安排维护时段。

## 13. 本次故障与处理记录

| 故障 | 实际原因或证据 | 处理 |
| --- | --- | --- |
| GitHub Authentication failed | 令牌误填为用户名 | 用户名填 GitHub 账号，密码提示填令牌；已暴露令牌撤销 |
| docker 命令无法识别 | 本地 per-user CLI 未进入当前 PATH | 完整路径验证，当前终端加入实际 bin 目录 |
| ECS Docker Hub 超时 | IPv6 无路由，IPv4 也超时 | 不直接改系统 DNS；使用镜像加速并验证，固定版本离线传输 |
| Mirrors=null | daemon.json 修改后尚未重启 | restart docker，再 docker info 验证 |
| hello-world 成功、固定标签失败 | 加速器不能提供所有新版本 | Windows 下载指定架构，save→scp→load |
| apt/pip 构建慢 | 依赖仍需要下载 | 本次等待后 FINISHED；不将下载过程当作已失败 |
| Nginx 反复 Restarting | pwrite nginx.pid EPERM，SELinux Disabled | 同版本 Debian Nginx，覆盖 healthcheck 改 curl，重建后成功 |
| default.conf read-only 提示 | 配置以只读 bind mount 提供 | 本次不是退出原因，不改 777 权限 |
| 本机 ready 正常、公网超时 | SYN 抓包为 0；实际安全组绑定错误 | 从目标实例确认绑定并保存 8080 规则后 TCP 成功 |
| Console 提示启动调试会话 | 选了编辑器调试控制台 | 改用调试器中的 Console |

Nginx 官方仓库记录过同环境同类错误；本文据此选择兼容镜像，未在当前服务器用 strace 验证具体系统调用。[官方问题记录](https://github.com/nginx/docker-nginx/issues/1059)

公网诊断命令（只读）：

```bash
ss -lntp | grep ':8080'
systemctl is-active firewalld
iptables -nvL INPUT --line-numbers
iptables -nvL DOCKER-USER --line-numbers
iptables -t nat -nvL DOCKER --line-numbers
timeout 30 tcpdump -ni any -nn 'tcp port 8080'
```

抓包的 30 秒期间，电脑同时执行：

```powershell
curl.exe --noproxy "*" --connect-timeout 5 --max-time 10 http://47.114.56.132:8080/ready
```

未收到包提示检查路径上游，但不能仅凭无包确定安全组原因；同步核查 IP、绑定、客户端出口和云防火墙。

## 14. 验收清单与后续上线

### 14.1 本次状态

- [x] CentOS 7.9、架构和内核确认。
- [x] Docker 26.1.4 / Compose 2.27.1 安装与运行验证。
- [x] GitHub 拉取完成。
- [x] 镜像离线传输、后端构建完成。
- [x] Nginx Debian 替换，三容器 healthy。
- [x] 本机 /ready 成功。
- [x] 修正安全组绑定，电脑 TCP 8080 测试成功。
- [x] 微信工具 Console 确认为 develop。
- [ ] 最终公网 /ready 成功记录归档。
- [ ] 真实微信登录、AI 走棋、历史续局验收归档。
- [ ] 当前测试号的第二账号授权可行性确认。
- [ ] 两账号私人房间、同步、悔棋、重连及终局验收。
- [ ] 离机数据库备份与恢复演练。

### 14.2 正式上线之前

更换受支持 OS，准备符合实际地区/业务要求的云资源、域名和备案；配置可信 HTTPS 与微信 request 合法域名，选择可管理开发成员的小程序账号；分别填写 test/production 地址，并通过项目发布检查和真实设备验收。私密数据使用 HTTPS，数据库仍保留内网访问。

完整的正式 HTTPS 规划见 [阿里云正式部署方案](superpowers/plans/2026-10-07-aliyun-deployment.md)。当前文档是学生 ECS 开发测试全流程，不将 HTTP/IP 或个人测试号视为正式发布完成。
