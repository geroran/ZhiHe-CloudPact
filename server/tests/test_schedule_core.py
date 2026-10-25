"""AI 课表识别服务端核心测试。

不访问真实 DeepSeek：通过注入假 opener 验证请求结构、错误映射与字段归一化。
"""

from __future__ import annotations

import base64
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server import schedule_core  # noqa: E402

IMAGE_DATA_URL = "data:image/jpeg;base64," + base64.b64encode(b"fake-jpeg-bytes").decode()

MODEL_OUTPUT = {
    "courses": [
        {
            "courseName": "高等数学",
            "teacher": "王老师",
            "classroom": "力行楼1201",
            "weekday": 1,
            "startSection": 1,
            "endSection": 2,
            "weekRules": [{"from": 1, "to": 16, "parity": "all"}],
            "rawText": "高等数学 1-16周",
            "needsReview": [],
        },
        {
            "courseName": "大学英语",
            "teacher": "",
            "classroom": "文汇楼2103",
            "weekday": 1,
            "startSection": 3,
            "endSection": 4,
            "weekRules": [{"from": 1, "to": 16, "parity": "even"}],
            "rawText": "1-16周(双)",
            "needsReview": [],
        },
    ]
}


def model_response(content) -> bytes:
    return json.dumps({"choices": [{"message": {"content": content}}]}).encode("utf-8")


class FakeResponse:
    def __init__(self, body: bytes):
        self._body = body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._body


class FakeOpener:
    def __init__(self, body: bytes = b"", error: Exception | None = None):
        self.body = body
        self.error = error
        self.request = None
        self.timeout = None

    def open(self, request, timeout=None):
        self.request = request
        self.timeout = timeout
        if self.error:
            raise self.error
        return FakeResponse(self.body)


def http_error(code: int) -> urllib.error.HTTPError:
    return urllib.error.HTTPError(
        "https://api.deepseek.com/chat/completions",
        code,
        "error",
        {},
        io.BytesIO(b'{"error":{"message":"failed"}}'),
    )


class ScheduleCoreTest(unittest.TestCase):
    def setUp(self):
        self.config_file = tempfile.NamedTemporaryFile("w", suffix=".env", delete=False)
        self.config_file.write("DEEPSEEK_API_KEY=test-key\nDEEPSEEK_MODEL=deepseek-flash\n")
        self.config_file.close()
        self.config_path = Path(self.config_file.name)
        self.addCleanup(os.unlink, self.config_file.name)

    def recognize(self, opener, image=IMAGE_DATA_URL):
        return schedule_core.recognize(image, config_path=self.config_path, opener=opener)

    def test_parse_image_accepts_supported_formats(self):
        for mime in ("image/jpeg", "image/png", "image/webp", "image/gif"):
            url = f"data:{mime};base64," + base64.b64encode(b"x").decode()
            parsed_mime, payload = schedule_core.parse_image(url)
            self.assertEqual(parsed_mime, mime)
            self.assertTrue(payload)

    def test_parse_image_rejects_invalid_input(self):
        for value in ("", "not-a-data-url", "data:text/plain;base64,QUJD", "data:image/png;base64,@@@"):
            with self.assertRaises(schedule_core.ImageError, msg=value):
                schedule_core.parse_image(value)

    def test_extract_json_handles_code_fence_and_noise(self):
        self.assertEqual(
            schedule_core.extract_json("```json\n{\"courses\":[]}\n```"), {"courses": []}
        )
        self.assertEqual(
            schedule_core.extract_json("说明文字 {\"courses\":[]} 结束"), {"courses": []}
        )
        self.assertIsNone(schedule_core.extract_json("没有 JSON"))

    def test_normalize_courses_marks_review_instead_of_dropping(self):
        courses, warnings = schedule_core.normalize_courses(
            {
                "courses": [
                    {"courseName": "体育", "weekday": None, "startSection": 1},
                    {"courseName": "   ", "weekday": 1},
                ]
            }
        )
        self.assertEqual(len(courses), 1)
        self.assertEqual(courses[0]["courseName"], "体育")
        self.assertIn("weekday", courses[0]["needsReview"])
        self.assertIn("weekRules", courses[0]["needsReview"])
        self.assertEqual(warnings, ["有 1 条记录缺少课程名称，已跳过"])

    def test_normalize_courses_rejects_bad_payload(self):
        with self.assertRaises(ValueError):
            schedule_core.normalize_courses({"courses": "nope"})
        with self.assertRaises(ValueError):
            schedule_core.normalize_courses("nope")

    def test_success_returns_whitelisted_courses(self):
        opener = FakeOpener(model_response("```json\n" + json.dumps(MODEL_OUTPUT) + "\n```"))
        status, body = self.recognize(opener)

        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(len(body["data"]["courses"]), 2)
        first = body["data"]["courses"][0]
        self.assertEqual(
            set(first),
            {
                "courseName",
                "teacher",
                "classroom",
                "weekday",
                "startSection",
                "endSection",
                "weekRules",
                "rawText",
                "needsReview",
            },
        )
        self.assertEqual(first["weekRules"], [{"from": 1, "to": 16, "parity": "all"}])
        self.assertEqual(
            body["data"]["courses"][1]["weekRules"], [{"from": 1, "to": 16, "parity": "even"}]
        )

        request = opener.request
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["model"], "deepseek-flash")
        self.assertEqual(payload["thinking"], {"type": "disabled"})
        self.assertEqual(payload["messages"][0]["content"][1]["type"], "image_url")
        self.assertIn("data:image/jpeg;base64,", payload["messages"][0]["content"][1]["image_url"]["url"])
        self.assertNotIn("test-key", request.data.decode("utf-8"))

    def test_invalid_image_is_rejected_before_calling_ai(self):
        opener = FakeOpener(model_response("{}"))
        status, body = self.recognize(opener, image="data:text/plain;base64,QUJD")
        self.assertEqual(status, 400)
        self.assertEqual(body["error"]["code"], "INVALID_IMAGE")
        self.assertIsNone(opener.request)

    def test_missing_api_key_reports_not_configured(self):
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as empty:
            empty.write("DEEPSEEK_API_KEY=\n")
        self.addCleanup(os.unlink, empty.name)
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("DEEPSEEK_API_KEY", None)
            status, body = schedule_core.recognize(
                IMAGE_DATA_URL, config_path=Path(empty.name), opener=FakeOpener()
            )
        self.assertEqual(status, 503)
        self.assertEqual(body["error"]["code"], "MODEL_NOT_CONFIGURED")

    def test_auth_failure_and_rate_limit_mapping(self):
        status, body = self.recognize(FakeOpener(error=http_error(401)))
        self.assertEqual(status, 502)
        self.assertEqual(body["error"]["code"], "AI_AUTH_FAILED")

        status, body = self.recognize(FakeOpener(error=http_error(429)))
        self.assertEqual(status, 429)
        self.assertEqual(body["error"]["code"], "AI_RATE_LIMITED")
        self.assertTrue(body["error"]["retryable"])

    def test_timeout_and_unreachable_mapping(self):
        status, body = self.recognize(FakeOpener(error=TimeoutError()))
        self.assertEqual(status, 504)
        self.assertEqual(body["error"]["code"], "AI_TIMEOUT")

        status, body = self.recognize(FakeOpener(error=urllib.error.URLError("down")))
        self.assertEqual(status, 502)
        self.assertEqual(body["error"]["code"], "AI_UNAVAILABLE")

    def test_non_json_model_output_is_reported(self):
        status, body = self.recognize(FakeOpener(model_response("抱歉，我无法识别")))
        self.assertEqual(status, 502)
        self.assertEqual(body["error"]["code"], "AI_BAD_RESPONSE")

    def test_empty_courses_is_reported(self):
        status, body = self.recognize(FakeOpener(model_response('{"courses":[]}')))
        self.assertEqual(status, 422)
        self.assertEqual(body["error"]["code"], "NO_COURSES")

    def test_response_never_contains_api_key(self):
        status, body = self.recognize(FakeOpener(model_response(json.dumps(MODEL_OUTPUT))))
        self.assertEqual(status, 200)
        serialized = json.dumps(body, ensure_ascii=False)
        self.assertNotIn("test-key", serialized)
        self.assertNotIn("Bearer", serialized)


if __name__ == "__main__":
    unittest.main()
