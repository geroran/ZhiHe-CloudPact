"""OpenAI Chat Completions 兼容模型的最小服务端客户端。

浏览器只调用本项目后端，模型 API Key 不进入前端、响应或日志。
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request


class ModelError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class ModelClient:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        model: str,
        temperature: float = 0.4,
        timeout: float = 90.0,
    ):
        self.api_key = api_key
        self.base_url = (base_url or "").rstrip("/")
        self.model = model
        self.temperature = temperature
        self.timeout = timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key.strip() and self.model.strip() and self.base_url)

    def _endpoint(self) -> str:
        if self.base_url.endswith("/chat/completions"):
            return self.base_url
        return f"{self.base_url}/chat/completions"

    def complete(self, messages: list[dict]) -> str:
        if not self.configured:
            raise ModelError("MODEL_NOT_CONFIGURED", "模型服务未配置，无法生成回答", False)

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": self.temperature,
            "stream": False,
        }
        request = urllib.request.Request(
            self._endpoint(),
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            # 只暴露状态码，不记录或返回上游响应正文/凭据。
            if exc.code in (401, 403):
                raise ModelError("MODEL_AUTH_FAILED", "模型服务鉴权失败", False) from None
            if exc.code == 429:
                raise ModelError("MODEL_RATE_LIMITED", "模型服务请求过于频繁", True) from None
            raise ModelError("MODEL_REQUEST_FAILED", "模型服务请求失败", True) from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ModelError("MODEL_UNREACHABLE", "模型服务不可达或请求超时", True) from None

        try:
            data = json.loads(raw.decode("utf-8"))
            content = data["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise ModelError("MODEL_BAD_RESPONSE", "模型服务返回格式异常", True) from None

        if not isinstance(content, str) or not content.strip():
            raise ModelError("MODEL_EMPTY_RESPONSE", "模型服务未返回有效内容", True)
        return content.strip()
