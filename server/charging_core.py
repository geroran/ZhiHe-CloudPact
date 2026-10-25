"""桦苑电瓶车充电口代理的共享核心。

被两个入口复用：
- `server/app.py`：项目主站（stdlib `ThreadingHTTPServer`）的 `/api/charging/ports`；
- `server/routes/charging.py`：可选的 FastAPI 适配层。

设计约束：
- 只包含桦苑设备，不接入梓苑；
- 有限并发可配置，单台设备失败不会阻塞其他设备；
- 对真实响应结构做校验，结构不符的设备标记为 invalid_response；
- 不缓存，不返回凭据，不把上游原始响应写入日志。
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Iterable

import httpx

logger = logging.getLogger(__name__)

DEFAULT_UPSTREAM_URL = "https://appapi.lvcchong.com/portDetail"
DEFAULT_CONCURRENCY = 4
DEFAULT_TIMEOUT_SECONDS = 12.0
MIN_CONCURRENCY = 1
MAX_CONCURRENCY = 12
MIN_TIMEOUT_SECONDS = 2.0
MAX_TIMEOUT_SECONDS = 60.0
MAX_ERROR_MESSAGE_LENGTH = 160

# 设备号按 2026-10-25 真实响应核对：simId 顺序与“云大桦苑1号机…30号机”一致。
# 布局定位使用这里的 deviceNo，不从接口设备名称推导。
DEVICES: tuple[dict[str, Any], ...] = (
    {"deviceNo": 1, "simId": "866522076351796"},
    {"deviceNo": 2, "simId": "865242053185643"},
    {"deviceNo": 3, "simId": "866569061877939"},
    {"deviceNo": 4, "simId": "865242053215002"},
    {"deviceNo": 5, "simId": "867542058714729"},
    {"deviceNo": 6, "simId": "866569061879059"},
    {"deviceNo": 7, "simId": "866569062039257"},
    {"deviceNo": 8, "simId": "865242053099711"},
    {"deviceNo": 9, "simId": "865242053188282"},
    {"deviceNo": 10, "simId": "866569062057101"},
    {"deviceNo": 11, "simId": "867542058886006"},
    {"deviceNo": 12, "simId": "867542058727622"},
    {"deviceNo": 13, "simId": "865242053143469"},
    {"deviceNo": 14, "simId": "866569061326002"},
    {"deviceNo": 15, "simId": "866569061781370"},
    {"deviceNo": 16, "simId": "866569061925795"},
    {"deviceNo": 17, "simId": "865242053166627"},
    {"deviceNo": 18, "simId": "867542058612907"},
    {"deviceNo": 19, "simId": "866522075090106"},
    {"deviceNo": 20, "simId": "865242053201473"},
    {"deviceNo": 21, "simId": "866569061316128"},
    {"deviceNo": 22, "simId": "865242053196590"},
    {"deviceNo": 23, "simId": "868065073992616"},
    {"deviceNo": 24, "simId": "865242053104859"},
    {"deviceNo": 25, "simId": "866569061319197"},
    {"deviceNo": 26, "simId": "866569061549082"},
    {"deviceNo": 27, "simId": "866569061498363"},
    {"deviceNo": 28, "simId": "867542058727663"},
    {"deviceNo": 29, "simId": "868662050970241"},
    {"deviceNo": 30, "simId": "868065073944765"},
)

FORM_FIELDS = {
    "mapType": "2",
    "chargeTypeTag": "0",
    "appEntrance": "1",
    "version": "new",
}


def _read_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("%s 不是整数，使用默认值 %s", name, default)
        return default
    return min(max(value, minimum), maximum)


def _read_float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    try:
        value = float(raw)
    except ValueError:
        logger.warning("%s 不是数字，使用默认值 %s", name, default)
        return default
    return min(max(value, minimum), maximum)


def get_config() -> dict[str, Any]:
    upstream_url = (os.getenv("CHARGING_UPSTREAM_URL") or DEFAULT_UPSTREAM_URL).strip()
    if not upstream_url:
        upstream_url = DEFAULT_UPSTREAM_URL
    return {
        "upstream_url": upstream_url,
        "concurrency": _read_int_env(
            "CHARGING_CONCURRENCY", DEFAULT_CONCURRENCY, MIN_CONCURRENCY, MAX_CONCURRENCY
        ),
        "timeout_seconds": _read_float_env(
            "CHARGING_REQUEST_TIMEOUT",
            DEFAULT_TIMEOUT_SECONDS,
            MIN_TIMEOUT_SECONDS,
            MAX_TIMEOUT_SECONDS,
        ),
    }


def _sanitize_message(value: Any, fallback: str) -> str:
    if value is None:
        return fallback
    text = " ".join(str(value).split())
    if not text:
        return fallback
    return text[:MAX_ERROR_MESSAGE_LENGTH]


def _error_result(
    device_no: int,
    code: str,
    message: str,
    *,
    retryable: bool = False,
) -> dict[str, Any]:
    return {
        "deviceNo": device_no,
        "ok": False,
        "name": None,
        "portNumber": None,
        "ports": None,
        "error": {
            "code": code,
            "message": _sanitize_message(message, "设备状态查询失败"),
            "retryable": retryable,
        },
    }


def parse_device_payload(device_no: int, payload: Any) -> dict[str, Any]:
    """校验并归一化单个设备的 portDetail 响应。

    已核对结构：code=200；data.ports 为整数数组，长度等于 portNumber+1；
    ports[0] 为占位值 0。结构不符时返回 ok=false / invalid_response（不可重试，
    因为重试同一结构不会改变结果）。
    """
    if not isinstance(payload, dict):
        return _error_result(device_no, "invalid_response", "上游返回内容不是 JSON 对象")

    if payload.get("code") != 200:
        message = _sanitize_message(payload.get("message"), "上游返回未成功的业务码")
        return _error_result(device_no, "upstream_business", message, retryable=False)

    data = payload.get("data")
    if not isinstance(data, dict):
        return _error_result(device_no, "invalid_response", "响应缺少 data 对象")

    device = data.get("device")
    if not isinstance(device, dict):
        return _error_result(device_no, "invalid_response", "响应缺少 data.device 对象")

    port_number = device.get("portNumber")
    if isinstance(port_number, bool) or not isinstance(port_number, int) or port_number <= 0:
        return _error_result(device_no, "invalid_response", "device.portNumber 不是正整数")

    ports = data.get("ports")
    if not isinstance(ports, list):
        return _error_result(device_no, "invalid_response", "响应缺少 data.ports 数组")

    if len(ports) != port_number + 1:
        return _error_result(
            device_no,
            "invalid_response",
            "data.ports 长度与 portNumber 不匹配",
        )

    normalized_ports: list[int] = []
    for value in ports:
        if isinstance(value, bool) or not isinstance(value, int):
            return _error_result(device_no, "invalid_response", "data.ports 含非整数状态值")
        normalized_ports.append(value)

    if normalized_ports[0] != 0:
        return _error_result(
            device_no,
            "invalid_response",
            "data.ports 首项不是已核对的占位值 0",
        )

    name = device.get("name")
    return {
        "deviceNo": device_no,
        "ok": True,
        "name": name if isinstance(name, str) else "",
        "portNumber": port_number,
        "ports": normalized_ports,
        "error": None,
    }


async def fetch_device(
    client: httpx.AsyncClient,
    device: dict[str, Any],
    semaphore: asyncio.Semaphore,
    upstream_url: str,
) -> dict[str, Any]:
    """查询单台设备；任何失败都转换为该设备的错误结果，不抛出。"""
    device_no = int(device["deviceNo"])

    async with semaphore:
        form = dict(FORM_FIELDS)
        form["simId"] = str(device["simId"])

        try:
            response = await client.post(upstream_url, data=form)
        except httpx.TimeoutException:
            return _error_result(device_no, "timeout", "上游接口请求超时", retryable=True)
        except httpx.HTTPError:
            return _error_result(device_no, "network_error", "无法连接上游接口", retryable=True)
        except Exception:
            logger.exception("设备 %s 请求异常", device_no)
            return _error_result(device_no, "proxy_error", "代理请求设备状态时发生异常", retryable=True)

        if response.status_code != 200:
            return _error_result(
                device_no,
                "upstream_http",
                f"上游返回 HTTP {response.status_code}",
                retryable=response.status_code >= 500 or response.status_code == 429,
            )

        try:
            payload = response.json()
        except ValueError:
            return _error_result(device_no, "invalid_response", "上游返回了非 JSON 响应")

        return parse_device_payload(device_no, payload)


async def collect_devices(
    devices: Iterable[dict[str, Any]],
    *,
    upstream_url: str,
    concurrency: int,
    timeout_seconds: float,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[dict[str, Any]]:
    """按有限并发查询设备，返回顺序与输入一致。"""
    device_list = list(devices)
    limits = httpx.Limits(
        max_connections=max(concurrency, 1),
        max_keepalive_connections=max(concurrency, 1),
    )
    timeout = httpx.Timeout(timeout_seconds, connect=min(5.0, timeout_seconds))

    async with httpx.AsyncClient(
        timeout=timeout,
        limits=limits,
        transport=transport,
    ) as client:
        semaphore = asyncio.Semaphore(max(concurrency, 1))
        return await asyncio.gather(
            *(fetch_device(client, device, semaphore, upstream_url) for device in device_list)
        )


def build_response(results: list[dict[str, Any]], fetched_at: str) -> dict[str, Any]:
    succeeded = sum(1 for result in results if result.get("ok") is True)
    failed = len(results) - succeeded
    data = {
        "fetchedAt": fetched_at,
        "devices": results,
        "summary": {
            "total": len(results),
            "succeeded": succeeded,
            "failed": failed,
        },
    }

    if succeeded == 0:
        return {
            "ok": False,
            "error": {
                "code": "charging_upstream_unavailable",
                "message": f"{len(results)} 台设备均未返回有效状态",
                "retryable": True,
            },
            "data": data,
        }

    return {"ok": True, "data": data}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def query_status() -> dict[str, Any]:
    """同步查询全部桦苑设备，返回统一响应包（供 stdlib 主服务调用）。"""
    config = get_config()

    try:
        results = asyncio.run(
            collect_devices(
                DEVICES,
                upstream_url=config["upstream_url"],
                concurrency=config["concurrency"],
                timeout_seconds=config["timeout_seconds"],
            )
        )
    except Exception:
        logger.exception("桦苑充电口代理批次失败")
        return {
            "ok": False,
            "error": {
                "code": "charging_proxy_error",
                "message": "服务端代理查询充电口状态失败",
                "retryable": True,
            },
        }

    return build_response(results, now_iso())
