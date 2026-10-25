/**
 * 充电口数据请求适配层。
 *
 * 始终请求同源后端代理 `/api/charging/ports`，绝不使用 `no-cors`。
 * 注意：宿主 shell 注入的 `context.api.request` 是校园 AI 智能体专用客户端
 * （固定 POST 到 `/api/agent/*`），不能复用于本模块，因此这里只走标准 fetch。
 *
 * `apiBase` 仅用于模块独立预览时指向本地服务端口。
 */

export const CHARGING_ENDPOINT = "/api/charging/ports";
export const DEFAULT_TIMEOUT_MS = 20000;

export class ChargingRequestError extends Error {
  constructor(code, message, { retryable = true, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ChargingRequestError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function joinUrl(base, path) {
  if (!base) return path;
  return `${String(base).replace(/\/+$/, "")}${path}`;
}

function normalizeEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") {
    throw new ChargingRequestError("invalid_response", "代理返回了无法解析的数据");
  }

  if (envelope.ok !== true) {
    const error = envelope.error || {};
    throw new ChargingRequestError(
      error.code || "charging_request_failed",
      error.message || "充电口状态请求失败",
      { retryable: error.retryable !== false },
    );
  }

  const data = envelope.data;
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.fetchedAt !== "string" ||
    !Array.isArray(data.devices)
  ) {
    throw new ChargingRequestError("invalid_response", "代理响应缺少设备列表或刷新时间");
  }

  return data;
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

/**
 * 获取一次完整的桦苑设备状态。
 * @param {{apiBase?: string, signal?: AbortSignal, timeoutMs?: number}} [options]
 * @returns {Promise<{fetchedAt: string, devices: Array<object>, summary: object}>}
 */
export async function fetchChargingData({
  apiBase = "",
  signal: externalSignal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const timeout = createTimeoutSignal(externalSignal, timeoutMs);

  try {
    let response;
    try {
      response = await fetch(joinUrl(apiBase, CHARGING_ENDPOINT), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: timeout.signal,
        cache: "no-store",
      });
    } catch (error) {
      if (timeout.didTimeOut()) {
        throw new ChargingRequestError("timeout", "请求超时，未能获取充电口状态", { cause: error });
      }
      if (isAbortError(error) && externalSignal?.aborted) throw error;
      throw new ChargingRequestError("network_error", "无法连接充电口状态代理服务", { cause: error });
    }

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new ChargingRequestError(
        "invalid_response",
        response.ok ? "代理返回了非 JSON 响应" : `代理请求失败（HTTP ${response.status}）`,
        { retryable: response.ok, cause: error },
      );
    }

    return normalizeEnvelope(payload);
  } finally {
    timeout.cleanup();
  }
}
