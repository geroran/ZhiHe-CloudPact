#!/usr/bin/env python3
"""学期课程模块的独立联调页与同源代理（仅本地开发/联调用）。

业务逻辑复用 `server/term_courses_core.py`，与主站 FastAPI 路由
`server/routes/term_courses.py` 保持一致。主站合并后可直接使用
`/api/term-courses`，本脚本不参与生产部署。

启动：
    python server/term_courses_proxy.py
    python server/term_courses_proxy.py --port 8787 --config .env.local
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from term_courses_core import (  # noqa: E402
    DEFAULT_CONFIG_PATH,
    TERM_CODE_PATTERN,
    UpstreamTimeout,
    UpstreamUnavailable,
    api_error,
    fetch_upstream,
    interpret_upstream,
    load_token,
)

ROOT = SERVER_DIR.parent
API_PATH = "/api/term-courses"
HARNESS_ROUTE = "/test/term-course-list/harness.html"
STATIC_FILES = {
    "/": Path("test/term-course-list/harness.html"),
    HARNESS_ROUTE: Path("test/term-course-list/harness.html"),
    "/src/modules/term-course-list/index.js": Path("src/modules/term-course-list/index.js"),
    "/src/modules/term-course-list/api.js": Path("src/modules/term-course-list/api.js"),
    "/src/modules/term-course-list/styles.js": Path("src/modules/term-course-list/styles.js"),
}
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
}


class TermCourseHandler(BaseHTTPRequestHandler):
    server_version = "ZhiHeYunQiTermCourseProxy/1.0"
    config_path: Path = DEFAULT_CONFIG_PATH

    def log_request(self, code="-", size="-"):
        # 不记录查询串，避免任何凭据或参数进入终端日志。
        path = urllib.parse.urlsplit(self.path).path
        sys.stderr.write(f"{self.address_string()} {self.command} {path} -> {code}\n")

    def log_message(self, fmt, *args):
        sys.stderr.write(f"{self.address_string()} {fmt % args}\n")

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        if parts.path == API_PATH:
            self.handle_api(parts.query)
            return

        relative = STATIC_FILES.get(parts.path)
        if relative is None:
            self.send_json(404, api_error("NOT_FOUND", "请求路径不存在"))
            return

        file_path = (ROOT / relative).resolve()
        try:
            body = file_path.read_bytes()
        except OSError:
            self.send_json(404, api_error("NOT_FOUND", "联调静态文件不存在"))
            return
        self.send_bytes(200, body, CONTENT_TYPES.get(file_path.suffix, "application/octet-stream"))

    def handle_api(self, query: str) -> None:
        params = urllib.parse.parse_qs(query, keep_blank_values=True)
        term_code = (params.get("termCode") or [""])[0].strip()

        if not TERM_CODE_PATTERN.fullmatch(term_code):
            self.send_json(
                400,
                api_error("INVALID_TERM_CODE", "请输入有效的学期代码，例如 2023-2024-1"),
            )
            return

        token = load_token(self.config_path)
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
            self.send_json(504, api_error("UPSTREAM_TIMEOUT", "课程接口响应超时，请稍后重试", True))
            return
        except UpstreamUnavailable:
            self.send_json(502, api_error("UPSTREAM_ERROR", "无法连接校园课程接口，请稍后重试", True))
            return

        api_status, body = interpret_upstream(status, payload)
        self.send_json(api_status, body)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="学期课程列表独立联调代理")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument(
        "--config",
        default=str(DEFAULT_CONFIG_PATH),
        help="本地配置文件路径（默认仓库根目录 .env.local）",
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)
    TermCourseHandler.config_path = Path(args.config).resolve()

    server = ThreadingHTTPServer((args.host, args.port), TermCourseHandler)
    token_state = "已配置" if load_token(TermCourseHandler.config_path) else "未配置"
    print(f"学期课程模块联调页: http://{args.host}:{args.port}/")
    print(f"课程代理接口: http://{args.host}:{args.port}{API_PATH}?termCode=...")
    print(f"WECAMPUS_TOKEN: {token_state}（不会下发到浏览器）")
    print("按 Ctrl+C 停止。")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
