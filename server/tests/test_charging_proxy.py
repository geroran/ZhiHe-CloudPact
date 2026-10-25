import asyncio
import json
import os
import unittest
import unittest.mock
from urllib.parse import parse_qs

import httpx

from server.routes import charging


def device_payload(
    *,
    port_number: int = 2,
    ports: list[int] | None = None,
    name: str = "云大桦苑1号机",
    code: int = 200,
    message: str = "成功",
) -> dict:
    return {
        "code": code,
        "message": message,
        "data": {
            "device": {"name": name, "portNumber": port_number},
            "ports": [0, 0, 1] if ports is None else ports,
        },
    }


def make_transport(handler):
    return httpx.MockTransport(handler)


class ParsePayloadTests(unittest.TestCase):
    def test_valid_payload_keeps_raw_ports(self):
        result = charging.parse_device_payload(1, device_payload(port_number=3, ports=[0, 0, 1, 2]))
        self.assertTrue(result["ok"])
        self.assertEqual(result["deviceNo"], 1)
        self.assertEqual(result["portNumber"], 3)
        self.assertEqual(result["ports"], [0, 0, 1, 2])
        self.assertEqual(result["name"], "云大桦苑1号机")

    def test_length_mismatch_is_invalid_response(self):
        result = charging.parse_device_payload(1, device_payload(port_number=3, ports=[0, 0, 1]))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "invalid_response")
        self.assertFalse(result["error"]["retryable"])

    def test_first_item_must_be_verified_placeholder(self):
        result = charging.parse_device_payload(1, device_payload(port_number=2, ports=[1, 0, 1]))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "invalid_response")
        self.assertIn("首项", result["error"]["message"])

    def test_non_integer_status_is_invalid(self):
        result = charging.parse_device_payload(1, device_payload(port_number=2, ports=[0, 0, "1"]))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "invalid_response")

    def test_business_code_error(self):
        result = charging.parse_device_payload(1, device_payload(code=500, message="设备维护中"))
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "upstream_business")
        self.assertFalse(result["error"]["retryable"])
        self.assertEqual(result["error"]["message"], "设备维护中")

    def test_missing_data(self):
        result = charging.parse_device_payload(1, {"code": 200, "data": None})
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"]["code"], "invalid_response")

    def test_error_message_is_truncated(self):
        result = charging.parse_device_payload(
            1, device_payload(code=500, message="x" * 500)
        )
        self.assertLessEqual(len(result["error"]["message"]), charging.MAX_ERROR_MESSAGE_LENGTH)


class CollectDevicesTests(unittest.TestCase):
    def test_single_failure_does_not_block_others(self):
        async def handler(request: httpx.Request) -> httpx.Response:
            form = parse_qs(request.content.decode())
            sim_id = form["simId"][0]
            self.assertEqual(form["mapType"], ["2"])
            self.assertEqual(form["chargeTypeTag"], ["0"])
            self.assertEqual(form["appEntrance"], ["1"])
            self.assertEqual(form["version"], ["new"])

            if sim_id == "http-error":
                return httpx.Response(503, text="upstream down")
            if sim_id == "bad-json":
                return httpx.Response(200, text="not json")
            if sim_id == "slow":
                raise httpx.ReadTimeout("timeout", request=request)
            if sim_id == "bad-shape":
                return httpx.Response(
                    200,
                    json=device_payload(port_number=20, ports=[0, 1]),
                )
            return httpx.Response(200, json=device_payload(name="云大桦苑1号机"))

        devices = [
            {"deviceNo": 1, "simId": "ok-1"},
            {"deviceNo": 2, "simId": "http-error"},
            {"deviceNo": 3, "simId": "bad-json"},
            {"deviceNo": 4, "simId": "slow"},
            {"deviceNo": 5, "simId": "bad-shape"},
            {"deviceNo": 6, "simId": "ok-2"},
        ]

        results = asyncio.run(
            charging.collect_devices(
                devices,
                upstream_url="https://example.test/portDetail",
                concurrency=3,
                timeout_seconds=5,
                transport=make_transport(handler),
            )
        )

        self.assertEqual([item["deviceNo"] for item in results], [1, 2, 3, 4, 5, 6])
        self.assertTrue(results[0]["ok"])
        self.assertTrue(results[5]["ok"])
        self.assertEqual(results[1]["error"]["code"], "upstream_http")
        self.assertEqual(results[1]["error"]["message"], "上游返回 HTTP 503")
        self.assertEqual(results[2]["error"]["code"], "invalid_response")
        self.assertEqual(results[3]["error"]["code"], "timeout")
        self.assertEqual(results[4]["error"]["code"], "invalid_response")
        self.assertTrue(results[1]["error"]["retryable"])
        self.assertFalse(results[4]["error"]["retryable"])

    def test_concurrency_is_bounded(self):
        active = 0
        max_active = 0
        lock = asyncio.Lock()

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal active, max_active
            async with lock:
                active += 1
                max_active = max(max_active, active)
            await asyncio.sleep(0.05)
            async with lock:
                active -= 1
            return httpx.Response(200, json=device_payload())

        devices = [{"deviceNo": index, "simId": f"sim-{index}"} for index in range(1, 7)]

        results = asyncio.run(
            charging.collect_devices(
                devices,
                upstream_url="https://example.test/portDetail",
                concurrency=2,
                timeout_seconds=5,
                transport=make_transport(handler),
            )
        )

        self.assertEqual(len(results), 6)
        self.assertTrue(all(item["ok"] for item in results))
        self.assertEqual(max_active, 2, "并发应达到但不超过配置值 2")


class BuildResponseTests(unittest.TestCase):
    def test_partial_failure_is_overall_success(self):
        results = [
            {"deviceNo": 1, "ok": True},
            {"deviceNo": 2, "ok": False, "error": {"code": "timeout"}},
        ]
        response = charging.build_response(results, "2026-10-25T06:00:00Z")
        self.assertTrue(response["ok"])
        self.assertEqual(response["data"]["summary"], {"total": 2, "succeeded": 1, "failed": 1})
        self.assertEqual(response["data"]["fetchedAt"], "2026-10-25T06:00:00Z")

    def test_all_failed_is_overall_failure(self):
        results = [
            {"deviceNo": 1, "ok": False},
            {"deviceNo": 2, "ok": False},
        ]
        response = charging.build_response(results, "2026-10-25T06:00:00Z")
        self.assertFalse(response["ok"])
        self.assertEqual(response["error"]["code"], "charging_upstream_unavailable")
        self.assertTrue(response["error"]["retryable"])
        self.assertIn("data", response)


class ConfigTests(unittest.TestCase):
    def test_defaults_and_bounds(self):
        with unittest.mock.patch.dict(os.environ, {}, clear=True):
            config = charging.get_config()
            self.assertEqual(config["concurrency"], charging.DEFAULT_CONCURRENCY)
            self.assertEqual(config["timeout_seconds"], charging.DEFAULT_TIMEOUT_SECONDS)
            self.assertEqual(config["upstream_url"], charging.DEFAULT_UPSTREAM_URL)

        with unittest.mock.patch.dict(
            os.environ,
            {"CHARGING_CONCURRENCY": "999", "CHARGING_REQUEST_TIMEOUT": "0.1"},
            clear=True,
        ):
            config = charging.get_config()
            self.assertEqual(config["concurrency"], charging.MAX_CONCURRENCY)
            self.assertEqual(config["timeout_seconds"], charging.MIN_TIMEOUT_SECONDS)

        with unittest.mock.patch.dict(
            os.environ,
            {"CHARGING_CONCURRENCY": "not-a-number", "CHARGING_REQUEST_TIMEOUT": "bad"},
            clear=True,
        ):
            config = charging.get_config()
            self.assertEqual(config["concurrency"], charging.DEFAULT_CONCURRENCY)
            self.assertEqual(config["timeout_seconds"], charging.DEFAULT_TIMEOUT_SECONDS)


class RouteTests(unittest.TestCase):
    def test_route_returns_envelope_and_no_store_header(self):
        fake_results = [{"deviceNo": 1, "ok": True, "name": "云大桦苑1号机"}]

        async def fake_collect(*args, **kwargs):
            return fake_results

        with unittest.mock.patch.object(charging, "collect_devices", fake_collect):
            response = asyncio.run(charging.get_charging_ports())

        payload = json.loads(response.body)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["data"]["devices"], fake_results)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["pragma"], "no-cache")

    def test_route_hides_upstream_failure_as_envelope(self):
        async def fake_collect(*args, **kwargs):
            raise RuntimeError("boom")

        with unittest.mock.patch.object(charging, "collect_devices", fake_collect):
            response = asyncio.run(charging.get_charging_ports())

        payload = json.loads(response.body)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"]["code"], "charging_proxy_error")
        self.assertEqual(response.headers["cache-control"], "no-store")


if __name__ == "__main__":
    unittest.main()
