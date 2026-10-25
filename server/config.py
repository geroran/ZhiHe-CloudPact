"""校园集市 Agent 的最小服务端配置。

所有秘密（模型 API Key 等）只从服务端环境变量或本地 `.env` 读取，
不会返回给浏览器，也不会写入日志。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SYSTEM_PROMPT = (
    "你是一个谨慎、直接的校园集市助手。"
    "只能依据后端提供的真实检索结果回答，不得编造帖子、价格、联系方式、"
    "地点、时间或库存；检索结果缺失的字段写“未提供”，没有结果时写“未检索到”。"
    "先给结论，再列结果。"
)


@dataclass(frozen=True)
class Config:
    app_name: str = "校园集市 Agent"
    host: str = "127.0.0.1"
    port: int = 8011
    static_dir: Path = ROOT_DIR / "dist"

    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = ""
    openai_temperature: float = 0.4
    model_timeout: float = 90.0
    system_prompt: str = DEFAULT_SYSTEM_PROMPT

    market_provider: str = "disabled"

    @property
    def model_configured(self) -> bool:
        return bool(self.openai_api_key.strip() and self.openai_model.strip())


def _read_float(value: str | None, fallback: float) -> float:
    try:
        return float(value) if value not in (None, "") else fallback
    except (TypeError, ValueError):
        return fallback


def _read_int(value: str | None, fallback: int) -> int:
    try:
        return int(value) if value not in (None, "") else fallback
    except (TypeError, ValueError):
        return fallback


def load_env_file(path: Path) -> None:
    """加载简单 KEY=VALUE 格式的本地配置，不覆盖已有环境变量。

    仅用于本地开发；不打印、不记录任何值。
    """
    if not path.is_file():
        return
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        text = line.strip()
        if not text or text.startswith("#") or "=" not in text:
            continue
        key, value = text.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in os.environ:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        os.environ[key] = value


def config_from_env() -> Config:
    load_env_file(ROOT_DIR / ".env")
    return Config(
        app_name=os.getenv("APP_NAME", "校园集市 Agent"),
        host=os.getenv("APP_HOST", "127.0.0.1"),
        port=_read_int(os.getenv("APP_PORT"), 8011),
        static_dir=Path(os.getenv("STATIC_DIR", str(ROOT_DIR / "dist"))),
        openai_api_key=os.getenv("OPENAI_API_KEY", ""),
        openai_base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        openai_model=os.getenv("OPENAI_MODEL", ""),
        openai_temperature=_read_float(os.getenv("OPENAI_TEMPERATURE"), 0.4),
        model_timeout=_read_float(os.getenv("MODEL_TIMEOUT"), 90.0),
        system_prompt=os.getenv("SYSTEM_PROMPT", DEFAULT_SYSTEM_PROMPT) or DEFAULT_SYSTEM_PROMPT,
        market_provider=os.getenv("MARKET_PROVIDER", "disabled").strip().lower() or "disabled",
    )
