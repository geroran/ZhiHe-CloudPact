# 服务器部署

访问入口：`https://agent-server.ynu.edu.cn/zhihe/`。

应用目录为 `/opt/zhihe-yunqi`，Python 虚拟环境为 `/opt/zhihe-yunqi-venv`。
部署当前工作区构建结果，包含尚未提交的功能；不自动提交代码。

## 构建与配置

构建时设置 `VITE_AGENT_TRANSPORT=proxy`，并清空 `VITE_AGENT_APP_ID`、
`VITE_AGENT_API_KEY`。前端无需持有智能体密钥，Node 代理从服务端读取凭据。
传输前检查构建产物，确认不包含本地配置中的密钥。

仅上传 `dist/`、`server/`、`scripts/`、`vendor/dream-monitor/`、`deploy/`、
`package.json`、`package-lock.json` 和 `requirements.txt`。
服务端私有配置另传 `.env.local`、`.env.market`，权限设为 0600，归属 `zhihe`。
不要上传本机到梦空间的 `data/`、会话数据库或个人登录配置。
服务器上禁用本机 `EHALL_PROXY`，到梦空间从空配置初始化。

安装 Node 正式依赖以及两个 Python requirements；首次初始化到梦空间时，
从 `config.example.yaml` 生成 `config.yaml`，设置 `notify: {}`、
`api.auto_relogin: false`、`auto_signup.enabled: false`。

当前锁文件包含本机链接的 Vite 开发依赖，服务器只安装运行依赖：
`npm install --package-lock=false --ignore-scripts --omit=dev --no-audit --no-fund undici@8.12.3`。
到梦空间启动命令显式指定 `--port 8770`，避免上游默认端口与已有应用冲突。

## 服务管理

使用专用 `zhihe` 系统用户，将 `zhihe-yunqi@.service` 安装到
`/etc/systemd/system/`，启用以下实例：

```bash
systemctl daemon-reload
systemctl enable --now zhihe-yunqi@{api,agent,courses,dream}
systemctl status zhihe-yunqi@{api,agent,courses,dream}
journalctl -u zhihe-yunqi@api -n 50 --no-pager
```

四个后端只监听回环地址，端口分别为 8011、8788、8787、8770。
到梦空间数据保留在 `vendor/dream-monitor/data/`，更新代码时必须保留。

## 网关

将 `nginx.locations.conf` 作为 include 加入现有
`/etc/nginx/sites-available/hiagent-ynu` 的 server 块。
修改前备份原文件，先运行 `nginx -t`，成功后才 reload。
复用已有 `/hiagent/` 空教室代理，不更改其他应用入口。

当前前端使用同源绝对 `/api/*` 路径，因此仅将本应用使用的明确接口转发至
对应服务，其余网关路径保持现有处理逻辑。
公网 HTTPS 由现有学校网关提供，故到梦空间设置 `DM_COOKIE_SECURE=1`。

验收首页、构建静态资源、健康接口、AI 配置查询及到梦空间未登录响应。
上游凭据过期或上游网络失败应保留真实错误，不用模拟结果替代。
