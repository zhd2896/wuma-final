# 学生 ECS 公网 IP 开发测试教程

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 GitHub 部署现有后端到学生 ECS，以 HTTP 公网 IP 接口完成微信开发工具和两账号联机开发测试。

**Architecture:** 小程序开发版 → HTTP 公网 IP:8080 → Nginx → FastAPI/Node 引擎 → MySQL。复用 compose.yml，仅 Nginx 公开端口。

**Tech Stack:** Docker Compose、Python 3.12、Node 24、MySQL 8.4、Nginx、微信开发者工具。

## 使用范围

无域名无证书的开发调试方案。不是体验版/正式版发布。项目 development 允许 HTTP/IP，test/production 则主动要求 HTTPS DNS 域名；不要运行 configure:release 写入 IP。手机必须使用实际调试流程并核对 envVersion=develop。

服务器终端执行 Linux 命令；本地 Windows PowerShell 只执行标注的本地命令。全程不需要在宿主机单独装 Node、Python、MySQL，运行时都在 Docker 镜像中。

## 1. 确认 ECS 系统

- [ ] 在已连接的服务器执行：

```bash
cat /etc/os-release
uname -m
free -h
df -h
sudo ss -lntp
```

用户最终更正服务器为 CentOS 7.9，以本次更正为准。下面优先使用 CentOS 7.9 分支，保留其他分支供更换系统后使用。已有 Docker 正常工作则跳过安装，不清除已有容器与卷。

## 2. 安装 Docker 与 Git（按实际系统选一个分支）

### CentOS 7.9（当前用户系统）

CentOS 7 已于 2024-06-30 停止维护；此分支仅用于当前受控开发测试。Docker 官方 EL7 存档仍提供旧安装包，软件源可用不表示仍有安全维护；项目当前容器栈在此旧内核上需实际验证。

```bash
cat /etc/centos-release
uname -r
uname -m
sudo yum install -y yum-utils git curl openssl nano
sudo yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
sudo yum makecache
sudo yum list docker-ce docker-ce-cli docker-compose-plugin --showduplicates
```

先确认 yum 元数据可用，再安装 EL7 包；若出现 mirrorlist.centos.org 或 No valid baseurl，先修复 CentOS 7 归档基础源，保留 /etc/yum.repos.d 原配置备份，不使用 EL9 软件包，也不关闭 GPG 检查。Docker 包若已存在不要直接覆盖安装。

```bash
sudo yum install -y docker-ce-26.1.4 docker-ce-cli-26.1.4 containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
sudo docker run --rm hello-world
```

上述 pin 以 EL7 源实际列出的 26.1.4 版本为前提，不强行安装找不到的版本。后续沿用第 3 节 GitHub 拉取和部署。容器启动失败应检查旧内核、架构、资源和 SELinux，不能仅凭 Docker 安装成功宣称整套后端兼容。

来源：[CentOS 生命周期](https://www.centos.org/centos-linux/)、[Docker EL7 包存档](https://download.docker.com/linux/centos/7/x86_64/stable/Packages/)。

### CentOS Stream 9（当前用户优先核对的分支）

全新服务器执行：

```bash
sudo dnf install -y dnf-plugins-core git curl openssl nano
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

如官方源不可达，可用阿里云 CentOS Docker CE 软件源替代；选择替代源时不要重复添加多个 docker-ce 源：

```bash
sudo curl -fsSL https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo -o /etc/yum.repos.d/docker-ce.repo
sudo dnf makecache
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

不安装 Alibaba Cloud Linux 专用的 releasever-adapter 插件。若出现发行版目录 404，先核对 /etc/os-release 及 dnf repolist，不直接覆盖整个系统的 releasever。官方支持范围与安装依据：[Docker CentOS 安装](https://docs.docker.com/engine/install/centos/)。

CentOS 启用 SELinux 时，如后续 Nginx bind mount 报 Permission denied，先检查 getenforce 与 sudo ls -lZ deploy/nginx/conf.d/local.conf，确认 AVC 拒绝后为 Compose 中对应私有配置 bind mount 添加 :ro,Z（仅限本栈独占文件），再重建 Nginx。不全局关闭 SELinux。

### Ubuntu

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

官方 Docker 软件源不可达时，使用阿里云官方安装文档中 Ubuntu 分支的 ECS 内网镜像源，不能改用 CentOS 源。

### Alibaba Cloud Linux 3

```bash
sudo dnf install -y git curl wget openssl
sudo wget -O /etc/yum.repos.d/docker-ce.repo http://mirrors.cloud.aliyuncs.com/docker-ce/linux/centos/docker-ce.repo
sudo sed -i 's|https://mirrors.aliyun.com|http://mirrors.cloud.aliyuncs.com|g' /etc/yum.repos.d/docker-ce.repo
sudo dnf -y install dnf-plugin-releasever-adapter --repo alinux3-plus
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 所有系统均执行

```bash
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
sudo docker run --rm hello-world
```

最后一条拉取失败但前两条正常时，通常是镜像网络问题，进入故障排查。

来源：[Docker Ubuntu 安装](https://docs.docker.com/engine/install/ubuntu/)、[阿里云各系统 Docker 安装](https://help.aliyun.com/zh/ecs/user-guide/install-and-use-docker)。

## 3. 从 GitHub 拉取

- [ ] 确认待部署代码已经提交并推送。当前本地工作区有未提交业务修改，服务器 clone 不会获得这些修改；本教程不自动提交其他人的工作。
- [ ] 服务器执行：

```bash
sudo mkdir -p /opt/wuma
sudo chown "$(id -un):$(id -gn)" /opt/wuma
git clone https://github.com/zhd2896/wuma-final.git /opt/wuma
cd /opt/wuma
git log -1 --oneline
git status --short
test -f compose.yml
test -f backend/Dockerfile
test -d miniprogram/domain
test -d miniprogram/ai
```

clone 目标目录必须为空。私有仓库使用只读 deploy key 或受控认证，不能把 PAT 嵌入 URL。GitHub HTTPS 不接受普通账号密码；Permission denied/Repository not found 先检查访问权限。

## 4. 配置 .env

```bash
cd /opt/wuma
umask 077
cp .env.example .env
chmod 600 .env
openssl rand -hex 24
openssl rand -hex 24
nano .env
```

无 nano 时用 vi .env：按 i 编辑，Esc 后输入 :wq 回车保存。两个随机输出分别作为应用和 root 密码；不共享、不提交。

- [ ] 修改以下字段，其余模板字段保留：

```dotenv
COMPOSE_PROJECT_NAME=wuma-dev
BACKEND_IMAGE=wuma-backend:dev-20261007
WUMA_ENV=development
DATABASE_URL=
DB_NAME=wuma_dev
DB_USER=wuma
DB_PASSWORD=替换为第一个随机密码
DB_ROOT_PASSWORD=替换为第二个随机密码
NGINX_BIND_ADDRESS=0.0.0.0
HTTP_PORT=8080
HTTPS_PORT=8443
NGINX_CONFIG=./deploy/nginx/conf.d/local.conf
TLS_CERT_DIR=./deploy/nginx/empty-certs
WECHAT_APP_ID=实际小程序AppID
WECHAT_APP_SECRET=实际小程序AppSecret
AUTH_SESSION_DAYS=7
LLM_API_KEY=
LLM_BASE_URL=
LLM_MODEL=
```

WECHAT_APP_ID 与本地 project.config.json 一致，不能用无权限的仓库 AppID。当前 local.conf 不监听 TLS，8443 映射暂不提供服务，不必在安全组放行。WUMA_ENV 是服务配置，微信 develop/trial/release 由小程序运行环境决定。

## 5. 构建、启动与本机验证

```bash
cd /opt/wuma
sudo docker compose config --quiet
sudo docker compose pull mysql nginx
sudo docker compose build backend
sudo docker compose up -d --wait --wait-timeout 300
sudo docker compose ps
sudo docker compose exec -T nginx nginx -t
curl --fail http://127.0.0.1:8080/health
curl --fail http://127.0.0.1:8080/ready
sudo docker compose exec -T backend alembic -c /app/backend/alembic.ini current
sudo docker compose exec -T backend alembic -c /app/backend/alembic.ini heads
```

预期三个容器健康，Nginx 配置正常，current=head。后端自动迁移，当前代码 head 为 0019_user_profiles，拉取版本以 heads 为准。/health 测引擎，/ready 同时测数据库连接，不等同于业务完整通过。

构建较久应等待输出；配置错误不会因重复 up 自动消失。

## 6. 阿里云入站规则与公网验证

- [ ] ECS 控制台 → 实例 → 安全组 → 入方向添加 TCP 8080/8080，来源优先测试者公网 IP /32。手机网络出口不固定时，可临时使用 0.0.0.0/0，测试后收窄或关闭。
- [ ] 不公开 3306/8000。若系统自带防火墙已经启用，添加相同测试端口允许规则；不为了排查直接停掉整个防火墙。Docker 映射端口可能绕过 UFW，云安全组仍需正确控制。
- [ ] 本地 PowerShell 测试，替换真实公网 IP：

```powershell
curl.exe --fail http://服务器公网IP:8080/health
curl.exe --fail http://服务器公网IP:8080/ready
```

仅看浏览器根路径 / 得到 404 不能判断失败，测试 /ready。使用公网 IP，不能用 ECS 的 172.x/10.x 私网地址。

来源：[阿里云安全组](https://help.aliyun.com/zh/ecs/user-guide/start-using-security-groups)。HTTP token 以明文传输，仅用于受控开发测试账号。

## 7. 本地小程序设置

- [ ] 本地 Windows PowerShell 执行：

```powershell
Set-Location 'E:\C盘Doucment\ChatGPT\wuma最终版'
npm ci
```

需要本地 Node 24+；不要在 ECS 运行小程序开发者工具。

- [ ] 仅修改 miniprogram/config/api-roots.ts 中 development：

```typescript
export const API_BASE_URLS = {
  development: 'http://服务器公网IP:8080',
  test: '',
  production: '',
} as const;
```

地址不加 /api/v1，因为请求代码会拼接路径。前端不填写 AppSecret。IP 尚未提供，本教程没有直接替换实际项目地址。

- [ ] 微信开发者工具导入仓库根目录（project.config.json 所在位置），选择实际 AppID。
- [ ] 详情 → 本地设置 → 勾选“不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书”，名称以工具版本为准。
- [ ] 编译，Console 执行：

```javascript
wx.getAccountInfoSync().miniProgram.envVersion
wx.request({
  url: 'http://服务器公网IP:8080/ready',
  success: res => console.log(res.statusCode, res.data),
  fail: err => console.error(err)
})
```

预期 develop、HTTP 200。Network 中实际请求应为公网 IP，不能仍指向 127.0.0.1。

## 8. 微信登录和 AI 测试

- [ ] 点项目登录按钮，完成真实微信登录，不手工伪造身份。
- [ ] 服务器观察日志：

```bash
cd /opt/wuma
sudo docker compose logs -f --tail=100 backend
```

Ctrl+C 仅退出日志查看，不停止服务。

- [ ] 首先创建 AI 入门对局，走棋、退出、从历史续局；再检查标准/进阶、教练提示、结束后复盘。以 AI 验证完整读写链路后，再做双账号联机。

WECHAT_NOT_CONFIGURED 核查密钥是否实际注入，修改 .env 后执行 sudo docker compose up -d --force-recreate backend。单纯 restart 不会重新读取 Compose 环境变量。

## 9. 两账号联机测试

- [ ] 使用 A、B 两个不同微信账号，均有项目开发/测试权限；推荐两台电脑的开发工具分别登录 A、B。复制一个项目或窗口不保证变成两个微信身份。
- [ ] 或 A 用电脑模拟器，B 用另一账号手机真机调试；若使用两台手机，可分别从两套开发工具会话启动真机调试。
- [ ] 两端加载同一份开发配置，实际连接同一个公网 IP 和数据库，并分别点项目微信登录按钮。
- [ ] A 进入远程双人创建私人房间，记录 8 位房间码；B 进入远程双人输入房间码加入。
- [ ] A/B 轮流走 3–5 步，核对双方落子、备用棋、当前行棋方；再测试悔棋、认输、终局历史、本人复盘。
- [ ] 暂时断开 B 网络再恢复，验证继续对局；重开小程序，同账号重新登录，核对本人席位恢复。
- [ ] 私人房间通过后，再测试公开匹配。

## 10. 真机注意点

使用开发工具“真机调试”或开发预览中的手机调试模式。手机端如仍校验域名，确认调试开关、重新进入调试会话；电脑勾选不代表所有手机运行模式自动豁免。需用实际 wx.request 验证。

在真机 Console 核对 envVersion。如果是 trial，会读 test 而不是 development，项目将拒绝 IP 地址；不要靠填写 test=HTTP/IP 绕过。当前流程不上传体验版作为主要测试手段。

来源：[微信网络文档](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)、[腾讯官方小程序平台开发指南](https://main.qcloudimg.com/raw/document/product/pdf/1593_91178_cn.pdf)。

## 11. 更新与故障排查

后续先确保本地变更已推送，在服务器执行：

```bash
cd /opt/wuma
git status --short
git pull --ff-only
sudo docker compose build backend
sudo docker compose up -d --wait --wait-timeout 300
curl --fail http://127.0.0.1:8080/ready
```

git pull 有冲突先处理，不用 reset --hard 丢弃文件；涉及数据库迁移先备份。保持项目名和数据库卷，不运行 down -v。

常用诊断：

```bash
sudo docker compose ps
sudo docker compose logs --tail=100 mysql
sudo docker compose logs --tail=100 backend
sudo docker compose logs --tail=100 nginx
sudo docker stats --no-stream
```

| 故障 | 优先检查 |
| --- | --- |
| apt/dnf 报命令不存在 | 是否用了错误 OS 分支 |
| GitHub 拉取失败 | DNS/出口/私有权限，普通密码不能登录 GitHub Git |
| Docker pull 超时 | Docker Hub 网络；用当前账号 ACR 加速/可信镜像库或本地 docker save/load |
| manifest unknown | 精确固定标签是否存在；先确认，不全部改 latest |
| pip 下载失败 | 包源连接，属于构建问题不是小程序问题 |
| 容器进程被 killed | free -h / docker stats，学生机内存是否不足 |
| 本机 /ready 好、公网不通 | 安全组、0.0.0.0 绑定、端口、公网 IP、防火墙 |
| /health 好、/ready 失败 | DB 环境变量、旧卷密码、迁移日志 |
| 小程序提示服务未开放 | envVersion 非 develop 或地址非法 |
| 同账号无法占第二席位 | 两端是否其实使用同一账号 |
| 登录 HTTP 429 | 模板按 IP 限流 5 次/分钟，停止反复点登录等待重试 |

## 完成条件

- [ ] 三容器健康，数据库迁移版本正确。
- [ ] 电脑和手机实际能访问公网 IP 的 /ready。
- [ ] 真实微信登录、AI 对局与续局通过。
- [ ] 两不同账号完成远程对战及断网恢复。
- [ ] 记录源码版本、设备、测试结果和问题。

本教程只写入文档，未连接 ECS、未提交/推送未提交业务文件、未执行远程部署。
