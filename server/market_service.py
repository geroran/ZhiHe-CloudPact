"""集市只读数据源适配层。

当前仓库不包含任何可确认的真实市场 API 客户端，也没有可用凭据或成功响应，
因此默认 provider 是 unavailable，所有读取接口返回 MARKET_UNAVAILABLE。

后续接入真实只读适配器时，实现 `MarketProvider` 协议并保证：
- 只返回上游响应中实际存在的字段，不补造默认值；
- 缺失字段保持缺失，由前端显示“未提供”；
- 不提供点赞、评论、发帖、删除等写操作。
"""

from __future__ import annotations

from datetime import datetime, timezone


class MarketUnavailable(Exception):
    code = "MARKET_UNAVAILABLE"
    message = "真实数据源未配置/不可用"
    retryable = False


class UnavailableProvider:
    """没有真实适配器时的占位 provider。"""

    def __init__(self, name: str = "disabled", message: str | None = None):
        self.name = name
        self.message = message or MarketUnavailable.message

    def status(self) -> dict:
        return {
            "available": False,
            "provider": self.name,
            "code": MarketUnavailable.code,
            "message": self.message,
        }

    def latest(self, limit: int) -> dict:
        raise MarketUnavailable

    def hot(self, limit: int) -> dict:
        raise MarketUnavailable

    def search(self, keyword: str, page: int, limit: int) -> dict:
        raise MarketUnavailable


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class MarketService:
    """聊天、浏览和未来任务共用的只读服务入口。"""

    def __init__(self, provider=None):
        self.provider = provider or UnavailableProvider()

    def status(self) -> dict:
        return self.provider.status()

    @property
    def available(self) -> bool:
        return bool(self.provider.status().get("available"))

    def latest(self, limit: int = 20) -> dict:
        limit = max(1, min(int(limit), 50))
        return self._with_meta(self.provider.latest(limit))

    def hot(self, limit: int = 20) -> dict:
        limit = max(1, min(int(limit), 50))
        return self._with_meta(self.provider.hot(limit))

    def search(self, keyword: str, page: int = 1, limit: int = 20) -> dict:
        keyword = (keyword or "").strip()
        if not keyword:
            raise ValueError("keyword 不能为空")
        page = max(1, min(int(page), 100))
        limit = max(1, min(int(limit), 50))
        return self._with_meta(self.provider.search(keyword, page, limit))

    def _with_meta(self, result: dict) -> dict:
        if not isinstance(result, dict):
            return {"provider": self.provider.name, "retrieved_at": _now_iso(), "posts": []}
        posts = result.get("posts")
        if not isinstance(posts, list):
            posts = []
        data = dict(result)
        data["provider"] = result.get("provider") or self.provider.name
        data["retrieved_at"] = result.get("retrieved_at") or _now_iso()
        data["posts"] = posts
        return data
