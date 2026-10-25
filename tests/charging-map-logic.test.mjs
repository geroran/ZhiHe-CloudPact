import test from "node:test";
import assert from "node:assert/strict";

import {
  LAYOUT,
  LAYOUT_COLUMN_COUNT,
  LAYOUT_PORT_COUNT,
  LAYOUT_ROW_COUNT,
  PORT_CELLS,
  parseLayout,
} from "../src/modules/charging-map/layout.js";
import {
  STATUS,
  buildStatusIndex,
  computeStats,
  inspectDevicePorts,
  listFreePorts,
  mapPortValue,
} from "../src/modules/charging-map/logic.js";

function cellAt(row, column) {
  return LAYOUT[row - 1][column - 1];
}

test("布局严格保持 51 行 × 15 列", () => {
  assert.equal(LAYOUT_ROW_COUNT, 51);
  assert.equal(LAYOUT_COLUMN_COUNT, 15);
  for (const [index, row] of LAYOUT.entries()) {
    assert.equal(row.length, 15, `第 ${index + 1} 行格数错误`);
  }
});

test("布局包含 500 个唯一端口 ID，设备号 1–30、端口号 1–20", () => {
  assert.equal(LAYOUT_PORT_COUNT, 500);
  assert.equal(new Set(PORT_CELLS.map((cell) => cell.id)).size, 500);

  const deviceNumbers = [...new Set(PORT_CELLS.map((cell) => cell.deviceNo))].sort((a, b) => a - b);
  assert.deepEqual(deviceNumbers, Array.from({ length: 30 }, (_, index) => index + 1));

  const portNumbers = [...new Set(PORT_CELLS.map((cell) => cell.portNo))].sort((a, b) => a - b);
  assert.deepEqual(portNumbers, Array.from({ length: 20 }, (_, index) => index + 1));
});

test("关键坐标与规格一致", () => {
  assert.equal(cellAt(1, 1).id, "26-16");
  assert.equal(cellAt(1, 15).id, "2-5");
  assert.equal(cellAt(6, 1).id, "27-1");
  assert.equal(cellAt(25, 1).id, "27-20");
  assert.equal(cellAt(25, 15).id, "1-1");
  assert.equal(cellAt(51, 1).id, "29-15");
  assert.equal(cellAt(51, 15).id, "6-6");
});

test("过道文字与入口格保持原样", () => {
  assert.equal(cellAt(25, 2).type, "path");
  assert.equal(cellAt(25, 2).label, "五");
  assert.equal(cellAt(25, 5).label, "四");
  assert.equal(cellAt(25, 8).label, "三");
  assert.equal(cellAt(25, 11).label, "二");
  assert.equal(cellAt(25, 14).label, "一");

  assert.equal(cellAt(26, 15).label, "入口");
  assert.equal(cellAt(26, 15).accent, true);
  for (let column = 1; column <= 14; column += 1) {
    assert.equal(cellAt(26, column).type, "path");
    assert.equal(cellAt(26, column).label, "");
  }
});

test("10 端口设备的 11–20 号端口不在布局中（不补造）", () => {
  const tenPortDevices = [3, 6, 7, 10, 14, 16, 21, 23, 25, 30];
  const ids = new Set(PORT_CELLS.map((cell) => cell.id));
  for (const deviceNo of tenPortDevices) {
    for (let portNo = 11; portNo <= 20; portNo += 1) {
      assert.equal(ids.has(`${deviceNo}-${portNo}`), false);
    }
    for (let portNo = 1; portNo <= 10; portNo += 1) {
      assert.equal(ids.has(`${deviceNo}-${portNo}`), true);
    }
  }
});

test("parseLayout 拒绝行格数错误和重复 ID", () => {
  assert.throws(() => parseLayout("1-1 - 2-1"), /15 格/);
  assert.throws(
    () => parseLayout(`${Array(15).fill("1-1").join(" ")}`),
    /端口 ID 重复/,
  );
});

test("状态值映射：0 空闲、1 占用、其他故障/未识别", () => {
  assert.equal(mapPortValue(0), STATUS.FREE);
  assert.equal(mapPortValue(1), STATUS.BUSY);
  assert.equal(mapPortValue(2), STATUS.UNAVAILABLE);
  assert.equal(mapPortValue(-1), STATUS.UNAVAILABLE);
});

test("已核对结构：首项占位被忽略，长度必须为 portNumber+1", () => {
  const valid = inspectDevicePorts({
    portNumber: 3,
    ports: [0, 0, 1, 2],
  });
  assert.equal(valid.valid, true);

  assert.equal(inspectDevicePorts({ portNumber: 3, ports: [0, 0, 1] }).valid, false);
  assert.equal(inspectDevicePorts({ portNumber: 3, ports: [1, 0, 1, 0] }).valid, false);
  assert.equal(inspectDevicePorts({ portNumber: 3, ports: [0, 0, "1", 0] }).valid, false);
  assert.equal(inspectDevicePorts({ portNumber: 0, ports: [0] }).valid, false);
});

test("buildStatusIndex 忽略 ports[0] 并按端口 1 开始映射", () => {
  const result = buildStatusIndex([
    {
      deviceNo: 1,
      ok: true,
      portNumber: 2,
      ports: [0, 0, 1],
    },
  ]);

  assert.equal(result.successfulDevices, 1);
  assert.equal(result.structureVerified, true);
  assert.deepEqual(result.statusById.get("1-1"), {
    status: STATUS.FREE,
    value: 0,
    deviceNo: 1,
    portNo: 1,
  });
  assert.deepEqual(result.statusById.get("1-2"), {
    status: STATUS.BUSY,
    value: 1,
    deviceNo: 1,
    portNo: 2,
  });
  assert.equal(result.statusById.has("1-0"), false);
});

test("单台设备失败不阻塞其他设备，失败设备端口保持未知", () => {
  const result = buildStatusIndex([
    { deviceNo: 1, ok: true, portNumber: 2, ports: [0, 0, 1] },
    {
      deviceNo: 2,
      ok: false,
      error: { code: "network_error", message: "无法连接上游接口" },
    },
  ]);

  assert.equal(result.successfulDevices, 1);
  assert.equal(result.structureVerified, true);
  assert.equal(result.statusById.has("2-1"), false);
  assert.equal(result.deviceErrors.get(2), "无法连接上游接口");
});

test("结构异常会隐藏结构化统计标记，但保留其他设备状态", () => {
  const result = buildStatusIndex([
    { deviceNo: 1, ok: true, portNumber: 2, ports: [0, 0, 1] },
    {
      deviceNo: 2,
      ok: false,
      error: { code: "invalid_response", message: "data.ports 长度与 portNumber 不匹配" },
    },
  ]);

  assert.equal(result.successfulDevices, 1);
  assert.equal(result.structureVerified, false);
  assert.equal(result.statusById.get("1-1").status, STATUS.FREE);
});

test("统计只覆盖布局端口，未知不计为空闲", () => {
  const cells = [
    { type: "port", id: "1-1" },
    { type: "port", id: "1-2" },
    { type: "port", id: "2-1" },
    { type: "path", id: "" },
  ];
  const statusById = new Map([
    ["1-1", { status: STATUS.FREE, deviceNo: 1, portNo: 1 }],
    ["1-2", { status: STATUS.BUSY, deviceNo: 1, portNo: 2 }],
  ]);

  const stats = computeStats(cells, statusById);
  assert.deepEqual(stats, {
    total: 3,
    free: 1,
    busy: 1,
    unavailable: 0,
    unknown: 1,
    known: 2,
  });
  assert.equal(stats.free, 1, "未知端口不能计入空闲");
});

test("其他状态值计入故障/未识别，不计入空闲", () => {
  const cells = [{ type: "port", id: "1-1" }];
  const statusById = new Map([
    ["1-1", { status: STATUS.UNAVAILABLE, value: 5, deviceNo: 1, portNo: 1 }],
  ]);
  const stats = computeStats(cells, statusById);
  assert.equal(stats.free, 0);
  assert.equal(stats.unavailable, 1);
  assert.equal(stats.unknown, 0);
});

test("空闲列表按设备号和端口号排序，且不含未知状态", () => {
  const statusById = new Map([
    ["2-3", { status: STATUS.FREE, deviceNo: 2, portNo: 3 }],
    ["1-5", { status: STATUS.FREE, deviceNo: 1, portNo: 5 }],
    ["1-2", { status: STATUS.FREE, deviceNo: 1, portNo: 2 }],
    ["1-1", { status: STATUS.BUSY, deviceNo: 1, portNo: 1 }],
    ["3-1", { status: STATUS.UNAVAILABLE, deviceNo: 3, portNo: 1 }],
  ]);

  assert.deepEqual(listFreePorts(statusById), [
    { deviceNo: 1, portNo: 2 },
    { deviceNo: 1, portNo: 5 },
    { deviceNo: 2, portNo: 3 },
  ]);
});
