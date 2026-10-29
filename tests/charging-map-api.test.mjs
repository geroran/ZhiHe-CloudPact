import test from "node:test";
import assert from "node:assert/strict";

import {
  CHARGING_ENDPOINT,
  fetchChargingData,
} from "../src/modules/charging-map/api.js";

test("桦苑设备由浏览器直连查询，编号、表单和并发均正确", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let active = 0;
  let peak = 0;

  globalThis.fetch = async (url, options) => {
    active += 1;
    peak = Math.max(peak, active);
    requests.push({ url, ...options });
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return {
      ok: true,
      async json() {
        return {
          code: 200,
          data: {
            device: { name: "桦苑设备", portNumber: 2 },
            ports: [0, 0, 1],
          },
        };
      },
    };
  };

  try {
    const data = await fetchChargingData();
    assert.equal(requests.length, 30);
    assert.ok(peak <= 4);
    assert.ok(requests.every(({ url, method, body }) =>
      url === CHARGING_ENDPOINT && method === "POST" && body instanceof URLSearchParams
    ));
    assert.equal(requests[0].body.get("simId"), "866522076351796");
    assert.equal(requests[18].body.get("simId"), "866522075090106");
    assert.equal(requests[29].body.get("simId"), "868065073944765");
    assert.deepEqual(Object.fromEntries(requests[0].body), {
      simId: "866522076351796",
      mapType: "2",
      chargeTypeTag: "0",
      appEntrance: "1",
      version: "new",
    });
    assert.equal(data.summary.succeeded, 30);
    assert.equal(data.devices[18].deviceNo, 19);
    assert.deepEqual(data.devices[18].ports, [0, 0, 1]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("全部设备失败时不把未知状态当作查询成功", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403 });

  try {
    await assert.rejects(fetchChargingData(), {
      name: "ChargingRequestError",
      code: "charging_upstream_unavailable",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
