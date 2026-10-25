"""校园集市 Agent 的 FastAPI 路由。

浏览器只访问本项目的 `/api/config`、`/api/market/*`、`/api/chat`。
没有真实集市适配器时，读取接口返回 MARKET_UNAVAILABLE；
模型 Key 只留在服务端环境变量中。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ..market_agent import ChatService, MarketApiError
from ..market_service import MarketUnavailable

router = APIRouter(prefix="/api", tags=["market-agent"])

_service: ChatService | None = None


def get_service() -> ChatService:
    global _service
    if _service is None:
        _service = ChatService.from_env()
    return _service


def reset_service() -> None:
    """测试或配置变更后重建服务。"""
    global _service
    _service = None


def _ok(data) -> JSONResponse:
    return JSONResponse(
        {"ok": True, "data": data},
        headers={"Cache-Control": "no-store"},
    )


def _error(status: int, code: str, message: str, retryable: bool = False) -> JSONResponse:
    return JSONResponse(
        {
            "ok": False,
            "error": {"code": code, "message": message, "retryable": retryable},
        },
        status_code=status,
        headers={"Cache-Control": "no-store"},
    )


def _int_param(request: Request, name: str, fallback: int) -> int:
    raw = request.query_params.get(name)
    if raw in (None, ""):
        return fallback
    try:
        return int(raw)
    except ValueError:
        raise MarketApiError(400, "INVALID_REQUEST", f"{name} 必须是整数") from None


@router.get("/config")
def agent_config(service: ChatService = Depends(get_service)) -> JSONResponse:
    return _ok(service.config_payload())


@router.get("/market/posts")
def market_posts(request: Request, service: ChatService = Depends(get_service)) -> JSONResponse:
    try:
        limit = _int_param(request, "limit", 20)
        return _ok(service.market.latest(limit))
    except MarketApiError as exc:
        return _error(exc.status, exc.code, exc.message, exc.retryable)
    except MarketUnavailable:
        return _error(503, "MARKET_UNAVAILABLE", "真实数据源未配置/不可用")
    except ValueError as exc:
        return _error(400, "INVALID_REQUEST", str(exc))


@router.get("/market/hot")
def market_hot(request: Request, service: ChatService = Depends(get_service)) -> JSONResponse:
    try:
        limit = _int_param(request, "limit", 20)
        return _ok(service.market.hot(limit))
    except MarketApiError as exc:
        return _error(exc.status, exc.code, exc.message, exc.retryable)
    except MarketUnavailable:
        return _error(503, "MARKET_UNAVAILABLE", "真实数据源未配置/不可用")
    except ValueError as exc:
        return _error(400, "INVALID_REQUEST", str(exc))


@router.get("/market/search")
def market_search(request: Request, service: ChatService = Depends(get_service)) -> JSONResponse:
    keyword = (request.query_params.get("keyword") or "").strip()
    if not keyword:
        return _error(400, "INVALID_REQUEST", "keyword 不能为空")
    try:
        page = _int_param(request, "page", 1)
        limit = _int_param(request, "limit", 20)
        return _ok(service.market.search(keyword, page, limit))
    except MarketApiError as exc:
        return _error(exc.status, exc.code, exc.message, exc.retryable)
    except MarketUnavailable:
        return _error(503, "MARKET_UNAVAILABLE", "真实数据源未配置/不可用")
    except ValueError as exc:
        return _error(400, "INVALID_REQUEST", str(exc))


@router.post("/chat")
async def chat(request: Request, service: ChatService = Depends(get_service)) -> JSONResponse:
    try:
        payload = await request.json()
    except Exception:
        return _error(400, "INVALID_REQUEST", "请求体必须是合法 JSON")
    if not isinstance(payload, dict):
        return _error(400, "INVALID_REQUEST", "请求体必须是 JSON 对象")
    try:
        return _ok(service.chat(payload))
    except MarketApiError as exc:
        return _error(exc.status, exc.code, exc.message, exc.retryable)
    except Exception:
        return _error(500, "INTERNAL_ERROR", "服务内部错误", True)
