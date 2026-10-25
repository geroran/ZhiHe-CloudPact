"""课程给分情况代理的共享核心。

转发校园课程服务的两个只读接口：
- `POST /wecampus/course/search_course`（按课程名或教师检索课程）
- `POST /wecampus/course/course_grade_info`（查询某门课程的历史给分统计）

凭据边界：`WECAMPUS_TOKEN` 只从环境变量或 Git 忽略的 `.env.local` 读取，
通过请求头 `x-wc-token` 注入，不写入响应、日志或错误信息。
上游只返回课程名、教师与给分统计字段白名单，不转发其他字段。
"""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request

from server.term_courses_core import (
    DEFAULT_CONFIG_PATH,
    NoRedirect,
    UpstreamTimeout,
    UpstreamUnavailable,
    api_error,
)

SEARCH_URL = "https://wecampus.site/wecampus/course/search_course"
GRADE_URL = "https://wecampus.site/wecampus/course/course_grade_info"
MAX_UPSTREAM_BYTES = 512 * 1024
UPSTREAM_TIMEOUT_SECONDS = 15
MAX_TEXT_LENGTH = 80
MAX_PAGE = 200

SEARCH_FIELDS = ("courseName", "courseTeacher")
GRADE_FIELDS = (
    "avg",
    "maxScore",
    "count",
    "u90",
    "b8090",
    "b7080",
    "b6070",
    "d60",
    "usualAvg",
    "midtermAvg",
    "finalAvg",
)

OPENER = urllib.request.build_opener(NoRedirect)


def _text(value) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() == "null" else text


def parse_search_payload(payload: dict) -> tuple[str, str, int]:
    """校验检索参数；至少提供课程名或教师之一。"""
    course_name = _text(payload.get("courseName"))
    teacher = _text(payload.get("teacher"))
    if not course_name and not teacher:
        raise ValueError("请至少填写课程名或教师")
    if len(course_name) > MAX_TEXT_LENGTH or len(teacher) > MAX_TEXT_LENGTH:
        raise ValueError(f"课程名或教师不能超过 {MAX_TEXT_LENGTH} 个字符")

    raw_page = payload.get("page", 1)
    try:
        page = int(raw_page)
    except (TypeError, ValueError):
        raise ValueError("page 必须是整数") from None
    if page < 1 or page > MAX_PAGE:
        raise ValueError(f"page 必须在 1 到 {MAX_PAGE} 之间")
    return course_name, teacher, page


def parse_info_payload(payload: dict) -> tuple[str, str]:
    """校验给分查询参数；课程名与教师都必须与检索结果一致。"""
    course_name = _text(payload.get("courseName"))
    teacher = _text(payload.get("teacher"))
    if not course_name:
        raise ValueError("缺少课程名")
    if len(course_name) > MAX_TEXT_LENGTH or len(teacher) > MAX_TEXT_LENGTH:
        raise ValueError(f"课程名或教师不能超过 {MAX_TEXT_LENGTH} 个字符")
    return course_name, teacher


def _post(url: str, body: dict, token: str) -> tuple[int, object]:
    raw_body = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=raw_body,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "x-wc-token": token,
            "x-wc-client": "WeCampus",
            "x-wc-version": "1.1.7",
            "User-Agent": "ZhiHeYunQi-CourseGradesProxy/1.0",
        },
    )

    try:
        with OPENER.open(request, timeout=UPSTREAM_TIMEOUT_SECONDS) as response:
            raw = response.read(MAX_UPSTREAM_BYTES + 1)
            if len(raw) > MAX_UPSTREAM_BYTES:
                return response.status, None
            try:
                return response.status, json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                return response.status, None
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


def fetch_search(course_name: str, teacher: str, page: int, token: str) -> tuple[int, object]:
    return _post(
        SEARCH_URL,
        {"courseName": course_name, "teacher": teacher, "page": page},
        token,
    )


def fetch_grade(course_name: str, teacher: str, token: str) -> tuple[int, object]:
    return _post(GRADE_URL, {"courseName": course_name, "teacher": teacher}, token)


def _auth_failed() -> tuple[int, dict]:
    return 401, api_error("AUTH_FAILED", "登录凭证已失效，请更新服务端 token 后重试")


def _upstream_failed() -> tuple[int, dict]:
    return 502, api_error("UPSTREAM_ERROR", "校园课程接口暂时不可用，请稍后重试", True)


def _bad_response() -> tuple[int, dict]:
    return 502, api_error("UPSTREAM_BAD_RESPONSE", "校园课程接口返回格式异常", True)


def _ok_status(status: int, payload: object) -> dict | None:
    """返回业务数据；鉴权/格式问题抛出对应异常语义由调用方处理。"""
    if status in (401, 403):
        return None
    if status != 200 or not isinstance(payload, dict):
        return None
    return payload


def interpret_search(status: int, payload: object) -> tuple[int, dict]:
    if status in (401, 403):
        return _auth_failed()
    if status != 200:
        return _upstream_failed()

    body = _ok_status(status, payload)
    if body is None:
        return _bad_response()

    result = body.get("result")
    if result != "success":
        if "token" in str(result).lower():
            return _auth_failed()
        return _bad_response()

    data = body.get("data")
    if not isinstance(data, list):
        return _bad_response()

    courses = []
    for item in data:
        if not isinstance(item, dict):
            continue
        course_name = _text(item.get("courseName"))
        if not course_name:
            continue
        courses.append(
            {
                "courseName": course_name,
                "courseTeacher": _text(item.get("courseTeacher")),
            }
        )
    return 200, {"ok": True, "data": courses}


def _number(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    return None


def interpret_grade(status: int, payload: object) -> tuple[int, dict]:
    if status in (401, 403):
        return _auth_failed()
    if status != 200:
        return _upstream_failed()

    body = _ok_status(status, payload)
    if body is None:
        return _bad_response()

    result = body.get("result")
    if result != "success":
        if "token" in str(result).lower():
            return _auth_failed()
        return _bad_response()

    data = body.get("data")
    if not isinstance(data, list):
        return _bad_response()
    if not data:
        return 200, {"ok": True, "data": None}

    first = data[0]
    if not isinstance(first, dict):
        return _bad_response()

    grade = {field: _number(first.get(field)) for field in GRADE_FIELDS}
    if not grade.get("count"):
        # count 为 0 / 缺失表示该课程没有可用的历史给分样本。
        return 200, {"ok": True, "data": None}
    return 200, {"ok": True, "data": grade}
