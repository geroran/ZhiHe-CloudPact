"""学期课程列表 FastAPI 路由测试。

不访问真实上游：通过 patch 注入上游状态与载荷，验证：
- 学期代码校验、未配置 token、鉴权失败、超时与上游异常的映射；
- 响应只包含课程字段白名单，且响应头禁止缓存。
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server.routes import term_courses as term_courses_route  # noqa: E402
from server.term_courses_core import (  # noqa: E402
    UpstreamTimeout,
    UpstreamUnavailable,
)

COURSE = {
    "uid": "20211170240",
    "courseName": "大学英语听说（4）",
    "modifyTime": 1780626042000,
    "createTime": 1769404663000,
    "id": "20211170240::YN3004170007::2022-2023-1",
    "courseDetailInfo": "1-18周 星期二 7-8节 格物楼2栋2408",
    "courseTeacher": "邓杉",
    "courseId": "YN3004170007",
    "termCode": "2022-2023-1",
}


class TermCoursesRouteTest(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(term_courses_route.router)
        self.client = TestClient(app)
        self.token_patch = patch.object(term_courses_route, "load_token", return_value="fake-token")
        self.token_patch.start()
        self.addCleanup(self.token_patch.stop)

    def get(self, term_code="2022-2023-1"):
        return self.client.get("/api/term-courses", params={"termCode": term_code})

    def test_invalid_term_code_is_rejected_before_upstream(self):
        with patch.object(term_courses_route, "fetch_upstream") as upstream:
            for term_code in ("", "   ", "../etc", "a" * 33):
                response = self.get(term_code)
                self.assertEqual(response.status_code, 400, term_code)
                self.assertEqual(response.json()["error"]["code"], "INVALID_TERM_CODE")
            upstream.assert_not_called()

    def test_missing_token_is_reported_as_not_configured(self):
        with patch.object(term_courses_route, "load_token", return_value=""):
            response = self.get()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["error"]["code"], "NOT_CONFIGURED")
        self.assertIn("WECAMPUS_TOKEN", response.json()["error"]["message"])

    def test_success_returns_only_whitelisted_course_fields(self):
        payload = {"result": "success", "data": [COURSE]}
        with patch.object(term_courses_route, "fetch_upstream", return_value=(200, payload)):
            response = self.get()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")
        body = response.json()
        self.assertTrue(body["ok"])
        self.assertEqual(len(body["data"]), 1)
        course = body["data"][0]
        self.assertEqual(course["courseName"], COURSE["courseName"])
        self.assertEqual(course["courseTeacher"], "邓杉")
        self.assertNotIn("uid", course)
        self.assertNotIn("modifyTime", course)
        self.assertNotIn("createTime", course)
        self.assertNotIn("fake-token", json.dumps(body, ensure_ascii=False))

    def test_invalid_token_business_result_maps_to_auth_failure(self):
        with patch.object(
            term_courses_route,
            "fetch_upstream",
            return_value=(200, {"result": "invalid_token", "message": "无效的token"}),
        ):
            response = self.get()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "AUTH_FAILED")
        self.assertNotIn("无效的token", response.text)

    def test_upstream_401_maps_to_auth_failure(self):
        with patch.object(term_courses_route, "fetch_upstream", return_value=(401, None)):
            response = self.get()
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "AUTH_FAILED")

    def test_upstream_error_maps_to_retryable_502(self):
        with patch.object(term_courses_route, "fetch_upstream", return_value=(500, None)):
            response = self.get()
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["error"]["code"], "UPSTREAM_ERROR")
        self.assertTrue(response.json()["error"]["retryable"])

    def test_timeout_maps_to_504(self):
        with patch.object(
            term_courses_route, "fetch_upstream", side_effect=UpstreamTimeout
        ):
            response = self.get()
        self.assertEqual(response.status_code, 504)
        self.assertEqual(response.json()["error"]["code"], "UPSTREAM_TIMEOUT")

    def test_unreachable_upstream_maps_to_502(self):
        with patch.object(
            term_courses_route, "fetch_upstream", side_effect=UpstreamUnavailable
        ):
            response = self.get()
        self.assertEqual(response.status_code, 502)
        self.assertTrue(response.json()["error"]["retryable"])

    def test_bad_payload_maps_to_502(self):
        for payload in (None, [], {"result": "fail"}, {"result": "success", "data": "x"}):
            with patch.object(
                term_courses_route, "fetch_upstream", return_value=(200, payload)
            ):
                response = self.get()
            self.assertEqual(response.status_code, 502, payload)
            self.assertEqual(response.json()["error"]["code"], "UPSTREAM_BAD_RESPONSE")


if __name__ == "__main__":
    unittest.main()
