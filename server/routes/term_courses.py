"""学期课程列表的最小同源代理路由。

浏览器访问 `GET /api/term-courses?termCode=...`，由本路由向
`https://wecampus.site/wecampus/study/get_courses` 转发一次 GET。
JWT 只从服务端环境变量或 Git 忽略的 `.env.local` 读取，不下发浏览器。
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from ..term_courses_core import (
    DEFAULT_CONFIG_PATH,
    TERM_CODE_PATTERN,
    UpstreamTimeout,
    UpstreamUnavailable,
    api_error,
    fetch_upstream,
    interpret_upstream,
    load_token,
)

router = APIRouter(prefix="/api", tags=["term-courses"])

NO_STORE_HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def _json(status: int, payload: dict) -> JSONResponse:
    return JSONResponse(
        content=payload,
        status_code=status,
        headers=NO_STORE_HEADERS,
        media_type="application/json; charset=utf-8",
    )


def _timeout_error() -> dict:
    return api_error("UPSTREAM_TIMEOUT", "课程接口响应超时，请稍后重试", True)


def _unavailable_error() -> dict:
    return api_error("UPSTREAM_ERROR", "无法连接校园课程接口，请稍后重试", True)


@router.get("/term-courses")
async def get_term_courses(term_code: str = Query(default="", alias="termCode")) -> JSONResponse:
    """查询指定学期的真实课程列表；不提供成绩、学分或 GPA 字段。"""
    term_code = term_code.strip()
    if not TERM_CODE_PATTERN.fullmatch(term_code):
        return _json(
            400,
            api_error("INVALID_TERM_CODE", "请输入有效的学期代码，例如 2023-2024-1"),
        )

    token = load_token(DEFAULT_CONFIG_PATH)
    if not token:
        return _json(
            503,
            api_error(
                "NOT_CONFIGURED",
                "服务端未配置课程查询凭证（WECAMPUS_TOKEN），请在 .env.local 或环境变量中配置。",
            ),
        )

    try:
        status, payload = await asyncio.to_thread(fetch_upstream, term_code, token)
    except UpstreamTimeout:
        return _json(504, _timeout_error())
    except UpstreamUnavailable:
        return _json(502, _unavailable_error())

    api_status, body = interpret_upstream(status, payload)
    return _json(api_status, body)
