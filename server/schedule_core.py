"""AI 课表截图识别的服务端核心。

职责边界：
- 只在服务端持有 DeepSeek API Key（环境变量优先，其次 Git 忽略的 `.env.local`）；
- 把前端压缩后的 base64 图片发给支持视觉的 `deepseek-flash`；
- 对模型返回内容做 JSON 提取、字段校验与归一化，只回传课程白名单字段；
- 任何错误都映射为本项目统一的 `{ok:false,error:{code,message,retryable}}`。

不记录密钥、图片内容或上游原始响应。
"""

from __future__ import annotations

import base64
import binascii
import json
import os
import re
import socket
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = ROOT / ".env.local"
DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-flash"
MAX_IMAGE_BYTES = 12 * 1024 * 1024
AI_TIMEOUT_SECONDS = 150
ALLOWED_MIME = ("image/jpeg", "image/png", "image/webp", "image/gif")
MAX_COURSES = 80

DATA_URL_PATTERN = re.compile(r"^data:(image/[a-z]+);base64,(.+)$", re.S)

PROMPT = (
    "你是课表图片结构化识别器。仅依据图片中清晰可见的信息提取课程，"
    "不得猜测缺失的课程名、教师、教室、星期或周次。"
    "网格型课表：横向列标题表示星期，左侧行标题表示节次，卡片纵向覆盖的起止行即开始/结束节次；"
    "文字型课表：从卡片文字中读取“星期几”“第几节”。"
    "周次统一转换为 from、to、parity，parity 只能是 all、odd、even；"
    "“1-18周”=all，“1-18周(单)”=odd，“1-18周(双)”=even；"
    "“第2、4、6周”拆成多条规则；多段周次（如“1-8周,10-18周(双)”）分别保存为多条规则；"
    "无法确认的字段名放入 needsReview，无法读取的可选文字留空。"
    "每个不同的星期/节次安排输出一条记录，同一门课不同时间不得合并。"
    "只返回 JSON，不要解释过程，不要输出 Markdown。结构："
    '{"courses":[{"courseName":"课程名","teacher":"","classroom":"",'
    '"weekday":1,"startSection":1,"endSection":2,'
    '"weekRules":[{"from":1,"to":18,"parity":"all"}],'
    '"rawText":"","needsReview":[]}]}。'
    "weekday 取 1-7（周一至周日）；节次为整数；没有识别到课程时返回 {\"courses\":[]}。"
)


class ConfigError(Exception):
    """服务端未配置 API Key。"""


class ImageError(Exception):
    """图片格式或大小不合法。"""


class AiTimeout(Exception):
    """上游超时。"""


class AiUnavailable(Exception):
    """上游不可达。"""


class AiHttpError(Exception):
    def __init__(self, status: int, body: str = ""):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.body = body


def api_error(code: str, message: str, retryable: bool = False) -> dict:
    return {"ok": False, "error": {"code": code, "message": message, "retryable": retryable}}


def _read_env_file(path: Path) -> dict:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return values
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        values[key.strip()] = value
    return values


def load_config(config_path: Path = DEFAULT_CONFIG_PATH) -> dict:
    """环境变量优先，`.env.local` 兜底；不打印任何值。"""
    file_values = _read_env_file(config_path)

    def pick(name: str, fallback: str = "") -> str:
        return (os.environ.get(name) or file_values.get(name) or fallback).strip()

    return {
        "api_key": pick("DEEPSEEK_API_KEY"),
        "base_url": pick("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        "model": pick("DEEPSEEK_MODEL", DEFAULT_MODEL),
        "config_path": config_path,
    }


def parse_image(data_url: str) -> tuple[str, str]:
    """校验 data URL，返回 (mime, base64 字符串)。"""
    if not isinstance(data_url, str):
        raise ImageError("图片数据格式不正确")
    match = DATA_URL_PATTERN.match(data_url.strip())
    if not match:
        raise ImageError("图片必须是 base64 data URL")
    mime = match.group(1).lower()
    if mime == "image/jpg":
        mime = "image/jpeg"
    if mime not in ALLOWED_MIME:
        raise ImageError("仅支持 JPEG、PNG、WebP、GIF 图片")
    payload = match.group(2)
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise ImageError("图片 base64 数据损坏") from None
    if not raw:
        raise ImageError("图片内容为空")
    if len(raw) > MAX_IMAGE_BYTES:
        raise ImageError("图片过大，请裁剪或压缩后重试")
    return mime, payload


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def extract_json(text: str):
    """从模型输出中提取第一个 JSON 对象；失败返回 None。"""
    if not isinstance(text, str):
        return None
    candidate = _strip_code_fence(text)
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        return json.loads(candidate[start : end + 1])
    except json.JSONDecodeError:
        return None


def _as_int(value, minimum: int, maximum: int):
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    if number < minimum or number > maximum:
        return None
    return number


def _clean_text(value, limit: int = 120) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def normalize_week_rules(raw_rules) -> list[dict]:
    if isinstance(raw_rules, dict):
        raw_rules = [raw_rules]
    if not isinstance(raw_rules, list):
        return []
    rules: list[dict] = []
    for item in raw_rules:
        if not isinstance(item, dict):
            continue
        start = _as_int(item.get("from"), 1, 60)
        end = _as_int(item.get("to"), 1, 60)
        parity = item.get("parity")
        if start is None or end is None or end < start:
            continue
        if parity not in ("all", "odd", "even"):
            parity = "all"
        rules.append({"from": start, "to": end, "parity": parity})
    return rules


def normalize_courses(payload) -> tuple[list[dict], list[str]]:
    """把模型输出归一化为课程白名单字段，返回 (courses, warnings)。"""
    if isinstance(payload, list):
        payload = {"courses": payload}
    if not isinstance(payload, dict):
        raise ValueError("模型返回不是 JSON 对象")

    raw_courses = payload.get("courses")
    if not isinstance(raw_courses, list):
        raise ValueError("模型返回缺少 courses 数组")

    courses: list[dict] = []
    skipped = 0
    for item in raw_courses[:MAX_COURSES]:
        if not isinstance(item, dict):
            skipped += 1
            continue
        name = _clean_text(item.get("courseName"))
        if not name:
            skipped += 1
            continue
        weekday = _as_int(item.get("weekday"), 1, 7)
        start = _as_int(item.get("startSection"), 1, 30)
        end = _as_int(item.get("endSection"), 1, 30)
        rules = normalize_week_rules(item.get("weekRules"))
        needs_review = [
            str(field)
            for field in (item.get("needsReview") or [])
            if isinstance(field, (str, int)) and str(field).strip()
        ][:8]

        if weekday is None or start is None or end is None or not rules:
            # 关键字段缺失不静默丢弃：标记待确认，仍交给用户校对。
            if weekday is None:
                needs_review.append("weekday")
            if start is None:
                needs_review.append("startSection")
            if end is None:
                needs_review.append("endSection")
            if not rules:
                needs_review.append("weekRules")
        if start is not None and end is not None and end < start:
            end = start
            needs_review.append("endSection")

        courses.append(
            {
                "courseName": name,
                "teacher": _clean_text(item.get("teacher"), 60),
                "classroom": _clean_text(item.get("classroom"), 80),
                "weekday": weekday if weekday is not None else 0,
                "startSection": start if start is not None else 0,
                "endSection": end if end is not None else 0,
                "weekRules": rules,
                "rawText": _clean_text(item.get("rawText"), 400),
                "needsReview": sorted(set(needs_review)),
            }
        )

    warnings: list[str] = []
    if skipped:
        warnings.append(f"有 {skipped} 条记录缺少课程名称，已跳过")
    if not courses:
        warnings.append("未能从图片中识别出课程")
    return courses, warnings


def call_deepseek(data_url: str, config: dict, opener=None) -> dict:
    """调用 DeepSeek Chat Completions 视觉接口，返回解析后的 JSON 对象。"""
    opener = opener or urllib.request.build_opener()
    payload = {
        "model": config["model"],
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {"url": data_url, "detail": "original"},
                    },
                ],
            }
        ],
        "max_tokens": 4000,
        "temperature": 0,
        "thinking": {"type": "disabled"},
        "stream": False,
    }
    request = urllib.request.Request(
        f"{config['base_url']}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    try:
        with opener.open(request, timeout=AI_TIMEOUT_SECONDS) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8", "replace")
        except Exception:
            body = ""
        raise AiHttpError(exc.code, body) from None
    except (TimeoutError, socket.timeout) as exc:
        raise AiTimeout from exc
    except (urllib.error.URLError, OSError) as exc:
        raise AiUnavailable from exc

    try:
        body = json.loads(raw.decode("utf-8"))
        content = body["choices"][0]["message"].get("content")
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, IndexError, TypeError):
        raise ValueError("AI 返回结构异常") from None

    parsed = extract_json(content if isinstance(content, str) else "")
    if parsed is None:
        raise ValueError("AI 未返回可解析的 JSON")
    return parsed


def recognize(data_url: str, config_path: Path = DEFAULT_CONFIG_PATH, opener=None) -> tuple[int, dict]:
    """完整识别流程：校验图片 → 调模型 → 归一化 → 统一响应结构。"""
    try:
        parse_image(data_url)
    except ImageError as exc:
        return 400, api_error("INVALID_IMAGE", str(exc))

    config = load_config(config_path)
    if not config["api_key"]:
        return 503, api_error(
            "MODEL_NOT_CONFIGURED",
            "服务端未配置 DEEPSEEK_API_KEY，请在 .env.local 或环境变量中配置后重启服务。",
        )

    try:
        parsed = call_deepseek(data_url.strip(), config, opener=opener)
    except AiTimeout:
        return 504, api_error("AI_TIMEOUT", "AI 识别超时，请稍后重试或裁剪图片后重试", True)
    except AiUnavailable:
        return 502, api_error("AI_UNAVAILABLE", "无法连接 AI 识别服务，请检查网络后重试", True)
    except AiHttpError as exc:
        if exc.status in (401, 403):
            return 502, api_error("AI_AUTH_FAILED", "AI 服务鉴权失败，请检查服务端密钥配置")
        if exc.status == 429:
            return 429, api_error("AI_RATE_LIMITED", "AI 识别请求过于频繁，请稍后重试", True)
        return 502, api_error("AI_UPSTREAM_ERROR", f"AI 识别服务返回异常（HTTP {exc.status}）", True)
    except ValueError as exc:
        return 502, api_error("AI_BAD_RESPONSE", f"识别结果无法解析：{exc}", True)

    try:
        courses, warnings = normalize_courses(parsed)
    except ValueError as exc:
        return 502, api_error("AI_BAD_RESPONSE", f"识别结果格式不正确：{exc}", True)

    if not courses:
        return 422, api_error("NO_COURSES", "未能识别出课程，请上传更清晰的课表截图或裁剪课表主体后重试")

    return 200, {"ok": True, "data": {"courses": courses, "warnings": warnings}}
