/**
 * 运输调度 - 在途监控
 * PRD: 默认列表优先展示在途运单，按创建日期降序；查看运单展示整体运输节点与位置信息
 */
const { Router } = require('express');
const { query } = require('../db');
const { BizError, wrap, pageOf } = require('../helpers');

const router = Router();

/** 在途任务列表（在途优先，其余状态靠后） */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { task_no = '', transport_no = '' } = req.query;
  const where = ["t.status IN ('PENDING','DISPATCHED','ACCEPTED','OUT_BOUND','PICKED_UP','IN_TRANSIT','ARRIVED')"];
  const params = [];
  if (task_no) where.push('t.task_no LIKE ?'), params.push(`%${task_no}%`);
  if (transport_no) {
    where.push('t.id IN (SELECT task_id FROM tracking_records WHERE transport_no LIKE ?)');
    params.push(`%${transport_no}%`);
  }

  const list = await query(
    `SELECT t.id, t.task_no, t.status, t.vin, t.vehicle_model, t.origin, t.dest_region, t.dest_address,
            t.ship_at, t.arrive_at, t.created_at,
            c.carrier_name,
            d.name AS driver_name, d.phone AS driver_phone,
            tr.transport_no, tr.position_desc, tr.speed, tr.reported_at
     FROM ship_tasks t
     LEFT JOIN carriers c ON c.id = t.carrier_id
     LEFT JOIN drivers d ON d.id = t.driver_id
     LEFT JOIN (SELECT task_id, MAX(id) AS max_id FROM tracking_records GROUP BY task_id) lm
            ON lm.task_id = t.id
     LEFT JOIN tracking_records tr ON tr.id = lm.max_id
     WHERE ${where.join(' AND ')}
     ORDER BY FIELD(t.status,'IN_TRANSIT','PICKED_UP','OUT_BOUND','ARRIVED','ACCEPTED','DISPATCHED','PENDING'),
              t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  const [totalRows] = await query(
    `SELECT COUNT(*) AS n FROM ship_tasks t WHERE ${where.join(' AND ')}`,
    params
  );
  res.json({ list, total: totalRows.n, page, size });
}));

/** 运单在途详情：运单信息 + 运输节点 + 位置轨迹 */
router.get('/:taskId', wrap(async (req, res) => {
  const { taskId } = req.params;
  const [task] = await query(
    `SELECT t.*, c.carrier_name, d.name AS driver_name, d.phone AS driver_phone
     FROM ship_tasks t
     LEFT JOIN carriers c ON c.id = t.carrier_id
     LEFT JOIN drivers d ON d.id = t.driver_id
     WHERE t.id = ?`,
    [Number(taskId)]
  );
  if (!task) throw new BizError('运单不存在', 404);

  const [events, trackings] = await Promise.all([
    query('SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC, id ASC', [Number(taskId)]),
    query('SELECT * FROM tracking_records WHERE task_id = ? ORDER BY reported_at ASC, id ASC', [Number(taskId)]),
  ]);
  res.json({ task, events, trackings });
}));

module.exports = router;
