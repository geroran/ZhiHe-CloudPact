import json
import sys
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from server.app import build_server  # noqa: E402
from server.config import Config  # noqa: E402
from server.market_agent import ChatService  # noqa: E402
from server.market_service import MarketService  # noqa: E402
from server.model_client import ModelClient  # noqa: E402
from server.routes.market import get_service, router  # noqa: E402


class FakeModelServer:
    def __init__(self):
        self.requests = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt, *args):
                pass

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8"))
                outer.requests.append(
                    {
                        "path": self.path,
                        "authorization": self.headers.get("Authorization"),
                        "body": body,
                    }
                )
                payload = {
                    "choices": [
                        {"message": {"role": "assistant", "content": "FAKE_MODEL_REPLY"}}
                    ]
                }
                raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.stopped = False

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        if self.stopped:
            return
        self.stopped = True
        self.server.shutdown()
        self.server.server_close()


class FakeMarketProvider:
    name = "test-provider"

    def __init__(self, posts=None):
        self.posts = posts or []
        self.calls = []

    def status(self):
        return {"available": True, "provider": self.name}

    def latest(self, limit):
        self.calls.append(("latest", limit))
        return {"posts": self.posts}

    def hot(self, limit):
        self.calls.append(("hot", limit))
        return {"posts": self.posts}

    def search(self, keyword, page, limit):
        self.calls.append(("search", keyword, page, limit))
        return {"posts": self.posts}


class MarketApiTest(unittest.TestCase):
    def setUp(self):
        self.fake_model = FakeModelServer().start()
        self.client = None

    def tearDown(self):
        self.fake_model.stop()

    def start_client(self, market=None, model_configured=True):
        config = Config(
            openai_api_key="test-key" if model_configured else "",
            openai_base_url=f"http://127.0.0.1:{self.fake_model.port}/v1",
            openai_model="test-model" if model_configured else "",
            model_timeout=5,
        )
        service = ChatService(
            config,
            MarketService(market),
            ModelClient(
                api_key=config.openai_api_key,
                base_url=config.openai_base_url,
                model=config.openai_model,
                timeout=5,
            ),
        )
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_service] = lambda: service
        self.client = TestClient(app)
        return service

    def test_config_does_not_expose_secrets(self):
        self.start_client()
        response = self.client.get("/api/config")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["ok"])
        data = body["data"]
        self.assertEqual(data["agentName"], "校园集市 Agent")
        self.assertTrue(data["model"]["configured"])
        self.assertFalse(data["market"]["available"])
        self.assertEqual(data["market"]["code"], "MARKET_UNAVAILABLE")
        self.assertFalse(data["capabilities"]["writes"])
        raw = json.dumps(body, ensure_ascii=False)
        self.assertNotIn("test-key", raw)
        self.assertNotIn("127.0.0.1", raw)
        self.assertEqual(response.headers.get("cache-control"), "no-store")

    def test_market_endpoints_return_unavailable_without_records(self):
        self.start_client()
        for path in (
            "/api/market/posts",
            "/api/market/hot",
            "/api/market/search?keyword=显示器",
        ):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 503, path)
            body = response.json()
            self.assertFalse(body["ok"])
            self.assertEqual(body["error"]["code"], "MARKET_UNAVAILABLE")
            self.assertNotIn("posts", body)

    def test_market_search_requires_keyword(self):
        self.start_client()
        response = self.client.get("/api/market/search")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "INVALID_REQUEST")

    def test_non_market_chat_uses_real_model_proxy(self):
        self.start_client()
        response = self.client.post(
            "/api/chat",
            json={
                "message": "你好，介绍一下你自己",
                "history": [
                    {"role": "user", "content": "你好"},
                    {"role": "assistant", "content": "你好，有什么可以帮你？"},
                ],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["reply"], "FAKE_MODEL_REPLY")
        self.assertEqual(response.headers.get("cache-control"), "no-store")
        self.assertEqual(len(self.fake_model.requests), 1)
        upstream = self.fake_model.requests[0]
        self.assertTrue(upstream["authorization"].startswith("Bearer "))
        sent = upstream["body"]["messages"]
        self.assertEqual(sent[0]["role"], "system")
        self.assertIn("不要编造", sent[0]["content"])
        self.assertEqual([m["role"] for m in sent[1:]], ["user", "assistant", "user"])

    def test_market_chat_without_provider_returns_error_and_skips_model(self):
        self.start_client()
        response = self.client.post("/api/chat", json={"message": "帮我找 500 元以内的显示器"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "MARKET_UNAVAILABLE")
        self.assertEqual(self.fake_model.requests, [])

    def test_market_chat_searches_first_then_summarizes_returned_fields(self):
        provider = FakeMarketProvider(
            posts=[{"id": "p1", "title": "显示器转让", "price": 500}]
        )
        self.start_client(market=provider)
        response = self.client.post("/api/chat", json={"message": "帮我找显示器"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["data"]["reply"], "FAKE_MODEL_REPLY")
        self.assertEqual(provider.calls[0][0], "search")
        post = response.json()["data"]["market"]["posts"][0]
        self.assertEqual(post, {"id": "p1", "title": "显示器转让", "price": 500})
        system = self.fake_model.requests[0]["body"]["messages"][0]["content"]
        self.assertIn("显示器转让", system)
        self.assertIn("未提供", system)
        self.assertIn("不得补充", system)

    def test_chat_without_model_config_returns_explicit_error(self):
        self.start_client(model_configured=False)
        response = self.client.post("/api/chat", json={"message": "你好"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "MODEL_NOT_CONFIGURED")
        self.assertNotIn("data", response.json())
        self.assertEqual(self.fake_model.requests, [])

    def test_chat_validates_message(self):
        self.start_client()
        for payload in ({}, {"message": ""}, {"message": "x" * 2001}):
            response = self.client.post("/api/chat", json=payload)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["error"]["code"], "INVALID_REQUEST")

    def test_chat_rejects_non_object_body(self):
        self.start_client()
        response = self.client.post("/api/chat", json=["not", "an", "object"])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"]["code"], "INVALID_REQUEST")

    def test_model_upstream_failure_returns_generic_error(self):
        self.start_client()
        self.fake_model.stop()
        response = self.client.post("/api/chat", json={"message": "你好"})
        self.assertEqual(response.status_code, 502)
        body = response.json()
        self.assertIn(
            body["error"]["code"], ("MODEL_UNREACHABLE", "MODEL_REQUEST_FAILED")
        )
        self.assertNotIn("test-key", json.dumps(body, ensure_ascii=False))


class StdlibAppTest(unittest.TestCase):
    """验证真实运行入口 `server/app.py`（stdlib HTTP 服务）的对外行为。"""

    def setUp(self):
        self.fake_model = FakeModelServer().start()
        self.server = None

    def tearDown(self):
        self.fake_model.stop()
        if self.server is not None:
            self.server.shutdown()
            self.server.server_close()

    def start_server(self, market=None, model_configured=True):
        config = Config(
            host="127.0.0.1",
            port=0,
            openai_api_key="test-key" if model_configured else "",
            openai_base_url=f"http://127.0.0.1:{self.fake_model.port}/v1",
            openai_model="test-model" if model_configured else "",
            model_timeout=5,
        )
        self.server = build_server(config, MarketService(market))
        port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return f"http://127.0.0.1:{port}"

    def call(self, base, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            base + path,
            data=data,
            method="POST" if payload is not None else "GET",
            headers={"Content-Type": "application/json"} if data else {},
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8"))

    def test_config_and_market_reads_report_unavailable(self):
        base = self.start_server()
        status, body = self.call(base, "/api/config")
        self.assertEqual(status, 200)
        self.assertNotIn("test-key", json.dumps(body, ensure_ascii=False))
        self.assertEqual(body["data"]["market"]["code"], "MARKET_UNAVAILABLE")
        for path in (
            "/api/market/posts",
            "/api/market/hot",
            "/api/market/search?keyword=" + urllib.parse.quote("显示器"),
        ):
            status, body = self.call(base, path)
            self.assertEqual(status, 503, path)
            self.assertEqual(body["error"]["code"], "MARKET_UNAVAILABLE")
            self.assertNotIn("posts", body)

    def test_chat_without_model_config_is_explicit_error(self):
        base = self.start_server(model_configured=False)
        status, body = self.call(base, "/api/chat", {"message": "你好"})
        self.assertEqual(status, 503)
        self.assertEqual(body["error"]["code"], "MODEL_NOT_CONFIGURED")
        self.assertEqual(self.fake_model.requests, [])

    def test_market_chat_searches_then_summarizes(self):
        provider = FakeMarketProvider(posts=[{"id": "p1", "title": "显示器转让", "price": 500}])
        base = self.start_server(market=provider)
        status, body = self.call(base, "/api/chat", {"message": "帮我找显示器"})
        self.assertEqual(status, 200)
        self.assertEqual(body["data"]["reply"], "FAKE_MODEL_REPLY")
        self.assertEqual(provider.calls[0][0], "search")
        self.assertEqual(
            body["data"]["market"]["posts"][0],
            {"id": "p1", "title": "显示器转让", "price": 500},
        )


if __name__ == "__main__":
    unittest.main()
