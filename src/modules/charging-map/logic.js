/**
 * 桦苑充电口状态映射与统计（纯函数，便于单元测试）。
 *
 * 真实响应核对记录（2026-10-25，30 台设备全部 HTTP 200 / code 200）：
 * - data.device.name 依次为“云大桦苑1号机”…“云大桦苑30号机”，与 simId 顺序一致；
 * - data.device.portNumber 为 10 或 20；
 * - data.ports 长度恒为 portNumber + 1；
 * - data.ports[0] 恒为 0，是需忽略的占位项；
 * - 剩余 10/20 项只出现 0 和 1；
 * - data.device.freePortCount 恰好等于排除占位项后 0 的数量，
 *   因此确认 0 = 空闲、1 = 占用。
 *
 * 其他状态值本轮未出现，按规格映射为“故障/未识别”，不计为空闲。
 * 若运行时响应不再符合上述结构（长度不符、首项非 0、状态非整数），
 * 则将所有相关端口保持未知，并隐藏空闲/占用/故障统计，避免把推断写成事实。
 */

export const STATUS = Object.freeze({
  FREE: "free",
  BUSY: "busy",
  UNAVAILABLE: "unavailable",
  UNKNOWN: "none",
});

export const STATUS_LABELS = Object.freeze({
  free: "空闲",
  busy: "占用",
  unavailable: "故障/未识别",
  none: "未知",
});

export const MAPPING_VERIFICATION = Object.freeze({
  verifiedAt: "2026-10-25T06:02:24Z",
  devicesChecked: 30,
  structure: "ports.length === device.portNumber + 1；ports[0] 为占位值 0",
  observedValues: "0=空闲，1=占用；freePortCount 与排除首项后的 0 数量一致",
  unobservedValues: "本轮未出现其他状态值；其他值按故障/未识别显示",
});

const FIRST_PORT_INDEX = 1;

/** 单条真实状态值到页面状态类的映射。 */
export function mapPortValue(value) {
  if (value === 0) return STATUS.FREE;
  if (value === 1) return STATUS.BUSY;
  return STATUS.UNAVAILABLE;
}

/**
 * 校验一台设备的端口数组是否符合已核对的真实响应结构。
 * @param {unknown} device
 * @returns {{valid: boolean, portNumber: number, ports: number[]}}
 */
export function inspectDevicePorts(device) {
  const portNumber = Number(device?.portNumber);
  const ports = device?.ports;

  const valid =
    Number.isInteger(portNumber) &&
    portNumber > 0 &&
    Array.isArray(ports) &&
    ports.length === portNumber + 1 &&
    ports[0] === 0 &&
    ports.every((value) => Number.isInteger(value));

  return {
    valid,
    portNumber: valid ? portNumber : 0,
    ports: valid ? ports : [],
  };
}

/**
 * 将服务端返回的设备数组转换为 `设备号-端口号 -> 状态` 的索引。
 *
 * - 单台设备 ok=false 或结构异常：该设备所有端口保持未知；
 * - 结构异常不会阻止其他设备的状态渲染，但会令 structureVerified=false，
 *   页面据此隐藏已核对的结构化统计。
 *
 * @param {Array<{deviceNo: number, ok: boolean, portNumber?: number, ports?: number[], error?: {message?: string}}>} devices
 * @returns {{
 *   statusById: Map<string, {status: string, value: number, deviceNo: number, portNo: number}>,
 *   deviceErrors: Map<number, string>,
 *   successfulDevices: number,
 *   structureVerified: boolean
 * }}
 */
export function buildStatusIndex(devices) {
  const statusById = new Map();
  const deviceErrors = new Map();
  let successfulDevices = 0;
  let structureVerified = true;

  for (const device of Array.isArray(devices) ? devices : []) {
    const deviceNo = Number(device?.deviceNo);
    if (!Number.isInteger(deviceNo) || deviceNo <= 0) {
      structureVerified = false;
      continue;
    }

    if (device.ok !== true) {
      // 服务端标记 invalid_response 说明真实响应结构已偏离核对版本，
      // 此时隐藏空闲/占用/故障统计，避免把推断写成事实。
      if (device.error?.code === "invalid_response") {
        structureVerified = false;
      }
      deviceErrors.set(deviceNo, device.error?.message || "设备查询失败");
      continue;
    }

    const { valid, portNumber, ports } = inspectDevicePorts(device);
    if (!valid) {
      structureVerified = false;
      deviceErrors.set(deviceNo, "响应结构与已核对版本不一致");
      continue;
    }

    successfulDevices += 1;
    for (let index = FIRST_PORT_INDEX; index < ports.length; index += 1) {
      const portNo = index;
      const value = ports[index];
      statusById.set(`${deviceNo}-${portNo}`, {
        status: mapPortValue(value),
        value,
        deviceNo,
        portNo,
      });
    }
  }

  return {
    statusById,
    deviceErrors,
    successfulDevices,
    structureVerified: structureVerified && successfulDevices > 0,
  };
}

/**
 * 只针对布局中真实存在的 500 个端口统计。
 * 未知端口单列，且不会计入空闲。
 *
 * @param {Array<{id: string, type: string}>} portCells
 * @param {Map<string, {status: string}>} statusById
 */
export function computeStats(portCells, statusById) {
  const stats = {
    total: 0,
    free: 0,
    busy: 0,
    unavailable: 0,
    unknown: 0,
    known: 0,
  };

  for (const cell of portCells) {
    if (cell.type !== "port") continue;
    stats.total += 1;

    const entry = statusById.get(cell.id);
    if (!entry) {
      stats.unknown += 1;
      continue;
    }

    if (entry.status === STATUS.FREE) stats.free += 1;
    else if (entry.status === STATUS.BUSY) stats.busy += 1;
    else if (entry.status === STATUS.UNAVAILABLE) stats.unavailable += 1;
    else stats.unknown += 1;
  }

  stats.known = stats.free + stats.busy + stats.unavailable;
  return stats;
}

/**
 * 空闲端口明细，按设备号、端口号排序，未知状态不会进入列表。
 * @param {Map<string, {status: string, deviceNo: number, portNo: number}>} statusById
 */
export function listFreePorts(statusById) {
  return [...statusById.values()]
    .filter((entry) => entry.status === STATUS.FREE)
    .sort((a, b) => a.deviceNo - b.deviceNo || a.portNo - b.portNo)
    .map((entry) => ({ deviceNo: entry.deviceNo, portNo: entry.portNo }));
}
