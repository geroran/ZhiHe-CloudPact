"""校园 AI 智能体的最小同源代理（FastAPI）。

浏览器在 proxy 模式下只请求 `/api/agent/<endpoint>`，由本路由转发到
`{AGENT_ORIGIN}/api/proxy/api/v1/<endpoint>?appid=...`。
AppID/Apikey 只从服务端环境变量或 Git 忽略的 `.env`/`.env.local` 读取，
不会下发浏览器，也不会出现在错误信息或日志中。

只放行 AI 助手实际使用的 4 个接口；其余端点一律 404。
"""

from __future__ import annotations

import json
import os
import urllib.parse

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from ..config import ROOT_DIR, load_env_file

router = APIRouter(prefix="/api/agent", tags=["ai-agent"])

ALLOWED_ENDPOINTS = (
    "get_app_config_preview",
    "create_conversation",
    "chat_query_v2",
    "get_conversation_messages",
)

DEFAULT_ORIGIN = "https://agent.ynu.edu.cn"
DEFAULT_TIMEOUT_MS = 120000
MAX_BODY_BYTES = 1024 * 1024
NO_STORE_HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache"}


class UpstreamTimeout(Exception):
    """上游超时。"""


class UpstreamUnavailable(Exception):
    """上游网络不可达。"""


def _error(status: int, code: str, message: str, retryable: bool = False) -> JSONResponse:
    return JSONResponse(
        content={"ok": False, "error": {"code": code, "message": message, "retryable": retryable}},
        status_code=status,
        headers=NO_STORE_HEADERS,
    )


def _map_status(status: int) -> JSONResponse:
    if status in (401, 403):
        return _error(401, "UNAUTHORIZED", "智能体接口鉴权失败，请检查服务端 Apikey 配置。")
    if status == 404:
        return _error(404, "NOT_FOUND", "智能体接口不存在（HTTP 404）。")
    if status == 429:
        return _error(429, "RATE_LIMITED", "智能体接口请求过于频繁（HTTP 429），请稍后重试。", True)
    if status >= 500:
        return _error(status, "UPSTREAM_ERROR", f"智能体服务返回错误（HTTP {status}）。", True)
    return _error(502, "UPSTREAM_ERROR", f"智能体服务返回异常状态（HTTP {status}）。")


def _load_config() -> dict:
    """读取服务端配置；.env / .env.local 只用于本地开发，已存在变量优先。"""
    load_env_file(ROOT_DIR / ".env")
    load_env_file(ROOT_DIR / ".env.local")
    try:
        timeout_ms = int(os.getenv("AGENT_TIMEOUT_MS", str(DEFAULT_TIMEOUT_MS)))
    except ValueError:
        timeout_ms = DEFAULT_TIMEOUT_MS
    return {
        "transport": (os.getenv("AGENT_TRANSPORT") or "direct").strip().lower(),
        "origin": (os.getenv("AGENT_ORIGIN") or DEFAULT_ORIGIN).strip().rstrip("/"),
        "app_id": (os.getenv("AGENT_APP_ID") or "").strip(),
        "api_key": (os.getenv("AGENT_API_KEY") or "").strip(),
        "timeout": max(timeout_ms, 1000) / 1000,
    }


async def _send(url: str, api_key: str, body: bytes, timeout: float) -> tuple[int, bytes]:
    """转发一次 POST；测试可替换本函数以注入固定上游。"""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                url,
                headers={"Content-Type": "application/json", "Apikey": api_key},
                content=body,
            )
    except httpx.TimeoutException as exc:
        raise UpstreamTimeout from exc
    except httpx.HTTPError as exc:
        raise UpstreamUnavailable from exc
    return response.status_code, response.content


async def _stream_send(url: str, api_key: str, body: bytes, timeout: float):
    """以流式方式打开上游请求，返回 (client, response)。

    调用方负责在结束或异常时关闭 response 与 client。
    测试可替换本函数以注入固定 SSE 上游。
    """
    client = httpx.AsyncClient(timeout=timeout)
    request = client.build_request(
        "POST",
        url,
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
            "Apikey": api_key,
        },
        content=body,
    )
    try:
        response = await client.send(request, stream=True)
    except httpx.TimeoutException as exc:
        await client.aclose()
        raise UpstreamTimeout from exc
    except httpx.HTTPError as exc:
        await client.aclose()
        raise UpstreamUnavailable from exc
    except Exception:
        await client.aclose()
        raise


def _wants_stream(request: Request, endpoint: str, payload: dict) -> bool:
    if endpoint != "chat_query_v2":
        return False
    if str(payload.get("ResponseMode") or "").strip().lower() == "streaming":
        return True
    return "text/event-stream" in (request.headers.get("accept") or "").lower()


def _json_envelope(content: bytes) -> JSONResponse:
    try:
        data = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return _error(502, "BAD_RESPONSE", "智能体返回了非 JSON 内容，已停止解析。")
    if not isinstance(data, dict):
        return _error(502, "BAD_RESPONSE", "智能体返回结构异常。")
    return JSONResponse(
        content={"ok": True, "data": data},
        headers=NO_STORE_HEADERS,
        media_type="application/json; charset=utf-8",
    )


async def _proxy_stream(url: str, api_key: str, body: bytes, timeout: float):
    """流式代理：上游返回 SSE 时按片段透传，否则回退为 JSON 信封。"""
    try:
        client, upstream = await _stream_send(url, api_key, body, timeout)
    except UpstreamTimeout:
        return _error(504, "TIMEOUT", "智能体响应超时，请稍后重试。", True)
    except UpstreamUnavailable:
        return _error(502, "NETWORK", "无法连接智能体服务，请确认网络或校园网环境。", True)

    if upstream.status_code >= 400:
        await upstream.aread()
        await upstream.aclose()
        await client.aclose()
        return _map_status(upstream.status_code)

    content_type = (upstream.headers.get("content-type") or "").lower()
    if "text/event-stream" not in content_type:
        content = await upstream.aread()
        await upstream.aclose()
        await client.aclose()
        return _json_envelope(content)

    async def relay():
        try:
            async for chunk in upstream.aiter_raw():
                if chunk:
                    yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    headers = dict(NO_STORE_HEADERS)
    headers["X-Accel-Buffering"] = "no"
    headers["Connection"] = "keep-alive"
    return StreamingResponse(relay(), media_type="text/event-stream", headers=headers)


@router.post("/{endpoint}")
async def proxy_agent(endpoint: str, request: Request) -> JSONResponse:
    """同源代理入口；仅代理白名单接口，凭据只在服务端注入。"""
    config = _load_config()

    if config["transport"] != "proxy":
        return _error(404, "NOT_FOUND", "当前为浏览器直连模式，本地代理未启用。")
    if endpoint not in ALLOWED_ENDPOINTS:
        return _error(404, "NOT_FOUND", "该接口未纳入本地代理白名单。")
    if not config["app_id"] or not config["api_key"]:
        return _error(503, "CONFIG_ERROR", "本地代理缺少 AGENT_APP_ID 或 AGENT_API_KEY。")

    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        return _error(413, "REQUEST_TOO_LARGE", "请求体过大。")
    try:
        payload = json.loads(raw.decode("utf-8") or "{}")
    except (UnicodeDecodeError, json.JSONDecodeError):
        return _error(400, "INVALID_REQUEST", "请求体必须是合法 JSON。")
    if not isinstance(payload, dict):
        return _error(400, "INVALID_REQUEST", "请求体必须是 JSON 对象。")

    query = urllib.parse.quote(config["app_id"], safe="")
    url = f"{config['origin']}/api/proxy/api/v1/{endpoint}?appid={query}"
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    if _wants_stream(request, endpoint, payload):
        return await _proxy_stream(url, config["api_key"], body, config["timeout"])

    try:
        status, content = await _send(
            url,
            config["api_key"],
            body,
            config["timeout"],
        )
    except UpstreamTimeout:
        return _error(504, "TIMEOUT", "智能体响应超时，请稍后重试。", True)
    except UpstreamUnavailable:
        return _error(502, "NETWORK", "无法连接智能体服务，请确认网络或校园网环境。", True)

    if status >= 400:
        return _map_status(status)

    return _json_envelope(content)


__all__ = [
    "ALLOWED_ENDPOINTS",
    "UpstreamTimeout",
    "UpstreamUnavailable",
    "proxy_agent",
    "router",
]
