"""桦苑充电口代理的 FastAPI 适配层（可选）。

核心逻辑在 `server/charging_core.py`，与 stdlib 主服务共用。
浏览器只访问本项目的 `/api/charging/ports`，由服务端向上游
`https://appapi.lvcchong.com/portDetail` 发起 POST 请求。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..charging_core import (
    DEFAULT_CONCURRENCY,
    DEFAULT_TIMEOUT_SECONDS,
    DEFAULT_UPSTREAM_URL,
    DEVICES,
    MAX_CONCURRENCY,
    MAX_ERROR_MESSAGE_LENGTH,
    MAX_TIMEOUT_SECONDS,
    MIN_CONCURRENCY,
    MIN_TIMEOUT_SECONDS,
    build_response,
    collect_devices,
    get_config,
    now_iso,
    parse_device_payload,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/charging", tags=["charging"])

NO_STORE_HEADERS = {"Cache-Control": "no-store", "Pragma": "no-cache"}


def _json_response(payload: dict) -> JSONResponse:
    return JSONResponse(content=payload, headers=NO_STORE_HEADERS)


@router.get("/ports")
async def get_charging_ports() -> JSONResponse:
    """获取全部桦苑设备的实时端口状态。"""
    config = get_config()

    try:
        results = await collect_devices(
            DEVICES,
            upstream_url=config["upstream_url"],
            concurrency=config["concurrency"],
            timeout_seconds=config["timeout_seconds"],
        )
    except Exception:
        logger.exception("桦苑充电口代理批次失败")
        return _json_response(
            {
                "ok": False,
                "error": {
                    "code": "charging_proxy_error",
                    "message": "服务端代理查询充电口状态失败",
                    "retryable": True,
                },
            }
        )

    return _json_response(build_response(results, now_iso()))


__all__ = [
    "DEFAULT_CONCURRENCY",
    "DEFAULT_TIMEOUT_SECONDS",
    "DEFAULT_UPSTREAM_URL",
    "DEVICES",
    "MAX_CONCURRENCY",
    "MAX_ERROR_MESSAGE_LENGTH",
    "MAX_TIMEOUT_SECONDS",
    "MIN_CONCURRENCY",
    "MIN_TIMEOUT_SECONDS",
    "build_response",
    "collect_devices",
    "get_charging_ports",
    "get_config",
    "parse_device_payload",
    "router",
]
