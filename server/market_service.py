"""集市只读数据源适配层。

当前仓库不包含任何可确认的真实市场 API 客户端，也没有可用凭据或成功响应，
因此默认 provider 是 unavailable，所有读取接口返回 MARKET_UNAVAILABLE。

后续接入真实只读适配器时，实现 `MarketProvider` 协议并保证：
- 只返回上游响应中实际存在的字段，不补造默认值；
- 缺失字段保持缺失，由前端显示“未提供”；
- 不提供点赞、评论、发帖、删除等写操作。
"""

from __future__ import annotations

import hashlib
import json
import random
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class MarketUnavailable(Exception):
    code = "MARKET_UNAVAILABLE"
    message = "真实数据源未配置/不可用"
    retryable = False


class MarketProviderError(Exception):
    """经过脱敏的上游错误，供 API 层返回稳定错误码。"""

    def __init__(self, code: str, message: str, status: int = 502, retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retryable = retryable


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


class ZanaoProvider:
    """赞哦校园集市只读适配器。凭据仅保存在服务端配置中。"""

    name = "zanao"
    base_url = "https://api.x.zanao.com"
    _signature_salt = "1b6d2514354bc407afdd935f45521a8c"
    _appid = "wx3921ddb0258ff14f"

    def __init__(self, token: str, school_alias: str = "scu", category_id: str = "10", timeout: float = 25.0):
        self.token = token.strip()
        self.school_alias = school_alias or "scu"
        self.category_id = category_id or "10"
        self.timeout = max(1.0, min(float(timeout), 60.0))
        self._connected: bool | None = None
        self._last_error: str | None = None

    def status(self) -> dict:
        if not self.token:
            return {
                "available": False,
                "provider": self.name,
                "code": "MARKET_UNAVAILABLE",
                "message": "未配置赞哦 Token",
                "connected": False,
            }
        if self._connected is True:
            return {"available": True, "provider": self.name, "connected": True, "message": "赞哦数据源已验证"}
        if self._connected is False:
            return {
                "available": True,
                "provider": self.name,
                "connected": False,
                "message": self._last_error or "已配置赞哦数据源，最近一次连接失败",
            }
        return {
            "available": True,
            "provider": self.name,
            "connected": None,
            "message": "已配置赞哦数据源，首次检索时验证连接",
        }

    def _headers(self) -> dict[str, str]:
        nonce = "".join(str(random.randint(0, 9)) for _ in range(20))
        timestamp = str(int(time.time()))
        sign = f"{self.school_alias}_{nonce}_{timestamp}_{self._signature_salt}"
        return {
            "X-Sc-Version": "3.4.4",
            "X-Sc-Nwt": "wifi",
            "X-Sc-Wf": "",
            "X-Sc-Nd": nonce,
            "X-Sc-Cloud": "0",
            "X-Sc-Platform": "windows",
            "X-Sc-Appid": self._appid,
            "X-Sc-Alias": self.school_alias,
            "X-Sc-Od": self.token,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Sc-Ah": hashlib.md5(sign.encode("utf-8")).hexdigest(),
            "xweb_xhr": "1",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781 MiniProgramEnv/Windows",
            "X-Sc-Td": timestamp,
            "Accept": "application/json, */*",
        }

    def _request(self, path: str, params: dict) -> dict:
        if not self.token:
            raise MarketUnavailable
        query = urlencode({key: value for key, value in params.items() if value is not None})
        request = Request(f"{self.base_url}{path}?{query}", headers=self._headers(), method="POST")
        try:
            with urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except HTTPError as exc:
            if exc.code in (401, 403):
                self._connected = False
                self._last_error = "赞哦鉴权失败，请更新服务端 Token"
                raise MarketProviderError("MARKET_AUTH_FAILED", self._last_error, 503, False) from None
            self._connected = False
            self._last_error = "赞哦服务暂时无法处理请求"
            raise MarketProviderError("MARKET_UPSTREAM_ERROR", self._last_error, 502, exc.code >= 500) from None
        except (URLError, TimeoutError, OSError):
            self._connected = False
            self._last_error = "无法连接赞哦服务或请求超时"
            raise MarketProviderError("MARKET_UPSTREAM_UNREACHABLE", self._last_error, 502, True) from None
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._connected = False
            self._last_error = "赞哦服务返回格式异常"
            raise MarketProviderError("MARKET_BAD_RESPONSE", self._last_error, 502, True) from None

        if not isinstance(payload, dict):
            self._connected = False
            self._last_error = "赞哦服务返回格式异常"
            raise MarketProviderError("MARKET_BAD_RESPONSE", self._last_error, 502, True)
        errno = payload.get("errno")
        if errno not in (0, "0", None):
            self._connected = False
            if str(errno) in ("401", "403"):
                self._last_error = "赞哦鉴权失败，请更新服务端 Token"
                raise MarketProviderError("MARKET_AUTH_FAILED", self._last_error, 503, False)
            self._last_error = "赞哦服务返回业务错误"
            raise MarketProviderError("MARKET_UPSTREAM_ERROR", self._last_error, 502, True)
        self._connected = True
        self._last_error = None
        return payload

    @staticmethod
    def _items(payload: dict) -> list[dict]:
        data = payload.get("data")
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            items = data.get("list")
            if not isinstance(items, list):
                items = []
        else:
            items = []
        return [item for item in items if isinstance(item, dict)]

    @staticmethod
    def _string(value) -> str | None:
        if value is None or value == "":
            return None
        return str(value).strip() or None

    @classmethod
    def _normalize_post(cls, item: dict) -> dict:
        return {
            "id": cls._string(item.get("thread_id") or item.get("id")),
            "title": cls._string(item.get("title")),
            "content": cls._string(item.get("content")),
            "nickname": cls._string(item.get("nickname")),
            "category": cls._string(item.get("cate_name")),
            "view_count": cls._string(item.get("view_count")),
            "comment_count": cls._string(item.get("c_count") or item.get("comment_count")),
            "like_count": cls._string(item.get("l_count") or item.get("like_count")),
            "post_time": cls._string(item.get("post_time") or item.get("created_at") or item.get("time")),
            "timestamp": cls._string(item.get("p_time")),
            "contact": cls._string(item.get("contact") or item.get("contact_wx") or item.get("contact_phone")),
            "url": cls._string(item.get("url") or item.get("link")),
        }

    def _result(self, path: str, params: dict, limit: int) -> dict:
        posts = [self._normalize_post(item) for item in self._items(self._request(path, params))]
        return {"provider": self.name, "posts": posts[:limit]}

    def latest(self, limit: int) -> dict:
        return self._result("/thread/v2/list", {"from_time": "0", "with_comment": "false", "with_reply": "false"}, limit)

    def hot(self, limit: int) -> dict:
        return self._result("/thread/hot", {"count": limit, "type": 3}, limit)

    def search(self, keyword: str, page: int, limit: int) -> dict:
        return self._result("/thread/v2/search", {"wd": keyword, "cur_page": page, "cate_id": self.category_id}, limit)


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
