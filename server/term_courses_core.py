"""学期课程代理的共享核心。

被两个入口复用，避免维护两份上游请求/响应映射逻辑：
- `server/routes/term_courses.py`：主站 FastAPI 路由 `/api/term-courses`；
- `server/term_courses_proxy.py`：模块独立联调页 + 同源代理。

凭据边界：WECAMPUS_TOKEN 只从环境变量或 Git 忽略的 `.env.local` 读取，
不写入响应、日志或错误信息。上游只返回课程字段白名单，不转发 uid、时间戳。
"""

from __future__ import annotations

import json
import os
import re
import socket
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = ROOT / ".env.local"
UPSTREAM_URL = "https://wecampus.site/wecampus/study/get_courses"
MAX_UPSTREAM_BYTES = 2 * 1024 * 1024
UPSTREAM_TIMEOUT_SECONDS = 15
TERM_CODE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
COURSE_FIELDS = ("id", "courseName", "courseId", "courseTeacher", "courseDetailInfo", "termCode")


class UpstreamTimeout(Exception):
    """上游请求超时。"""


class UpstreamUnavailable(Exception):
    """无法连接上游。"""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def load_token(config_path: Path = DEFAULT_CONFIG_PATH) -> str:
    """按环境变量优先、`.env.local` 兜底的顺序读取 JWT，不打印值。"""
    token = os.environ.get("WECAMPUS_TOKEN", "").strip()
    if token:
        return token
    if not config_path.is_file():
        return ""
    try:
        lines = config_path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key.strip() == "WECAMPUS_TOKEN":
            return value.strip().strip('"').strip("'")
    return ""


def api_error(code: str, message: str, retryable: bool = False) -> dict:
    return {"ok": False, "error": {"code": code, "message": message, "retryable": retryable}}


def pick_course(item) -> dict | None:
    if not isinstance(item, dict):
        return None
    return {field: item.get(field) for field in COURSE_FIELDS}


def _parse_json(raw: bytes):
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


def fetch_upstream(term_code: str, token: str) -> tuple[int, object]:
    """请求上游课程接口，返回 (HTTP 状态码, JSON 载荷或 None)。

    网络异常转换为 UpstreamTimeout / UpstreamUnavailable，由调用方映射为
    504 / 502。重定向被禁用，防止 token 被带到其他主机。
    """
    query = urllib.parse.urlencode(
        {"termCode": term_code, "token": token, "client": "utool"}
    )
    request = urllib.request.Request(
        f"{UPSTREAM_URL}?{query}",
        method="GET",
        headers={
            "Accept": "application/json",
            "User-Agent": "ZhiHeYunQi-TermCourseProxy/1.0",
        },
    )

    try:
        with OPENER.open(request, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_UPSTREAM_BYTES + 1)
            if len(raw) > MAX_UPSTREAM_BYTES:
                return response.status, None
            return response.status, _parse_json(raw)
    except urllib.error.HTTPError as exc:
        try:
            exc.read()
        except Exception:
            pass
        return exc.code, None
    except (TimeoutError, socket.timeout) as exc:
        raise UpstreamTimeout from exc
    except (urllib.error.URLError, OSError) as exc:
        raise UpstreamUnavailable from exc


def interpret_upstream(status: int, payload: object) -> tuple[int, dict]:
    """把上游 HTTP 状态与业务载荷映射成本项目统一的 {ok,data}/{ok,error} 结构。"""
    if status in (401, 403):
        return 401, api_error("AUTH_FAILED", "登录凭证已失效，请更新服务端 token 后重试")

    if status != 200:
        return 502, api_error("UPSTREAM_ERROR", "校园课程接口暂时不可用，请稍后重试", True)

    if not isinstance(payload, dict):
        return 502, api_error("UPSTREAM_BAD_RESPONSE", "校园课程接口返回格式异常", True)

    result = payload.get("result")
    if result != "success":
        # 实测上游对无效 JWT 返回 HTTP 200 + {"result":"invalid_token"}，
        # 因此按业务结果中的 token 关键字明确映射为鉴权失败。
        if "token" in str(result).lower():
            return 401, api_error("AUTH_FAILED", "登录凭证已失效，请更新服务端 token 后重试")
        return 502, api_error("UPSTREAM_BAD_RESPONSE", "校园课程接口返回格式异常", True)

    data = payload.get("data")
    if not isinstance(data, list):
        return 502, api_error("UPSTREAM_BAD_RESPONSE", "校园课程接口返回格式异常", True)

    courses = [picked for picked in (pick_course(item) for item in data) if picked]
    return 200, {"ok": True, "data": courses}
