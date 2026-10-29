/** 桦苑充电口由使用者的浏览器直接查询设备接口。 */

import { inspectDevicePorts } from "./logic.js";

export const CHARGING_ENDPOINT = "https://appapi.lvcchong.com/portDetail";
export const DEFAULT_TIMEOUT_MS = 12000;
const MAX_CONCURRENCY = 4;

const SIM_IDS = [
  "866522076351796", "865242053185643", "866569061877939",
  "865242053215002", "867542058714729", "866569061879059",
  "866569062039257", "865242053099711", "865242053188282",
  "866569062057101",
  "867542058886006", "867542058727622", "865242053143469",
  "866569061326002", "866569061781370", "866569061925795",
  "865242053166627", "867542058612907", "866522075090106",
  "865242053201473", "866569061316128", "865242053196590",
  "868065073992616", "865242053104859", "866569061319197",
  "866569061549082", "866569061498363", "867542058727663",
  "868662050970241", "868065073944765",
];

export class ChargingRequestError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ChargingRequestError";
    this.code = code;
  }
}

function createTimeoutSignal(externalSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;

  const forwardAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal) {
    if (externalSignal.aborted) forwardAbort();
    else externalSignal.addEventListener("abort", forwardAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup() {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", forwardAbort);
    },
  };
}

function failedDevice(deviceNo, code, message) {
  return {
    deviceNo,
    ok: false,
    name: null,
    portNumber: null,
    ports: null,
    error: { code, message },
  };
}

async function fetchDevice(simId, deviceNo, externalSignal, timeoutMs) {
  const timeout = createTimeoutSignal(externalSignal, timeoutMs);

  try {
    const body = new URLSearchParams({
      simId,
      mapType: "2",
      chargeTypeTag: "0",
      appEntrance: "1",
      version: "new",
    });
    const response = await fetch(CHARGING_ENDPOINT, {
      method: "POST",
      body,
      signal: timeout.signal,
    });

    if (!response.ok) {
      return failedDevice(deviceNo, "upstream_http", `接口返回 HTTP ${response.status}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (timeout.didTimeOut() || externalSignal?.aborted) throw error;
      return failedDevice(deviceNo, "invalid_response", "接口返回内容无法解析");
    }
    if (payload?.code !== 200) {
      return failedDevice(deviceNo, "upstream_business", "接口未返回有效状态");
    }

    const device = payload.data?.device;
    const { valid, portNumber, ports } = inspectDevicePorts({
      portNumber: device?.portNumber,
      ports: payload.data?.ports,
    });
    if (!device || !Number.isInteger(device.portNumber) || !valid) {
      return failedDevice(deviceNo, "invalid_response", "响应结构与已核对版本不一致");
    }

    return {
      deviceNo,
      ok: true,
      name: typeof device.name === "string" ? device.name : "",
      portNumber,
      ports,
      error: null,
    };
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    if (timeout.didTimeOut()) {
      return failedDevice(deviceNo, "timeout", "设备状态请求超时");
    }
    return failedDevice(deviceNo, "network_error", "设备状态请求失败");
  } finally {
    timeout.cleanup();
  }
}

/**
 * 从当前浏览器按有限并发读取 30 台桦苑设备，保持原有页面所需的数据结构。
 * @param {{signal?: AbortSignal, timeoutMs?: number}} [options]
 */
export async function fetchChargingData({
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");

  const devices = new Array(SIM_IDS.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < SIM_IDS.length) {
      const index = nextIndex++;
      devices[index] = await fetchDevice(SIM_IDS[index], index + 1, signal, timeoutMs);
    }
  };

  await Promise.all(Array.from({ length: MAX_CONCURRENCY }, () => worker()));

  const succeeded = devices.filter((device) => device.ok).length;
  if (succeeded === 0) {
    throw new ChargingRequestError("charging_upstream_unavailable", "设备均未返回有效状态");
  }

  return {
    fetchedAt: new Date().toISOString(),
    devices,
    summary: {
      total: devices.length,
      succeeded,
      failed: devices.length - succeeded,
    },
  };
}
