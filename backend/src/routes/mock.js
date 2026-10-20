/**
 * 模拟辅助接口（契约第 7 节，/api/mock，演示面板专用）
 *
 *   POST /api/mock/track             狮桥位置回传模拟：写 transport_track，
 *                                     PICKED 首次回传 → IN_TRANSIT；OUTBOUND（已出库未提车）仅记轨迹；
 *                                     transport_no = SQ+yyyyMMdd+任务id补零4位
 *   POST /api/mock/esign/sign-task   签署该任务最新一条待签署电子签（演示辅助）
 *
 * 其余外部系统交互（CRM 下发/取消、狮桥接单/提车/到达/完结、WMS 出库、司机/电子签同步）
 * 均由 /api/external/* 接口承接（契约第 6 节），模拟器页面直接调用。
 */
const { Router } = require('express');
const { query, withTransaction } = require('../db');
const {
  wrap, ok, errParam, errBiz, errState, errNotFound, cutStr, localDateStr,
} = require('../helpers');

const router = Router();

/** 统一定位任务：applyNo 优先，taskNo 兼容，都无 → A0001（契约第 6 节统一定位） */
async function findTask({ applyNo, taskNo }) {
  const apply = String(applyNo ?? '').trim();
  const no = String(taskNo ?? '').trim();
  if (!apply && !no) {
    throw errParam('请提供发运申请号 applyNo（推荐）或任务单号 taskNo');
  }
  const rows = await query(
    `SELECT * FROM shipping_task WHERE ${apply ? 'apply_no = ?' : 'task_no = ?'} AND deleted = 0`,
    [apply || no]
  );
  if (!rows.length) {
    throw errNotFound(apply ? `发运申请号 ${apply} 对应的任务不存在` : `任务单号 ${no} 对应的任务不存在`);
  }
  return rows[0];
}

/* ============ 位置回传（写 transport_track；PICKED/OUTBOUND 首次 → IN_TRANSIT） ============ */
// POST /api/mock/track {applyNo?, taskNo?, locationDesc, longitude, latitude, speed}
router.post('/track', wrap(async (req, res) => {
  const b = req.body || {};
  const longitude = Number(b.longitude);
  const latitude = Number(b.latitude);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw errParam('经度 longitude 与纬度 latitude 必填且须为数字');
  }
  const speed = (b.speed === undefined || b.speed === null || b.speed === '') ? null : Number(b.speed);
  if (speed !== null && !Number.isFinite(speed)) {
    throw errParam('时速 speed 须为数字');
  }
  const locationDesc = cutStr(String(b.locationDesc ?? '').trim(), 255) || '位置更新';
  const apply = String(b.applyNo ?? '').trim();
  const no = String(b.taskNo ?? '').trim();
  if (!apply && !no) throw errParam('请提供发运申请号 applyNo（推荐）或任务单号 taskNo');

  const result = await withTransaction(async (conn) => {
    // 行锁读取任务，避免与状态回传并发竞争
    const [rows] = await conn.query(
      `SELECT * FROM shipping_task WHERE ${apply ? 'apply_no = ?' : 'task_no = ?'} AND deleted = 0 FOR UPDATE`,
      [apply || no]
    );
    if (!rows.length) {
      throw errNotFound(apply ? `发运申请号 ${apply} 对应的任务不存在` : `任务单号 ${no} 对应的任务不存在`);
    }
    const task = rows[0];

    // 仅已提车/已出库/在途的任务可回传位置
    if (['ARRIVED', 'FINISHED', 'CANCELLED'].includes(task.status)) {
      throw errState(`当前任务状态不允许回传位置（${task.status}），车辆已到达或已终止`);
    }
    if (['WAIT_DISPATCH', 'DISPATCHED', 'CARRIER_ACCEPTED'].includes(task.status)) {
      throw errState(`当前任务状态不允许回传位置（${task.status}），车辆尚未提车`);
    }

    // 狮桥运输单号：SQ+yyyyMMdd+任务id补零4位
    const transportNo = `SQ${localDateStr().replace(/-/g, '')}${String(task.id).padStart(4, '0')}`;
    await conn.query(
      `INSERT INTO transport_track
        (task_id, task_no, transport_no, longitude, latitude, location_desc, speed, report_time, create_name, update_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), '狮桥物流', '狮桥物流')`,
      [task.id, task.task_no, transportNo, longitude, latitude, locationDesc, speed]
    );

    // 首次位置回传 → IN_TRANSIT（契约 3.1：位置触发在途）
    // 仅已提车（司机已确认提车/发运）可进入在途；OUTBOUND（已出库未提车）仅记轨迹
    if (task.status === 'PICKED') {
      await conn.query(
        `UPDATE shipping_task SET status = 'IN_TRANSIT', version = version + 1, update_name = '狮桥物流' WHERE id = ? AND version = ?`,
        [task.id, task.version]
      );
      await conn.query(
        `INSERT INTO task_status_log (task_id, task_no, from_status, to_status, source, operator, remark, create_name, update_name)
         VALUES (?, ?, ?, 'IN_TRANSIT', 'SQ', '狮桥物流', ?, '狮桥物流', '狮桥物流')`,
        [task.id, task.task_no, task.status, cutStr(`首次位置回传：${locationDesc}${speed !== null ? `，时速 ${speed}km/h` : ''}`, 255)]
      );
      return { transportNo, status: 'IN_TRANSIT', firstReport: true };
    }
    if (task.status === 'OUTBOUND') {
      return { transportNo, status: 'OUTBOUND', firstReport: false, pendingPickup: true };
    }

    // 在途任务继续记录轨迹（不重复写状态日志）
    return { transportNo, status: 'IN_TRANSIT', firstReport: false };
  });

  ok(res, result, result.pendingPickup
    ? '位置已记录；司机尚未确认提车（WMS 已先行出库），确认提车后再进入在途'
    : result.firstReport ? '位置回传成功，任务已置为在途' : '位置回传成功');
}));

/* ============ 签署任务最新待签署电子签（演示辅助） ============ */
// POST /api/mock/esign/sign-task {applyNo?, taskNo?}
router.post('/esign/sign-task', wrap(async (req, res) => {
  const b = req.body || {};
  const task = await findTask({ applyNo: b.applyNo, taskNo: b.taskNo });

  const result = await withTransaction(async (conn) => {
    // 该任务最新一条待签署电子签
    const [rows] = await conn.query(
      "SELECT * FROM esign_record WHERE task_id = ? AND sign_status = 'WAIT_SIGN' AND deleted = 0 ORDER BY id DESC LIMIT 1 FOR UPDATE",
      [task.id]
    );
    if (!rows.length) throw errBiz('该任务无待签署的电子签，无需签署');
    const rec = rows[0];
    await conn.query(
      "UPDATE esign_record SET sign_status = 'SIGNED', sign_time = NOW(), update_name = '狮桥物流' WHERE id = ?",
      [rec.id]
    );
    return { esignId: rec.esign_id, vin: rec.vin, signStatus: 'SIGNED' };
  });

  ok(res, result, `电子签 ${result.esignId} 签署完成`);
}));

module.exports = router;
