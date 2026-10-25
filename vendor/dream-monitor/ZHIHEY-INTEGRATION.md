# 到梦空间模块：真实 dream-monitor 后端的接入说明

本目录是上游 `dream-monitor` 网页服务的**锁定版本源码**，供“智启云聚”的到梦空间活动查询模块（`src/modules/dreamspace-events/`）在本机跑真实后端。

## 1. 上游来源与版本

| 项 | 值 |
|---|---|
| 仓库 | `LinXiaoAn7/dream-monitor`（https://github.com/LinXiaoAn7/dream-monitor） |
| 版本 | `2.1.0`（见 `VERSION`） |
| 锁定提交 | `91b5c3d763a297c37d471298709f6ae4c83ce4eb`（2026-10-21） |
| 取用方式 | 通过 GitHub 连接器按提交 SHA 逐个文件读取后落到本目录；未使用仓库历史里的演示账号/凭据 |
| 本机监听 | `http://127.0.0.1:8770`（默认） |

未引入上游的 `ui/`、`hook*.js`、`tools/` 等逆向取证与演示文件；网页界面由本项目前端提供，后端只提供 `/api/*`。

## 2. 本项目所做的必要修改（相对上游）

修改集中在 `gui_server.py`：

1. **删除 `/api/state` 顶层 `token` 字段**（包括 token 为空的情况）。上游原实现会把上游 token 返回给浏览器，属于凭据泄露；前端 `api.js` 仍保留硬校验，只要响应里出现 `token` 键就拒绝读取。
2. **禁用写操作与强制重登**：`/api/signup`、`/api/cancel`、`/api/token` 一律返回 `403 {"code":"readonly"}`，对应规格“只查询，不报名/不取消/不自动重登”。`Hub` 内部保留的上游方法不会被路由调用。
3. **Cookie 可选 `Secure`**：新增环境变量 `DM_COOKIE_SECURE=1`，在 HTTPS 部署时给 `dms` Cookie 加 `Secure`；本地 HTTP 调试保持关闭。Cookie 其余属性不变（`HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`）。
4. **启动方式**：新增 `scripts/dream-monitor.py` 启动器，把工作目录切到本目录，保证 `config.yaml`、`data/` 相对路径一致；默认只监听 `127.0.0.1`、不自动打开浏览器。

另新增（不改上游逻辑）：

- `requirements.txt`：最小运行依赖 `requests`、`PyYAML`。
- `test_patch.py`：不访问上游、不需要账号的补丁测试（401、只读 403、state 无 token、Cookie 开关）。
- `config.yaml`（本地生成，Git 忽略）：`notify` 置空、`auto_signup` 关闭，其余沿用上游默认。

上游原有的查询接口保持不动：`/api/me`、`/api/login`、`/api/logout`、`/api/state`、`/api/refresh`、`/api/activity?aid=`。此外还有 `/api/mine`、`/api/profile`、`/api/score` 等只读接口，本项目前端不调用。

## 3. 依赖与首次配置

要求 Python 3.10+（本机验证 3.13）与 `requests`、`PyYAML`：

```powershell
python -m pip install -r vendor/dream-monitor/requirements.txt
```

配置（`config.yaml` 已被 Git 忽略，不会提交）：

```powershell
copy vendor/dream-monitor/config.example.yaml vendor/dream-monitor/config.yaml
```

在本项目中，`config.yaml` 只需要保证：`api.version` 有值、`auto_relogin: false`、`notify: {}`、`auto_signup.enabled: false`。
**不要**在这里填写账号密码：每个访客在网页上用自己的到梦空间账号登录。

## 4. 启动与停止

```powershell
# 1) 真实后端（默认 127.0.0.1:8770，工作目录自动切到 vendor/dream-monitor）
npm run dev:dream-monitor

# 2) 前端（默认 127.0.0.1:8000）
npm run dev
```

打开 `http://127.0.0.1:8000/#/dreamspace-events`。

- 开发期由 Vite 把六个精确路径代理到 `DREAM_MONITOR_TARGET`（默认 `http://127.0.0.1:8770`，可在 `.env.local` 覆盖）：

  ```
  DREAM_MONITOR_TARGET=http://127.0.0.1:8770
  ```

- 停止：在两个终端分别按 `Ctrl+C`；或用任务管理器结束对应 `python` / `node` 进程。
- 换端口：`python scripts/dream-monitor.py --port 8771`，同时把 `.env.local` 的 `DREAM_MONITOR_TARGET` 改成对应地址。

## 5. 数据目录与安全

| 路径 | 内容 | 是否入库 |
|---|---|---|
| `data/users.db` | 账号、加密密码、会话 | 否（`data/` 被 `.gitignore` 忽略） |
| `data/secret.key` | 本机 AES-256 密钥，首次启动自动生成 | 否 |
| `data/users/<uid>.db` | 每个账号各自的活动库 | 否 |
| `data/shared_details.db` | 活动详情共享缓存 | 否 |
| `data/identity.json` | 设备指纹（uuid/jPushId），首次启动自动生成 | 否 |
| `config.yaml` | 本地运行配置 | 否 |

- 删除 `data/` 即可重置所有会话与缓存的账号数据。
- 密码在本机加密后可解密（用于 token 失效后续期），因此 `data/` 属于敏感目录：限制访问权限，不要打包分享。
- 浏览器只拿到 `HttpOnly` 会话 Cookie，拿不到上游 token、密码或签名。
- 生产部署请使用 HTTPS，并设置 `DM_COOKIE_SECURE=1`。

## 6. 生产环境的同源反向代理

前端始终请求同源的 `/api/*`，生产环境需要把同样六个路径转发到 dream-monitor（顺序在同域 `/api` 之前）：

```nginx
location ~ ^/api/(me|login|logout|state|refresh|activity)$ {
    proxy_pass http://127.0.0.1:8770;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/ {
    proxy_pass http://127.0.0.1:8787;   # 其他模块的 Node 代理
}
```

## 7. 验证

```powershell
# 后端补丁测试（无需账号、不访问上游）
npm run test:dream-backend

# 前端 API / 纯逻辑测试
npm run test:dreamspace
```

真实登录验收：在页面输入**经授权**的到梦空间账号密码，确认能读取真实活动列表、打开详情、刷新并退出。不要使用模拟数据替代真实查询结果。
