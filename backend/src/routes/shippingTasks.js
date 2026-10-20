/**
 * 运输调度 - 发运任务（契约 5.4）
 * 状态机（司机先办提车、仓库后出库，出库完成即进在途）：
 *   WAIT_DISPATCH → DISPATCHED → CARRIER_ACCEPTED → PICKED → OUTBOUND → IN_TRANSIT → ARRIVED → FINISHED
 *   WAIT_DISPATCH → CANCELLED（CRM 取消）；DISPATCHED → WAIT_DISPATCH（取消派单）；DISPATCHED → DISPATCHED（改派）
 * 版本控制：派单/取消派单/改派必须携带 version，不匹配返回 D0001「任务状态已变化，请刷新后重试」
 */
const { Router } = require('express');
const { query, withTransaction, nextSeq } = require('../db');
const {
  wrap, ok, errParam, errBiz, errDup, errState, errNotFound,
  pageOf, pageData, cutStr,
} = require('../helpers');

const router = Router();

const CANCEL_REASONS = ['承运商无法履约', '调度调整', '其他']; // 取消派单原因枚举（契约 5.1）

/** 按状态计算前端可用操作（契约 3.1 版本控制节） */
function allowedActions(status) {
  if (status === 'WAIT_DISPATCH') return ['DISPATCH', 'BATCH_DISPATCH'];
  if (status === 'DISPATCHED') return ['CANCEL_DISPATCH', 'REASSIGN'];
  return [];
}

/** 写任务状态流转日志（from_status 初始为 NULL；source: STP/CRM/SQ/WMS） */
async function writeStatusLog(conn, { taskId, taskNo, fromStatus, toStatus, source, operator, remark }) {
  await conn.query(
    `INSERT INTO task_status_log (task_id, task_no, from_status, to_status, source, operator, remark, create_name, update_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [taskId, taskNo, fromStatus, toStatus, source, operator, cutStr(remark, 255), operator, operator]
  );
}

/** 写派单/改派/取消派单记录 */
async function writeDispatchRecord(conn, { taskId, taskNo, action, carrierId, batchNo, dispatchPerson, cancelReason, remark }) {
  await conn.query(
    `INSERT INTO dispatch_record (task_id, task_no, action, carrier_id, batch_no, dispatch_person, dispatch_time, cancel_reason, remark, create_name, update_name)
     VALUES (?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?)`,
    [taskId, taskNo, action, carrierId ?? null, batchNo ?? null, dispatchPerson, cancelReason ?? null, cutStr(remark, 500), dispatchPerson, dispatchPerson]
  );
}

/** 事务内锁定任务行（悲观锁 + 乐观锁双保险），返回最新任务数据 */
async function lockTask(conn, taskId) {
  const [rows] = await conn.query('SELECT * FROM shipping_task WHERE id = ? AND deleted = 0 FOR UPDATE', [Number(taskId)]);
  if (!rows.length) throw errNotFound('任务不存在');
  return rows[0];
}

/** 乐观锁版本校验：不携带或与当前版本不一致 -> D0001 任务状态已变化，请刷新后重试 */
function assertVersion(task, version) {
  if (version === undefined || version === null || version === '') throw errParam('请携带任务版本号 version');
  const v = Number(version);
  if (!Number.isInteger(v) || v < 0) throw errParam('版本号 version 格式不正确');
  if (Number(task.version) !== v) throw errState('任务状态已变化，请刷新后重试');
}

/** 校验承运商存在且合作中（停用拦截新派单，契约 9.9） */
async function assertCarrierDispatchable(conn, carrierId) {
  const [rows] = await conn.query('SELECT * FROM carrier WHERE id = ? AND deleted = 0', [Number(carrierId)]);
  if (!rows.length) throw errNotFound('承运商不存在');
  if (Number(rows[0].status) !== 1) throw errBiz('该承运商已停用，不可被派单');
  return rows[0];
}

// ============ 列表：多条件筛选（契约 5.4） ============
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { task_no = '', apply_no = '', vin = '', customer_name = '', status = '', carrier_id = '', start_date = '', end_date = '' } = req.query;
  const where = ['t.deleted = 0'];
  const params = [];
  if (task_no) where.push('t.task_no LIKE ?'), params.push(`%${task_no}%`);
  if (apply_no) where.push('t.apply_no LIKE ?'), params.push(`%${apply_no}%`);
  if (vin) {
    where.push('EXISTS (SELECT 1 FROM shipping_task_vehicle v WHERE v.task_id = t.id AND v.deleted = 0 AND v.vin LIKE ?)');
    params.push(`%${vin}%`);
  }
  if (customer_name) where.push('t.customer_name LIKE ?'), params.push(`%${customer_name}%`);
  if (status) where.push('t.status = ?'), params.push(status);
  if (carrier_id) where.push('t.carrier_id = ?'), params.push(Number(carrier_id));
  if (start_date) where.push('t.create_time >= ?'), params.push(`${start_date} 00:00:00`);
  if (end_date) where.push('t.create_time <= ?'), params.push(`${end_date} 23:59:59`);
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRows = await query(`SELECT COUNT(*) AS n FROM shipping_task t ${whereSql}`, params);
  const list = await query(
    `SELECT t.id, t.task_no, t.apply_no, t.customer_name,
            (SELECT GROUP_CONCAT(v.vin ORDER BY v.id SEPARATOR '、') FROM shipping_task_vehicle v WHERE v.task_id = t.id AND v.deleted = 0) AS vins,
            (SELECT GROUP_CONCAT(v.vehicle_model ORDER BY v.id SEPARATOR '、') FROM shipping_task_vehicle v WHERE v.task_id = t.id AND v.deleted = 0) AS vehicle_models,
            t.ship_location, t.delivery_address, t.plan_freight, c.carrier_name, d.driver_name,
            t.plan_pickup_date, t.outbound_date, t.ship_time, t.arrive_time,
            t.status, t.create_time, t.version
     FROM shipping_task t
     LEFT JOIN carrier c ON c.id = t.carrier_id
     LEFT JOIN driver d ON d.id = t.driver_id
     ${whereSql}
     ORDER BY t.create_time DESC, t.id DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(list, Number(totalRows[0].n), page, size));
}));

// ============ 详情：head + 车辆 + 派单记录 + 状态日志 + 轨迹 + 电子签 ============
router.get('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [task] = await query(
    `SELECT t.*, c.carrier_name, c.carrier_code, d.driver_name, d.phone AS driver_phone
     FROM shipping_task t
     LEFT JOIN carrier c ON c.id = t.carrier_id
     LEFT JOIN driver d ON d.id = t.driver_id
     WHERE t.id = ? AND t.deleted = 0`,
    [id]
  );
  if (!task) throw errNotFound('任务不存在');

  const [vehicles, dispatchRecords, statusLogs, tracks, esigns] = await Promise.all([
    query('SELECT * FROM shipping_task_vehicle WHERE task_id = ? AND deleted = 0 ORDER BY id', [id]),
    query('SELECT * FROM dispatch_record WHERE task_id = ? AND deleted = 0 ORDER BY dispatch_time, id', [id]),
    query('SELECT * FROM task_status_log WHERE task_id = ? AND deleted = 0 ORDER BY create_time, id', [id]),
    query('SELECT * FROM transport_track WHERE task_id = ? AND deleted = 0 ORDER BY report_time, id', [id]),
    query('SELECT * FROM esign_record WHERE task_id = ? AND deleted = 0 ORDER BY initiate_time, id', [id]),
  ]);

  ok(res, {
    task,
    vehicles,
    dispatchRecords,
    statusLogs,
    tracks,
    esigns,
    allowedActions: allowedActions(task.status),
  });
}));

// ============ 派单（契约 5.4：线路参考价只读，触发狮桥同步模拟） ============
router.post('/dispatch', wrap(async (req, res) => {
  const { task_id, carrier_id, remark } = req.body;
  if (!task_id) throw errParam('任务 ID 必填');
  if (!carrier_id) throw errParam('请选择承运商');
  if (remark && String(remark).length > 500) throw errParam('派单备注不能超过 500 字');

  const result = await withTransaction(async (conn) => {
    const task = await lockTask(conn, task_id);
    assertVersion(task, req.body.version);          // 乐观锁校验（D0001）
    if (task.status !== 'WAIT_DISPATCH') throw errState(`仅「待派单」状态的任务可以派单，当前状态不允许该操作`);
    const carrier = await assertCarrierDispatchable(conn, carrier_id); // 停用拦截(A0002)

    await conn.query(
      `UPDATE shipping_task SET carrier_id = ?, status = 'DISPATCHED', version = version + 1, update_name = '系统管理员' WHERE id = ? AND version = ?`,
      [Number(carrier_id), task.id, task.version]
    );
    await writeDispatchRecord(conn, {
      taskId: task.id, taskNo: task.task_no, action: 'DISPATCH', carrierId: Number(carrier_id),
      dispatchPerson: '系统管理员', remark: remark?.toString().trim() || null,
    });
    await writeStatusLog(conn, {
      taskId: task.id, taskNo: task.task_no, fromStatus: 'WAIT_DISPATCH', toStatus: 'DISPATCHED',
      source: 'STP', operator: '系统管理员', remark: `派单至承运商：${carrier.carrier_name}`,
    });
    return { task, carrier, version: Number(task.version) + 1 };
  });

  ok(res, {
    task_id: Number(task_id),
    task_no: result.task.task_no,
    status: 'DISPATCHED',
    version: result.version,
    carrier_id: Number(carrier_id),
    carrier_name: result.carrier.carrier_name,
    plan_freight: result.task.plan_freight, // 线路参考价只读回显
  }, `派单成功，任务已同步狮桥发运系统并下发 WMS（${result.carrier.carrier_name}）`);
}));

// ============ 批量派单（契约 5.4：batch_no 同批相同，返回 dispatched/total_freight/skipped） ============
router.post('/batch-dispatch', wrap(async (req, res) => {
  const { task_ids, carrier_id, remark } = req.body;
  if (!Array.isArray(task_ids) || !task_ids.length) throw errParam('请选择需要派单的任务');
  if (!carrier_id) throw errParam('请选择承运商');
  if (remark && String(remark).length > 500) throw errParam('批量派单备注不能超过 500 字');

  const skipped = [];
  let dispatched = 0;
  let totalFreight = 0;

  await withTransaction(async (conn) => {
    // 承运商校验（存在 + 合作中）与批次号生成与首单绑定
    const carrier = await assertCarrierDispatchable(conn, carrier_id);
    let batchNo = null;

    for (const tid of task_ids) {
      const idNum = Number(tid);
      if (!Number.isInteger(idNum) || idNum <= 0) {
        skipped.push({ task_id: idNum, task_no: '', reason: '任务 ID 不正确' });
        continue;
      }
      let task;
      try {
        task = await lockTask(conn, idNum); // 行锁读取任务
      } catch (e) {
        if (e.code === 'D0002') { skipped.push({ task_id: idNum, task_no: '', reason: '任务不存在' }); continue; }
        throw e;
      }
      if (task.status !== 'WAIT_DISPATCH') {
        skipped.push({ task_id: idNum, task_no: task.task_no, reason: `当前状态不允许派单（${task.status}），仅「待派单」可派单` });
        continue;
      }
      if (!batchNo) batchNo = await nextSeq('PD', conn); // 批量派单批次号：PD+yyyyMMdd+4 位（同批相同）

      await conn.query(
        `UPDATE shipping_task SET carrier_id = ?, status = 'DISPATCHED', version = version + 1, update_name = '系统管理员' WHERE id = ? AND version = ?`,
        [Number(carrier_id), task.id, task.version]
      );
      await writeDispatchRecord(conn, {
        taskId: task.id, taskNo: task.task_no, action: 'DISPATCH', carrierId: Number(carrier_id),
        batchNo, dispatchPerson: '系统管理员', remark: remark?.toString().trim() || null,
      });
      await writeStatusLog(conn, {
        taskId: task.id, taskNo: task.task_no, fromStatus: 'WAIT_DISPATCH', toStatus: 'DISPATCHED',
        source: 'STP', operator: '系统管理员', remark: `批量派单（批次 ${batchNo}）至承运商：${carrier.carrier_name}`,
      });
      dispatched += 1;
      totalFreight += Number(task.plan_freight) || 0;
    }
  });

  ok(res, {
    dispatched,
    total_freight: Number(totalFreight.toFixed(2)), // 成功单计划运费（参考价）合计
    skipped,
  }, `批量派单完成：成功 ${dispatched} 单` + (skipped.length ? `，跳过 ${skipped.length} 单` : ''));
}));

// ============ 取消派单（仅已派单即司机未接单 -> 待派单，契约 3.1/5.4） ============
router.post('/dispatch/cancel', wrap(async (req, res) => {
  const { task_id, reason, remark } = req.body;
  if (!task_id) throw errParam('任务 ID 必填');
  if (!reason || !CANCEL_REASONS.includes(reason)) {
    throw errParam(`取消原因必填，且仅支持：${CANCEL_REASONS.join('/')}`);
  }
  if (remark && String(remark).length > 500) throw errParam('补充说明不能超过 500 字');

  const result = await withTransaction(async (conn) => {
    const task = await lockTask(conn, task_id);
    assertVersion(task, req.body.version);
    if (task.status !== 'DISPATCHED') throw errState('仅「已派单」状态（司机未接单）的任务可以取消派单');

    await conn.query(
      `UPDATE shipping_task
         SET status = 'WAIT_DISPATCH', carrier_id = NULL, driver_id = NULL,
             version = version + 1, update_name = '系统管理员'
       WHERE id = ? AND version = ?`,
      [task.id, task.version]
    );
    await writeDispatchRecord(conn, {
      taskId: task.id, taskNo: task.task_no, action: 'CANCEL_DISPATCH', carrierId: task.carrier_id,
      dispatchPerson: '系统管理员', cancelReason: reason, remark: remark?.toString().trim() || null,
    });
    await writeStatusLog(conn, {
      taskId: task.id, taskNo: task.task_no, fromStatus: 'DISPATCHED', toStatus: 'WAIT_DISPATCH',
      source: 'STP', operator: '系统管理员',
      remark: `取消派单：${reason}${remark ? `——${remark}` : ''}，已同步狮桥取消`,
    });
    return { task, version: Number(task.version) + 1 };
  });

  ok(res, {
    task_id: Number(task_id),
    task_no: result.task.task_no,
    status: 'WAIT_DISPATCH',
    version: result.version,
  }, '已取消派单，任务回退到「待派单」，并同步狮桥取消');
}));

// ============ 改派（仅已派单，更换承运商，状态仍为已派单） ============
router.post('/dispatch/reassign', wrap(async (req, res) => {
  const { task_id, carrier_id, remark } = req.body;
  if (!task_id) throw errParam('任务 ID 必填');
  if (!carrier_id) throw errParam('请选择新的承运商');
  if (remark && String(remark).length > 500) throw errParam('派单备注不能超过 500 字');

  const result = await withTransaction(async (conn) => {
    const task = await lockTask(conn, task_id);
    assertVersion(task, req.body.version);
    if (task.status !== 'DISPATCHED') throw errState('仅「已派单」状态的任务可以改派');
    const carrier = await assertCarrierDispatchable(conn, carrier_id);
    if (task.carrier_id === Number(carrier_id)) throw errBiz('新承运商与原承运商相同，无需改派');

    // 原承运商名称（用于留痕文案）
    const [oldCarrierRows] = await conn.query('SELECT carrier_name FROM carrier WHERE id = ?', [task.carrier_id]);
    const oldName = oldCarrierRows.length ? oldCarrierRows[0].carrier_name : '原承运商';

    await conn.query(
      `UPDATE shipping_task SET carrier_id = ?, version = version + 1, update_name = '系统管理员' WHERE id = ? AND version = ?`,
      [Number(carrier_id), task.id, task.version]
    );
    await writeDispatchRecord(conn, {
      taskId: task.id, taskNo: task.task_no, action: 'REASSIGN', carrierId: Number(carrier_id),
      dispatchPerson: '系统管理员', remark: remark?.toString().trim() || null,
    });
    await writeStatusLog(conn, {
      taskId: task.id, taskNo: task.task_no, fromStatus: 'DISPATCHED', toStatus: 'DISPATCHED',
      source: 'STP', operator: '系统管理员',
      remark: `改派：${oldName} → ${carrier.carrier_name}，原派单已同步狮桥取消并重新下发`,
    });
    return { task, carrier, version: Number(task.version) + 1 };
  });

  ok(res, {
    task_id: Number(task_id),
    task_no: result.task.task_no,
    status: 'DISPATCHED',
    version: result.version,
    carrier_id: Number(carrier_id),
    carrier_name: result.carrier.carrier_name,
  }, `改派成功：${result.carrier.carrier_name}，原派单已同步狮桥取消`);
}));

module.exports = router;
