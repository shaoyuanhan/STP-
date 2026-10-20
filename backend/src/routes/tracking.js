/**
 * 运输调度 - 在途监控（契约 5.5）
 * 列表：未终态任务（不含 FINISHED/CANCELLED），IN_TRANSIT 最优先，含最近一条位置信息
 * 详情：task + statusLogs + tracks（时间升序）
 */
const { Router } = require('express');
const { query } = require('../db');
const { wrap, ok, errNotFound, pageOf, pageData } = require('../helpers');

const router = Router();

// 在途列表包含的未终态状态；排序：在途最优先，其余按创建时间倒序
const ACTIVE_STATUSES = ['WAIT_DISPATCH', 'DISPATCHED', 'CARRIER_ACCEPTED', 'PICKED', 'OUTBOUND', 'IN_TRANSIT', 'ARRIVED'];
const STATUS_ORDER = ['IN_TRANSIT', 'OUTBOUND', 'PICKED', 'ARRIVED', 'CARRIER_ACCEPTED', 'DISPATCHED', 'WAIT_DISPATCH'];

/** 在途任务列表 */
router.get('/tasks', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { task_no = '', transport_no = '' } = req.query;
  const where = [`t.deleted = 0`, `t.status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`];
  const params = [...ACTIVE_STATUSES];
  if (task_no) where.push('t.task_no LIKE ?'), params.push(`%${task_no}%`);
  if (transport_no) {
    where.push('EXISTS (SELECT 1 FROM transport_track tr WHERE tr.task_id = t.id AND tr.deleted = 0 AND tr.transport_no LIKE ?)');
    params.push(`%${transport_no}%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRows = await query(`SELECT COUNT(*) AS n FROM shipping_task t ${whereSql}`, params);
  const list = await query(
    `SELECT t.id, t.task_no, t.apply_no, t.customer_name, t.status, t.ship_location, t.delivery_address,
            t.plan_pickup_date, t.ship_time, t.arrive_time, t.create_time, t.version,
            c.carrier_name, d.driver_name, d.phone AS driver_phone,
            tr.transport_no, tr.location_desc, tr.longitude, tr.latitude, tr.speed, tr.report_time
     FROM shipping_task t
     LEFT JOIN carrier c ON c.id = t.carrier_id
     LEFT JOIN driver d ON d.id = t.driver_id
     LEFT JOIN (SELECT task_id, MAX(id) AS max_id FROM transport_track WHERE deleted = 0 GROUP BY task_id) lm
            ON lm.task_id = t.id
     LEFT JOIN transport_track tr ON tr.id = lm.max_id
     ${whereSql}
     ORDER BY FIELD(t.status, ${STATUS_ORDER.map(() => '?').join(',')}), t.create_time DESC, t.id DESC
     LIMIT ? OFFSET ?`,
    [...params, ...STATUS_ORDER, size, offset]
  );
  ok(res, pageData(list, Number(totalRows[0].n), page, size));
}));

/** 在途运单详情：运单信息 + 运输节点 + 位置轨迹（时间升序） */
router.get('/tasks/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [task] = await query(
    `SELECT t.*, c.carrier_name, d.driver_name, d.phone AS driver_phone
     FROM shipping_task t
     LEFT JOIN carrier c ON c.id = t.carrier_id
     LEFT JOIN driver d ON d.id = t.driver_id
     WHERE t.id = ? AND t.deleted = 0`,
    [id]
  );
  if (!task) throw errNotFound('运单不存在');

  const [statusLogs, tracks] = await Promise.all([
    query('SELECT * FROM task_status_log WHERE task_id = ? AND deleted = 0 ORDER BY create_time, id', [id]),
    query('SELECT * FROM transport_track WHERE task_id = ? AND deleted = 0 ORDER BY report_time, id', [id]),
  ]);
  ok(res, { task, statusLogs, tracks });
}));

module.exports = router;
