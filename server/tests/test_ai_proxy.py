"""AI 智能体最小同源代理的单元测试。

不访问真实网络：上游转发函数 `_send` 被替换为固定响应。
"""

from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from server.routes import ai  # noqa: E402

BASE_ENV = {
    "AGENT_TRANSPORT": "proxy",
    "AGENT_ORIGIN": "http://upstream.test",
    "AGENT_APP_ID": "app-id-123",
    "AGENT_API_KEY": "secret-key",
    "AGENT_TIMEOUT_MS": "5000",
}


def make_client() -> TestClient:
    app = FastAPI()
    app.include_router(ai.router)
    return TestClient(app)


def json_bytes(payload) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class AiProxyTest(unittest.TestCase):
    def setUp(self) -> None:
        self.env = patch.dict(os.environ, BASE_ENV, clear=False)
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = make_client()

    def test_direct_mode_does_not_expose_proxy(self) -> None:
        with patch.dict(os.environ, {"AGENT_TRANSPORT": "direct"}):
            response = self.client.post("/api/agent/get_app_config_preview", json={"UserID": "u1"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "NOT_FOUND")

    def test_only_whitelisted_endpoints_are_proxied(self) -> None:
        response = self.client.post(
            "/api/agent/delete_conversation",
            json={"AppConversationID": "c", "UserID": "u1"},
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["error"]["code"], "NOT_FOUND")

    def test_missing_credentials_returns_config_error(self) -> None:
        with patch.dict(os.environ, {"AGENT_API_KEY": ""}):
            response = self.client.post("/api/agent/chat_query_v2", json={"Query": "hi"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "CONFIG_ERROR")

    def test_forwards_credentials_and_returns_upstream_data(self) -> None:
        sender = AsyncMock(return_value=(200, json_bytes({"answer": "真实回答"})))
        with patch.object(ai, "_send", sender):
            response = self.client.post(
                "/api/agent/chat_query_v2",
                json={"Query": "你好", "ResponseMode": "blocking", "UserID": "u1"},
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertEqual(body["data"]["answer"], "真实回答")
        self.assertEqual(response.headers.get("cache-control"), "no-store")

        args = sender.await_args.args
        self.assertEqual(args[0], "http://upstream.test/api/proxy/api/v1/chat_query_v2?appid=app-id-123")
        self.assertEqual(args[1], "secret-key")
        sent = json.loads(args[2].decode("utf-8"))
        self.assertEqual(sent["Query"], "你好")
        self.assertEqual(sent["ResponseMode"], "blocking")

    def test_upstream_error_is_mapped_without_leaking_body(self) -> None:
        sender = AsyncMock(return_value=(500, b"upstream internal detail"))
        with patch.object(ai, "_send", sender):
            response = self.client.post("/api/agent/chat_query_v2", json={"Query": "FAIL"})

        self.assertEqual(response.status_code, 500)
        body = response.json()
        self.assertFalse(body["ok"])
        self.assertEqual(body["error"]["code"], "UPSTREAM_ERROR")
        self.assertNotIn("upstream internal detail", response.text)
        self.assertNotIn("secret-key", response.text)

    def test_upstream_non_json_is_rejected(self) -> None:
        sender = AsyncMock(return_value=(200, b"<html>not json</html>"))
        with patch.object(ai, "_send", sender):
            response = self.client.post("/api/agent/chat_query_v2", json={"Query": "hi"})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "BAD_RESPONSE")

    def test_invalid_request_body(self) -> None:
        response = self.client.post(
            "/api/agent/chat_query_v2",
            content=b"not-json",
            headers={"Content-Type": "application/json"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "INVALID_REQUEST")

    def test_timeout_is_mapped(self) -> None:
        sender = AsyncMock(side_effect=ai.UpstreamTimeout())
        with patch.object(ai, "_send", sender):
            response = self.client.post("/api/agent/chat_query_v2", json={"Query": "hi"})

        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.json()["error"]["code"], "TIMEOUT")
        self.assertTrue(response.json()["error"]["retryable"])

    def test_network_failure_is_mapped(self) -> None:
        sender = AsyncMock(side_effect=ai.UpstreamUnavailable())
        with patch.object(ai, "_send", sender):
            response = self.client.post("/api/agent/chat_query_v2", json={"Query": "hi"})

        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "NETWORK")


if __name__ == "__main__":
    unittest.main()
