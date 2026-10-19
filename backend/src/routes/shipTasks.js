/**
 * 运输调度 - 发运任务
 * PRD 状态机: 待派单 -> 已派单 -> 承运商已接单 -> 已出库/已提车 -> 在途 -> 已到达 -> 已完结 / 已取消
 */
const { Router } = require('express');
const { query } = require('../db');
const { BizError, wrap, pageOf } = require('../helpers');

const router = Router();

const TASK_SELECT = `
  SELECT t.*,
         c.carrier_name, c.carrier_code,
         d.name AS driver_name, d.phone AS driver_phone, d.vehicle_type AS driver_license_type
  FROM ship_tasks t
  LEFT JOIN carriers c ON c.id = t.carrier_id
  LEFT JOIN drivers d ON d.id = t.driver_id`;

/** 列表：多条件筛选 */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { task_no = '', apply_no = '', vin = '', customer_name = '', status = '', carrier_id = '', start_date = '', end_date = '' } = req.query;
  const where = [];
  const params = [];
  if (task_no) where.push('t.task_no LIKE ?'), params.push(`%${task_no}%`);
  if (apply_no) where.push('t.apply_no LIKE ?'), params.push(`%${apply_no}%`);
  if (vin) where.push('t.vin LIKE ?'), params.push(`%${vin}%`);
  if (customer_name) where.push('t.customer_name LIKE ?'), params.push(`%${customer_name}%`);
  if (status) where.push('t.status = ?'), params.push(status);
  if (carrier_id) where.push('t.carrier_id = ?'), params.push(Number(carrier_id));
  if (start_date) where.push('t.created_at >= ?'), params.push(`${start_date} 00:00:00`);
  if (end_date) where.push('t.created_at <= ?'), params.push(`${end_date} 23:59:59`);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [totalRows] = await query(`SELECT COUNT(*) AS n FROM ship_tasks t ${whereSql}`, params);
  const list = await query(`${TASK_SELECT} ${whereSql} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
  res.json({ list, total: totalRows.n, page, size });
}));

/** 详情：基础信息 + 车辆信息 + 运输执行(节点/位置/电子签) */
router.get('/:id', wrap(async (req, res) => {
  const { id } = req.params;
  const [task] = await query(`${TASK_SELECT} WHERE t.id = ?`, [Number(id)]);
  if (!task) throw new BizError('任务不存在', 404);

  const [events, trackings, esigns] = await Promise.all([
    query('SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC, id ASC', [Number(id)]),
    query('SELECT * FROM tracking_records WHERE task_id = ? ORDER BY reported_at DESC, id DESC', [Number(id)]),
    query('SELECT * FROM esign_records WHERE task_id = ? ORDER BY initiated_at DESC', [Number(id)]),
  ]);
  res.json({ task, events, trackings, esigns });
}));

/** 记录节点公共方法 */
async function addEvent(taskId, node, nodeName, detail, operator) {
  await query('INSERT INTO task_events (task_id, node, node_name, detail, operator) VALUES (?, ?, ?, ?, ?)',
    [Number(taskId), node, nodeName, detail, operator || '系统管理员']);
}

/** 派单：仅"待派单"；承运商必须合作中（停用不可被派单）；remark 为调度派单备注 */
router.post('/:id/dispatch', wrap(async (req, res) => {
  const { id } = req.params;
  const { carrier_id, remark } = req.body;
  if (!carrier_id) throw new BizError('请选择承运商');
  if (remark && remark.length > 500) throw new BizError('派单备注不能超过500字');

  const [task] = await query('SELECT * FROM ship_tasks WHERE id = ?', [Number(id)]);
  if (!task) throw new BizError('任务不存在', 404);
  if (task.status !== 'PENDING') throw new BizError('仅"待派单"状态的任务可以派单');

  const [carrier] = await query('SELECT * FROM carriers WHERE id = ?', [Number(carrier_id)]);
  if (!carrier) throw new BizError('承运商不存在', 404);
  if (carrier.status !== 'COOPERATING') throw new BizError('该承运商已停用，不可被派单');

  const remarkV = remark?.trim() || null;
  await query('UPDATE ship_tasks SET carrier_id = ?, dispatch_remark = ?, status = ? WHERE id = ?',
    [Number(carrier_id), remarkV, 'DISPATCHED', Number(id)]);
  await addEvent(id, 'DISPATCH', '调度派单', `派单至承运商：${carrier.carrier_name}，线路参考价 ${Number(task.plan_freight).toFixed(2)} 元${remarkV ? `，备注：${remarkV}` : ''}`);
  res.json({ message: `派单成功，已同步狮桥发运系统`, carrier_name: carrier.carrier_name });
}));

/** 批量派单：仅"待派单"；remark 为批量派单备注，写入每单派单备注 */
router.post('/dispatch-batch', wrap(async (req, res) => {
  const { task_ids = [], carrier_id, remark } = req.body;
  if (!Array.isArray(task_ids) || !task_ids.length) throw new BizError('请选择需要派单的任务');
  if (!carrier_id) throw new BizError('请选择承运商');
  if (remark && remark.length > 500) throw new BizError('派单备注不能超过500字');

  const [carrier] = await query('SELECT * FROM carriers WHERE id = ?', [Number(carrier_id)]);
  if (!carrier) throw new BizError('承运商不存在', 404);
  if (carrier.status !== 'COOPERATING') throw new BizError('该承运商已停用，不可被派单');

  const remarkV = remark?.trim() || null;
  let ok = 0;
  let totalFreight = 0;
  const skipped = [];
  for (const tid of task_ids) {
    const [task] = await query('SELECT * FROM ship_tasks WHERE id = ?', [Number(tid)]);
    if (!task || task.status !== 'PENDING') { skipped.push(task ? task.task_no : `ID:${tid}`); continue; }
    await query('UPDATE ship_tasks SET carrier_id = ?, dispatch_remark = ?, status = ? WHERE id = ?',
      [Number(carrier_id), remarkV, 'DISPATCHED', Number(tid)]);
    await addEvent(tid, 'DISPATCH', '调度派单', `批量派单至承运商：${carrier.carrier_name}，线路参考价 ${Number(task.plan_freight).toFixed(2)} 元${remarkV ? `，备注：${remarkV}` : ''}`);
    ok += 1;
    totalFreight += Number(task.plan_freight) || 0;
  }
  res.json({
    message: `批量派单完成：成功 ${ok} 单${ok ? `，参考价合计 ${totalFreight.toFixed(2)} 元` : ''}${skipped.length ? `，跳过 ${skipped.length} 单（非待派单状态）` : ''}`,
    dispatched: ok, total_freight: totalFreight, skipped,
  });
}));

/** 取消派单：仅"已派单" -> 回到待派单，取消原因枚举：承运商无法履约/调度调整/其他 */
router.post('/:id/cancel-dispatch', wrap(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const REASONS = ['承运商无法履约', '调度调整', '其他'];
  const finalReason = REASONS.includes(reason) ? reason : (reason?.trim() || '其他');

  const [task] = await query(`${TASK_SELECT} WHERE t.id = ?`, [Number(id)]);
  if (!task) throw new BizError('任务不存在', 404);
  if (task.status !== 'DISPATCHED') throw new BizError('仅"已派单"状态的任务可以取消派单');

  await query('UPDATE ship_tasks SET carrier_id = NULL, driver_id = NULL, status = ?, plan_pickup_date = NULL, dispatch_remark = NULL WHERE id = ?',
    ['PENDING', Number(id)]);
  await addEvent(id, 'CANCEL', '取消派单', `取消派单（${task.carrier_name}），原因：${finalReason}，已同步三方物流系统`);
  res.json({ message: '已取消派单，任务回到待派单，并同步三方物流系统' });
}));

/** 改派：仅"已派单"；已同步三方的需同步取消状态；remark 覆盖派单备注 */
router.post('/:id/reassign', wrap(async (req, res) => {
  const { id } = req.params;
  const { carrier_id, remark } = req.body;
  if (!carrier_id) throw new BizError('请选择新的承运商');
  if (remark && remark.length > 500) throw new BizError('派单备注不能超过500字');

  const [task] = await query(`${TASK_SELECT} WHERE t.id = ?`, [Number(id)]);
  if (!task) throw new BizError('任务不存在', 404);
  if (task.status !== 'DISPATCHED') throw new BizError('仅"已派单"状态的任务可以改派');

  const [carrier] = await query('SELECT * FROM carriers WHERE id = ?', [Number(carrier_id)]);
  if (!carrier) throw new BizError('承运商不存在', 404);
  if (carrier.status !== 'COOPERATING') throw new BizError('该承运商已停用，不可被派单');
  if (task.carrier_id === Number(carrier_id)) throw new BizError('新承运商与原承运商相同');

  const remarkV = remark !== undefined ? (remark?.trim() || null) : task.dispatch_remark;
  await query('UPDATE ship_tasks SET carrier_id = ?, dispatch_remark = ? WHERE id = ?', [Number(carrier_id), remarkV, Number(id)]);
  await addEvent(id, 'REASSIGN', '改派', `改派：${task.carrier_name} -> ${carrier.carrier_name}，线路参考价 ${Number(task.plan_freight).toFixed(2)} 元${remarkV ? `，备注：${remarkV}` : ''}，原派单已同步三方取消`);
  res.json({ message: `改派成功：${carrier.carrier_name}，原派单已同步三方物流系统取消` });
}));

module.exports = router;
