# 微信体验版与正式版发布准备

当前尚未部署。开发地址仍是 `http://127.0.0.1:8000`，`test` 和 `production` 为空；公开 AppID 保留仓库现有值。自动检查通过表示代码与输入格式通过验证，不表示 HTTPS 服务、微信登录或真机已经可用。

## 公开构建配置

地址保存在 `miniprogram/config/api-roots.ts`，不包含密钥。原生小程序通过 `envVersion` 选择地址：`develop → development`、`trial → test`、`release → production`。

```powershell
npm run check:release -- development
npm run check:release -- trial
npm run check:release -- release
```

当前后两条命令预期失败，表示部署配置待办。准备好真实 HTTPS API 后，可以先仅检查输入，再生成公开构建配置：

```powershell
# 以下域名是格式示例；必须替换为自己的实际部署地址，不能据此宣称服务可用。
npm run check:release -- trial --api-root https://api.example.com/wuma
npm run configure:release -- trial --api-root https://api.example.com/wuma
npm run check:release -- trial
```

正式版使用相同命令的 `release` 目标。审查 `api-roots.ts` 差异后在微信开发者工具构建对应版本。脚本只写公开地址，不上传、不部署、不读取本地密钥，不改 AppID。检查 AppID 时默认读取 `project.config.json` 的公开值；可通过 `--appid` 仅检查另一个公开 AppID，但实际切换应同步项目和后端配置。地址须为非空 HTTPS DNS 地址；拒绝本机/IP 地址、userinfo、查询参数、fragment、非法端口与路径。部署路径前缀保留，例如 `/wuma/api/v1/...`。

空或非法 trial/release 配置会返回登录页，显示“服务暂未开放，请稍后再试”，不会发微信登录或业务请求。

## 后端、反向代理与微信后台

按照 [Docker 部署文档](deployment.md)准备 HTTPS 入口和数据库，在后端环境设置 `WECHAT_APP_ID` 与 `WECHAT_APP_SECRET`。AppID 必须对应小程序项目；AppSecret 只在服务器配置，无须提供给本工具或放入前端。已有数据库备份后运行 `python -m alembic -c backend/alembic.ini upgrade head`，当前 head 为 `0019_user_profiles`。

若外部地址包含 `/wuma`，反向代理剥掉这个前缀后转发到后端根路由。例如配置在已有 HTTPS server 中：

```nginx
location /wuma/ {
    proxy_pass http://backend:8000/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

配置有效证书，在微信小程序后台配置该 API 的 request 合法域名（域名而非部署路径），并在真实发布构建启用域名校验。当前开发工具的 `urlCheck: false` 只适用于本地调试；生产配置需人工确认。检查 HTTPS `/wuma/health` 和 `/wuma/ready`，并验证经过代理的微信登录、API 和错误响应。格式预检不会检查域名归属、证书、服务在线、微信后台合法域名或服务器密钥。

## 发布前人工验收

使用两个不同微信账号、两台设备，并追加同账号换设备测试：

1. 显式微信登录；修改昵称与士/馬/炮头像，退出重登、换设备后资料保留。登录不读取微信昵称头像。检查失效会话回登录和保存失败可重试。
2. 两账号建房、加入、轮流落子；断网、重新打开和跨设备恢复本人席位。对方不能访问私有训练。REMOTE 归属使用房间 host/guest 参与者，普通 `Game.user_id` 可以为空。
3. 联机悔棋申请/同意/拒绝、认输和自然终局；历史正确显示本人席位及胜负，进入本人复盘，按时间轴回放；查看解释并生成私有训练，重登可恢复学习记录。
4. AI 三档开局/恢复与历史；三级教练、本地/云端局面分析；本地完整棋谱同步失败保留记录和迁移凭据，原账号原地址重试。
5. 分别构建 trial/release，确认实际选用对应 HTTPS 地址和保留部署前缀；留存微信开发者工具与真机结果。精选题当前只有三道、引擎估计均为 COMPLEX，不代表经过人类难度校准或完整覆盖所有难度。

这些人工步骤尚未执行。自动测试、真实隔离 MySQL 迁移/持久化与最终授权竞态结果见 [阶段9验收](../results/staged-phase9-acceptance.md)，当前阶段完成状态见 [分阶段进度](staged-feature-progress.md)。
