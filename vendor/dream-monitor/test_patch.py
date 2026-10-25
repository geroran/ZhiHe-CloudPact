"""dream-monitor 二开补丁测试（不访问上游、不需要账号）。

覆盖：
  1. /api/me、/api/state 未登录时返回 401 + need_login；
  2. /api/signup、/api/cancel、/api/token 已被禁用（403 readonly）；
  3. 看板 state() 不再包含顶层 token（包括 token 为空的情况）；
  4. 会话 Cookie 在 HTTPS 部署下可带 Secure。

运行：python vendor/dream-monitor/test_patch.py
"""

from __future__ import annotations

import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace

import gui_server


def _http(method: str, url: str, body: bytes | None = None):
    req = urllib.request.Request(url, data=body, method=method)
    if body is not None:
        req.add_header("content-type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8") or "{}"), resp.headers
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}"), e.headers


class PatchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory(prefix="dm_patch_test_")
        gui_server.DATA_DIR = Path(cls.tmp.name)
        gui_server.USERS = gui_server.Users(Path(cls.tmp.name))
        gui_server.BASE_CFG = {}
        cls.httpd = gui_server.Server(("127.0.0.1", 0), gui_server.Handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_port}"
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.tmp.cleanup()

    # ---------------------------------------------------------- 会话
    def test_me_requires_login(self) -> None:
        status, body, _ = _http("GET", f"{self.base}/api/me")
        self.assertEqual(status, 401)
        self.assertTrue(body.get("need_login"))

    def test_state_requires_login(self) -> None:
        status, body, _ = _http("GET", f"{self.base}/api/state")
        self.assertEqual(status, 401)
        self.assertTrue(body.get("need_login"))

    # ---------------------------------------------------------- 只读
    def test_write_endpoints_disabled(self) -> None:
        for path in ("/api/signup", "/api/cancel", "/api/token"):
            status, body, _ = _http("POST", f"{self.base}{path}", b'{"aid":"1"}')
            self.assertEqual(status, 403, path)
            self.assertEqual(body.get("code"), "readonly", path)

    def test_unknown_post_requires_login_first(self) -> None:
        # 未登录时未知 POST 先被会话闸门拦下（上游原有顺序），不会触达任何写逻辑。
        status, body, _ = _http("POST", f"{self.base}/api/unknown", b"{}")
        self.assertEqual(status, 401)
        self.assertTrue(body.get("need_login"))

    # ---------------------------------------------------------- token
    def _fake_hub(self, token: str):
        hub = gui_server.Hub.__new__(gui_server.Hub)
        hub.uid = "10001"
        hub.account = "demo-account"
        hub.name = "演示用户"
        hub.school = "云南大学"
        hub.avatar = ""
        hub.busy = False
        hub.enriching = False
        hub.last_sync = time.time()
        hub.sent = 0
        hub.logs = []
        hub.items = []
        hub.places = {}
        hub.token_job = None
        hub.lock = threading.Lock()
        hub.cfg = {"api": {"token": token}}
        hub.mon = SimpleNamespace(progress={}, auth_stale=False, auth_msg="", status_map={})
        hub._mine_cache = [{"aid": "__none__", "signup_id": ""}]
        hub.mine_at = time.time()
        return hub

    def test_state_never_contains_token(self) -> None:
        for token in ("UPSTREAM_SECRET_TOKEN", ""):
            data = gui_server.Hub.state(self._fake_hub(token))
            self.assertNotIn("token", data, f"token={token!r} 时仍返回顶层 token")
            self.assertNotIn("UPSTREAM_SECRET_TOKEN", json.dumps(data, ensure_ascii=False))

    # ---------------------------------------------------------- Cookie
    def test_cookie_flags(self) -> None:
        original = gui_server.COOKIE_SECURE
        try:
            gui_server.COOKIE_SECURE = False
            cookie = gui_server.Handler._session_cookie("sid123", 2592000)
            self.assertIn("HttpOnly", cookie)
            self.assertIn("SameSite=Lax", cookie)
            self.assertNotIn("Secure", cookie)

            gui_server.COOKIE_SECURE = True
            cookie = gui_server.Handler._session_cookie("sid123", 2592000)
            self.assertIn("Secure", cookie)
        finally:
            gui_server.COOKIE_SECURE = original


if __name__ == "__main__":
    unittest.main(verbosity=2)
