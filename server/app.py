"""智启云聚服务端入口（stdlib `ThreadingHTTPServer`）。

对外提供：
- `GET  /api/health`
- `GET  /api/config`
- `GET  /api/market/posts|hot|search`
- `POST /api/chat`
- `GET  /api/charging/ports`（桦苑充电口，经服务端代理）
- `GET  /api/term-courses`（学期课程列表，经服务端代理，凭据不下发浏览器）
- `POST /api/course-grades/search|info`（课程检索与历史给分统计，经服务端代理）

启动：`python server/app.py`（读取 `.env.market`、`.env` 与进程 APP_PORT，默认 8011）。
所有接口统一返回 `{ok:true,data}` / `{ok:false,error}`，并带 `Cache-Control: no-store`。
"""

from __future__ import annotations

import json
import os
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

SERVER_DIR = Path(__file__).resolve().parent
ROOT_DIR = SERVER_DIR.parent
for _path in (str(ROOT_DIR), str(SERVER_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from server.charging_core import query_status  # noqa: E402
from server.course_grades_core import (  # noqa: E402
    fetch_grade,
    fetch_search,
    interpret_grade,
    interpret_search,
    parse_info_payload,
    parse_search_payload,
)
from server.config import Config, config_from_env  # noqa: E402
from server.market_agent import ChatService, MarketApiError, build_market_service  # noqa: E402
from server.market_service import MarketProviderError, MarketService, MarketUnavailable  # noqa: E402
from server.model_client import ModelClient  # noqa: E402
from server.schedule_core import recognize as recognize_schedule  # noqa: E402
from server.term_courses_core import (  # noqa: E402
    DEFAULT_CONFIG_PATH,
    TERM_CODE_PATTERN,
    UpstreamTimeout,
    UpstreamUnavailable,
    api_error,
    fetch_upstream,
    interpret_upstream,
    load_token,
)

MAX_BODY_BYTES = 1024 * 1024
SCHEDULE_MAX_BODY_BYTES = 20 * 1024 * 1024
DEFAULT_CORS_ORIGINS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "http://localhost:8099,http://127.0.0.1:8099"
)
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}


def allowed_origins() -> list[str]:
    raw = os.getenv("CORS_ALLOWED_ORIGINS") or DEFAULT_CORS_ORIGINS
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def ok_payload(data: Any) -> dict:
    return {"ok": True, "data": data}


def error_payload(code: str, message: str, retryable: bool = False) -> dict:
    return {"ok": False, "error": {"code": code, "message": message, "retryable": retryable}}


def _int_param(params: dict, name: str, fallback: int) -> int:
    raw = (params.get(name) or [""])[0]
    if raw == "":
        return fallback
    try:
        return int(raw)
    except ValueError:
        raise MarketApiError(400, "INVALID_REQUEST", f"{name} 必须是整数") from None


def build_chat_service(config: Config, market: MarketService) -> ChatService:
    model = ModelClient(
        api_key=config.openai_api_key,
        base_url=config.openai_base_url,
        model=config.openai_model,
        temperature=config.openai_temperature,
        timeout=config.model_timeout,
    )
    return ChatService(config, market, model)


def make_handler(config: Config, service: ChatService, static_root: Path | None = None):
    origins = allowed_origins()
    root = static_root if static_root is not None else config.static_dir
    static_enabled = bool(root and root.is_dir())

    class ApiHandler(BaseHTTPRequestHandler):
        server_version = "ZhiHeYunQi/1.0"
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            # 不记录查询串（可能含检索词）与请求头。
            path = urllib.parse.urlsplit(self.path).path
            sys.stderr.write(f"{self.address_string()} {self.command} {path} -> {fmt % args}\n")

        def send_json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def _send_cors_headers(self) -> None:
            origin = self.headers.get("Origin")
            if origin and origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Content-Length", "0")
            self.send_header("Cache-Control", "no-store")
            self._send_cors_headers()
            self.end_headers()

        def do_GET(self):
            parts = urllib.parse.urlsplit(self.path)
            path = parts.path
            params = urllib.parse.parse_qs(parts.query, keep_blank_values=True)

            if path == "/api/health":
                self.send_json(200, {"ok": True, "service": "zhihe-cloudpact"})
                return
            if path == "/api/config":
                self.send_json(200, ok_payload(service.config_payload()))
                return
            if path == "/api/market/posts":
                self._market(lambda: service.market.latest(_int_param(params, "limit", 20)))
                return
            if path == "/api/market/hot":
                self._market(lambda: service.market.hot(_int_param(params, "limit", 20)))
                return
            if path == "/api/market/search":
                keyword = (params.get("keyword") or [""])[0].strip()
                if not keyword:
                    self.send_json(400, error_payload("INVALID_REQUEST", "keyword 不能为空"))
                    return
                self._market(
                    lambda: service.market.search(
                        keyword,
                        _int_param(params, "page", 1),
                        _int_param(params, "limit", 20),
                    )
                )
                return
            if path == "/api/charging/ports":
                self.send_json(200, query_status())
                return
            if path == "/api/term-courses":
                self._term_courses(params)
                return

            if self._send_static(path):
                return

            self.send_json(404, error_payload("NOT_FOUND", "请求路径不存在"))

        def _send_static(self, path: str) -> bool:
            if not static_enabled:
                return False
            relative = "index.html" if path == "/" else path.lstrip("/")
            candidate = (root / relative).resolve()
            try:
                candidate.relative_to(root.resolve())
            except ValueError:
                return False
            if candidate.is_dir():
                candidate = candidate / "index.html"
            try:
                body = candidate.read_bytes()
            except OSError:
                return False

            content_type = CONTENT_TYPES.get(candidate.suffix.lower(), "application/octet-stream")
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self._send_cors_headers()
            self.end_headers()
            self.wfile.write(body)
            return True

        def do_POST(self):
            parts = urllib.parse.urlsplit(self.path)
            if parts.path == "/api/schedule/recognize":
                self._schedule_recognize()
                return
            if parts.path == "/api/course-grades/search":
                self._course_grades("search")
                return
            if parts.path == "/api/course-grades/info":
                self._course_grades("info")
                return
            if parts.path != "/api/chat":
                self.send_json(404, error_payload("NOT_FOUND", "请求路径不存在"))
                return

            payload = self._read_json_body()
            if payload is None:
                return

            try:
                self.send_json(200, ok_payload(service.chat(payload)))
            except MarketApiError as exc:
                self.send_json(exc.status, error_payload(exc.code, exc.message, exc.retryable))
            except Exception:
                self.send_json(
                    500, error_payload("INTERNAL_ERROR", "服务内部错误", True)
                )

        def _course_grades(self, kind: str) -> None:
            """课程检索 / 历史给分统计：凭据只留在服务端，只回传白名单字段。"""
            payload = self._read_json_body()
            if payload is None:
                return

            try:
                if kind == "search":
                    course_name, teacher, page = parse_search_payload(payload)
                    call = lambda token: fetch_search(course_name, teacher, page, token)  # noqa: E731
                    interpret = interpret_search
                else:
                    course_name, teacher = parse_info_payload(payload)
                    call = lambda token: fetch_grade(course_name, teacher, token)  # noqa: E731
                    interpret = interpret_grade
            except ValueError as exc:
                self.send_json(400, api_error("INVALID_REQUEST", str(exc)))
                return

            token = load_token(DEFAULT_CONFIG_PATH)
            if not token:
                self.send_json(
                    503,
                    api_error(
                        "NOT_CONFIGURED",
                        "服务端未配置课程查询凭证（WECAMPUS_TOKEN），请在 .env.local 或环境变量中配置。",
                    ),
                )
                return

            try:
                status, upstream = call(token)
            except UpstreamTimeout:
                self.send_json(
                    504, api_error("UPSTREAM_TIMEOUT", "课程接口响应超时，请稍后重试", True)
                )
                return
            except UpstreamUnavailable:
                self.send_json(
                    502, api_error("UPSTREAM_ERROR", "无法连接校园课程接口，请稍后重试", True)
                )
                return

            api_status, body = interpret(status, upstream)
            self.send_json(api_status, body)

        def _term_courses(self, params: dict) -> None:
            """学期课程列表：由服务端注入 WECAMPUS_TOKEN，只回传课程字段白名单。"""
            term_code = (params.get("termCode") or [""])[0].strip()
            if not TERM_CODE_PATTERN.fullmatch(term_code):
                self.send_json(
                    400, api_error("INVALID_TERM_CODE", "请输入有效的学期代码，例如 2023-2024-1")
                )
                return

            token = load_token(DEFAULT_CONFIG_PATH)
            if not token:
                self.send_json(
                    503,
                    api_error(
                        "NOT_CONFIGURED",
                        "服务端未配置课程查询凭证（WECAMPUS_TOKEN），请在 .env.local 或环境变量中配置。",
                    ),
                )
                return

            try:
                status, payload = fetch_upstream(term_code, token)
            except UpstreamTimeout:
                self.send_json(
                    504, api_error("UPSTREAM_TIMEOUT", "课程接口响应超时，请稍后重试", True)
                )
                return
            except UpstreamUnavailable:
                self.send_json(
                    502, api_error("UPSTREAM_ERROR", "无法连接校园课程接口，请稍后重试", True)
                )
                return

            api_status, body = interpret_upstream(status, payload)
            self.send_json(api_status, body)

        def _schedule_recognize(self) -> None:
            payload = self._read_json_body(max_bytes=SCHEDULE_MAX_BODY_BYTES)
            if payload is None:
                return
            image = payload.get("image")
            if not isinstance(image, str):
                self.send_json(
                    400,
                    error_payload("INVALID_IMAGE", "请上传课表图片（base64 data URL）"),
                )
                return
            try:
                status, body = recognize_schedule(image)
            except Exception:
                # 不把上游原始响应或堆栈返回给浏览器。
                self.send_json(500, error_payload("INTERNAL_ERROR", "课表识别服务异常", True))
                return
            self.send_json(status, body)

        def _read_json_body(self, max_bytes: int = MAX_BODY_BYTES):
            try:
                length = int(self.headers.get("Content-Length") or "0")
            except ValueError:
                self.send_json(400, error_payload("INVALID_REQUEST", "请求体长度无效"))
                return None

            if length <= 0:
                self.send_json(400, error_payload("INVALID_REQUEST", "请求体必须是合法 JSON"))
                return None
            if length > max_bytes:
                self.send_json(413, error_payload("REQUEST_TOO_LARGE", "请求体过大"))
                return None

            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                self.send_json(400, error_payload("INVALID_REQUEST", "请求体必须是合法 JSON"))
                return None

            if not isinstance(payload, dict):
                self.send_json(400, error_payload("INVALID_REQUEST", "请求体必须是 JSON 对象"))
                return None
            return payload

        def _market(self, call) -> None:
            try:
                self.send_json(200, ok_payload(call()))
            except MarketApiError as exc:
                self.send_json(exc.status, error_payload(exc.code, exc.message, exc.retryable))
            except MarketProviderError as exc:
                self.send_json(exc.status, error_payload(exc.code, exc.message, exc.retryable))
            except MarketUnavailable:
                self.send_json(
                    503,
                    error_payload("MARKET_UNAVAILABLE", "真实数据源未配置/不可用"),
                )
            except ValueError as exc:
                self.send_json(400, error_payload("INVALID_REQUEST", str(exc)))
            except Exception:
                self.send_json(500, error_payload("INTERNAL_ERROR", "服务内部错误", True))

    return ApiHandler


def build_server(config: Config, market_service: MarketService, static_dir=None) -> ThreadingHTTPServer:
    """构造主站 HTTP 服务；`market_service` 为只读集市适配层。"""
    service = build_chat_service(config, market_service)
    static_root = Path(static_dir) if static_dir is not None else config.static_dir
    handler = make_handler(config, service, static_root)
    return ThreadingHTTPServer((config.host, config.port), handler)


def main() -> None:
    config = config_from_env()
    market = build_market_service(config)
    # STATIC_DIR 可在本地预览时指向 src，默认使用 config.static_dir（构建产物目录）。
    static_dir = os.getenv("STATIC_DIR") or config.static_dir
    server = build_server(config, market, Path(static_dir))
    host, port = server.server_address[:2]
    sys.stderr.write(f"智启云聚 API: http://{host}:{port}\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
