#!/usr/bin/env python3
"""dream-monitor 网页 API 契约测试桩（仅用于本地端到端测试，不属于产品代码）。

模拟规格 3 节的同源接口：登录、会话、状态、刷新、详情、退出。
测试数据只存在于本测试桩，不会被打包进应用，也不作为演示数据。

运行：
    python dev/dreamspace-events/fixture_server.py
然后访问：
    http://127.0.0.1:8899/dev/dreamspace-events/harness.html
"""

import json
import mimetypes
import threading
import time
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parents[2]
HOST = "127.0.0.1"
PORT = 8899
SESSION = "dms-fixture-session"
ACCOUNT = "test-account"
PASSWORD = "test-password"

LOCK = threading.Lock()
HITS = Counter()
MODES = {"leak_token": False}
REFRESH = {"busy": False, "progress": None, "last_sync": time.time() - 8.2}


def state_snapshot():
    now = time.time()
    with LOCK:
        busy = REFRESH["busy"]
        progress = dict(REFRESH["progress"]) if REFRESH["progress"] else None
        last_sync = REFRESH["last_sync"]
        leak_token = MODES["leak_token"]

    items = [
        {
            "aid": "1001",
            "name": "校园马拉松志愿者招募",
            "state": "open",
            "status_raw": 3,
            "quota": 18,
            "joined": 32,
            "capacity": 50,
            "category": "志愿服务",
            "organizer": "云南大学团委",
            "sign_start": now - 7200,
            "sign_end": now + 172800,
            "act_start": now + 259200,
            "credit": "1",
            "address": "呈贡校区田径场",
            "joined_by_me": False,
            "signup_id": "",
        },
        {
            "aid": "1002",
            "name": "创新创业讲座：从想法到落地",
            "state": "open",
            "status_raw": 3,
            "quota": -1,
            "joined": 88,
            "capacity": None,
            "category": "讲座",
            "organizer": "创新创业学院",
            "sign_start": now - 3600,
            "sign_end": now + 86400,
            "act_start": now + 172800,
            "credit": "0.5",
            "address": "科学馆 101",
            "joined_by_me": False,
            "signup_id": "",
        },
        {
            "aid": "1003",
            "name": "篮球联赛决赛",
            "state": "full",
            "status_raw": 3,
            "quota": 0,
            "joined": 50,
            "capacity": 50,
            "category": "体育",
            "organizer": "体育学院",
            "sign_start": now - 86400,
            "sign_end": now + 3600,
            "act_start": now + 7200,
            "credit": "1",
            "address": "体育馆",
            "joined_by_me": False,
            "signup_id": "",
        },
        {
            "aid": "1004",
            "name": "图书馆志愿整理",
            "state": "soon",
            "status_raw": 1,
            "quota": -2,
            "joined": None,
            "capacity": None,
            "category": "志愿服务",
            "organizer": "图书馆",
            "sign_start": now + 3600,
            "sign_end": now + 259200,
            "act_start": now + 345600,
            "credit": None,
            "address": "东陆校区图书馆",
            "joined_by_me": False,
            "signup_id": "",
        },
        {
            "aid": "1005",
            "name": "AI 应用分享会",
            "state": "running",
            "status_raw": 4,
            "quota": 5,
            "joined": 45,
            "capacity": 50,
            "category": "学术",
            "organizer": "信息学院",
            "sign_start": now - 172800,
            "sign_end": now - 3600,
            "act_start": now - 1800,
            "credit": "1.5",
            "address": "信息楼 302",
            "joined_by_me": True,
            "signup_id": "9001",
        },
        {
            "aid": "1006",
            "name": "音乐节志愿者",
            "state": "unknown",
            "status_raw": 99,
            "quota": 12,
            "joined": 8,
            "capacity": 20,
            "category": "文体",
            "organizer": "校学生会",
            "sign_start": now + 600,
            "sign_end": now + 90000,
            "act_start": now + 100000,
            "credit": None,
            "address": "呈贡校区广场",
            "joined_by_me": False,
            "signup_id": "",
        },
        {
            "aid": "1007",
            "name": "详情接口异常测试活动",
            "state": "open",
            "status_raw": 3,
            "quota": 3,
            "joined": 7,
            "capacity": 10,
            "category": "测试",
            "organizer": "测试桩",
            "sign_start": now - 600,
            "sign_end": now + 60000,
            "act_start": now + 80000,
            "credit": "0",
            "address": "测试地点",
            "joined_by_me": False,
            "signup_id": "",
        },
    ]

    snapshot = {
        "busy": busy,
        "enriching": False,
        "progress": progress,
        "last_sync": last_sync,
        "stale_secs": max(0.0, now - last_sync),
        "me": {
            "uid": "10001",
            "account": "test-account",
            "name": "测试同学",
            "school": "云南大学",
            "avatar": "https://example.invalid/avatar.png",
        },
        "stats": {
            "total": 10,
            "live": len(items),
            "open": 3,
            "soon": 1,
            "running": 1,
            "ended": 3,
            "sent": 0,
        },
        "items": items,
        "logs": [],
        "token_job": None,
        "mine_warming": False,
        "auth": {"stale": False, "msg": "", "auto": False},
    }
    # 仅测试模式：模拟“后端尚未删除 token”的违规响应，验证前端硬拒绝。
    if leak_token:
        snapshot["token"] = "fixture-upstream-token-must-never-render"
    return snapshot


def activity_detail(aid):
    now = time.time()
    names = {
        "1001": ("校园马拉松志愿者招募", "报名中", "志愿服务"),
        "1002": ("创新创业讲座：从想法到落地", "报名中", "讲座"),
        "1003": ("篮球联赛决赛", "已满", "体育"),
        "1004": ("图书馆志愿整理", "即将开始", "志愿服务"),
        "1005": ("AI 应用分享会", "进行中", "学术"),
        "1006": ("音乐节志愿者", "未知", "文体"),
        "1007": ("详情接口异常测试活动", "报名中", "测试"),
    }
    name, status_text, category = names.get(aid, (f"活动 {aid}", "未知", "未提供"))
    return {
        "activityId": aid,
        "activityName": name,
        "statusText": status_text,
        "joinNum": 32 if aid == "1001" else 8,
        "joinmaxnum": 50 if aid == "1001" else 20,
        "joindate": "2026-10-20 08:00 ~ 2026-10-22 18:00",
        "startdate": "2026-10-25 14:00 ~ 2026-10-25 17:00",
        "startdateDate": int(now + 3600),
        "enddate": "2026-10-25 17:00",
        "schoolname": "云南大学团委",
        "address": "呈贡校区图书馆报告厅",
        "catalog2name": category,
        "levelText": "校级",
        "joinrangeText": "全校学生",
        "joinWayDesc": "报名制：先到先得",
        "countdownText": "距报名截止 2 天",
        "canJoin": True,
        "ableJoinFlag": True,
        "score": "1",
        "signUpId": "9001" if aid == "1005" else "0",
        # 源码说明 injoin 即使未报名也可能为 true；前端不得据此判断。
        "injoin": True,
        "cancel": False,
        "joinCanCancel": False,
        "joinWay": "1",
        "joinStatus": "已报名" if aid == "1005" else "未报名",
        # 规格外的猜测字段：前端必须忽略。
        "imageUrl": "https://example.invalid/should-not-render.png",
        "content": "<p>不应显示的富文本正文</p>",
    }


def refresh_worker():
    for index in range(1, 4):
        time.sleep(0.7)
        with LOCK:
            REFRESH["progress"] = {
                "phase": "list" if index < 2 else "details",
                "done": index,
                "total": 3,
            }
    time.sleep(0.7)
    with LOCK:
        REFRESH["busy"] = False
        REFRESH["progress"] = None
        REFRESH["last_sync"] = time.time()


class Handler(BaseHTTPRequestHandler):
    server_version = "DreamMonitorFixture/1.0"

    def log_message(self, fmt, *args):
        print(f"[fixture] {self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")

    def send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra_headers or []):
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def has_session(self):
        cookie = self.headers.get("Cookie", "")
        for part in cookie.split(";"):
            key, _, value = part.strip().partition("=")
            if key == "dms" and value == SESSION:
                return True
        return False

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if not length:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        with LOCK:
            HITS[path] += 1

        if path == "/api/me":
            if not self.has_session():
                return self.send_json(401, {"error": "未登录", "need_login": True})
            return self.send_json(
                200,
                {"uid": "10001", "hub": True, "name": "测试同学", "school": "云南大学"},
            )

        if path == "/api/state":
            if not self.has_session():
                return self.send_json(401, {"error": "未登录", "need_login": True})
            return self.send_json(200, state_snapshot())

        if path == "/api/activity":
            if not self.has_session():
                return self.send_json(401, {"error": "未登录", "need_login": True})
            query = parse_qs(parsed.query)
            aid = (query.get("aid") or [""])[0].strip()
            if not aid:
                return self.send_json(400, {"error": "缺少 aid"})
            if aid == "1007":
                return self.send_json(500, {"error": "上游请求失败"})
            if aid not in {"1001", "1002", "1003", "1004", "1005", "1006"}:
                return self.send_json(404, {"error": "活动不存在"})
            return self.send_json(200, activity_detail(aid))

        if path == "/__test/hits":
            with LOCK:
                return self.send_json(200, dict(HITS))

        if path == "/__test/mode":
            query = parse_qs(parsed.query)
            if query.get("reset"):
                with LOCK:
                    HITS.clear()
                    MODES["leak_token"] = False
                    REFRESH.update(busy=False, progress=None, last_sync=time.time() - 8.2)
                return self.send_json(200, {"ok": True, "hits_cleared": True})
            if "leak_token" in query:
                value = (query["leak_token"] or ["0"])[0]
                with LOCK:
                    MODES["leak_token"] = value not in {"0", "false", ""}
            with LOCK:
                return self.send_json(200, dict(MODES))

        self.serve_static(path)

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        with LOCK:
            HITS[path] += 1

        if path == "/api/login":
            payload = self.read_json()
            if payload is None:
                return self.send_json(400, {"error": "请求体不是 JSON"})
            account = str(payload.get("account") or "").strip()
            password = str(payload.get("password") or "")
            if not account or not password:
                return self.send_json(400, {"error": "账号和密码不能为空"})
            if account != ACCOUNT or password != PASSWORD:
                return self.send_json(400, {"error": "账号或密码错误"})
            return self.send_json(
                200,
                {"ok": True, "uid": "10001", "kicked_phone": False, "note": "已登录"},
                extra_headers=[
                    ("Set-Cookie", f"dms={SESSION}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000")
                ],
            )

        if path == "/api/logout":
            return self.send_json(
                200,
                {"ok": True},
                extra_headers=[("Set-Cookie", "dms=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")],
            )

        if path == "/api/refresh":
            if not self.has_session():
                return self.send_json(401, {"error": "未登录", "need_login": True})
            started = False
            with LOCK:
                if not REFRESH["busy"]:
                    REFRESH["busy"] = True
                    REFRESH["progress"] = {"phase": "list", "done": 0, "total": 3}
                    started = True
            if started:
                threading.Thread(target=refresh_worker, daemon=True).start()
            return self.send_json(200, {"ok": True, "started": started})

        if path in {"/api/signup", "/api/cancel"}:
            # 若模块误调用写接口，这里留下命中记录供测试断言。
            return self.send_json(405, {"error": "测试桩不提供写操作"})

        self.send_json(404, {"error": "未知 API 路径"})

    def serve_static(self, path):
        if path in {"", "/", "/index.html"}:
            target = ROOT / "dev" / "dreamspace-events" / "harness.html"
        else:
            target = (ROOT / path.lstrip("/")).resolve()
        try:
            target.relative_to(ROOT)
        except ValueError:
            return self.send_json(404, {"error": "路径越界"})
        if not target.is_file():
            return self.send_json(404, {"error": "文件不存在"})

        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)


def main():
    mimetypes.add_type("text/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("dream-monitor 契约测试桩已启动（仅测试，不是真实服务）")
    print(f"  harness: http://{HOST}:{PORT}/dev/dreamspace-events/harness.html")
    print(f"  测试账号: {ACCOUNT} / {PASSWORD}")
    print(f"  token 泄漏模式: http://{HOST}:{PORT}/__test/mode?leak_token=1")
    print(f"  请求计数: http://{HOST}:{PORT}/__test/hits")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
