"""轻量的校园集市意图识别与检索词提取。

只做规则判断，不调用模型，避免在数据源不可用时产生虚假结果。
"""

from __future__ import annotations

import re

MARKET_TERMS = (
    "校园集市",
    "集市",
    "二手",
    "闲置",
    "求购",
    "转让",
    "出售",
    "跳蚤市场",
    "帖子",
)

PRODUCT_WORDS = (
    "显示器",
    "自行车",
    "电动车",
    "键盘",
    "鼠标",
    "手机",
    "电脑",
    "教材",
    "课本",
    "书",
    "宿舍",
    "台灯",
    "风扇",
    "椅子",
    "桌子",
)

_ACTION_WORDS = ("找", "买", "收", "卖", "出", "求", "租", "换", "多少钱", "价格", "预算")

_PRICE_RE = re.compile(r"(\d+\s*(元|块)|多少钱|价格|预算)")
_PRODUCT_RE = re.compile("|".join(PRODUCT_WORDS))
_ACTION_RE = re.compile("|".join(_ACTION_WORDS))

_NOISE_PREFIXES = (
    "帮我",
    "帮忙",
    "请问",
    "我想",
    "我要",
    "想",
    "找",
    "搜",
    "查",
    "看看",
    "有没有",
    "校园集市",
    "集市",
    "二手",
    "闲置",
    "求购",
    "转让",
    "出售",
)

_NOISE_PHRASES = (
    "元以内",
    "元以下",
    "左右",
    "可以自提",
    "可自提",
    "自提",
    "一台",
    "一个",
    "一件",
    "有没有",
    "谢谢",
)


def is_market_query(text: str) -> bool:
    text = (text or "").strip()
    if not text:
        return False
    if any(term in text for term in MARKET_TERMS):
        return True
    if _PRICE_RE.search(text) and _ACTION_RE.search(text):
        return True
    if _ACTION_RE.search(text) and _PRODUCT_RE.search(text):
        return True
    return False


def extract_keyword(text: str) -> str:
    """从自然语言中提取一个可交给数据源的检索词。

    这是保守的规则处理：不猜测用户未表达的商品或条件。
    """
    keyword = (text or "").strip()
    while keyword:
        prefix = next((item for item in _NOISE_PREFIXES if keyword.startswith(item)), None)
        if prefix is None:
            break
        keyword = keyword[len(prefix):].strip()
    for phrase in _NOISE_PHRASES:
        keyword = keyword.replace(phrase, " ")
    keyword = re.sub(r"[，。！？、；：,.!?;:（）()【】\[\]]", " ", keyword)
    keyword = re.sub(r"\d+\s*(元|块|以内|以下)?", " ", keyword)
    keyword = re.sub(r"\s+", " ", keyword).strip()
    if len(keyword) > 40:
        keyword = keyword[:40].strip()
    return keyword or (text or "").strip()[:40]
