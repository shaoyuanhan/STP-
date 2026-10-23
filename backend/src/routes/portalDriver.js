/**
 * 司机端 API（前缀 /api/portal/driver）
 * 权限：登录账号类型 DRIVER，只能查看/操作 driver_id 为自己的任务
 */
const { Router } = require('express');
const { query } = require('../db');
const { wrap, ok, pageOf, pageData, errNotFound, errBiz } = require('../helpers');
const { requireAuth } = require('../services/security');
const { pickupTask, arriveTask, finishTask, PICKUP_PHOTO_MIN } = require('../services/taskFlow');

const router = Router();
router.use(requireAuth(['DRIVER']));

const TAB_STATUS = {
  pending_pickup: ['CARRIER_ACCEPTED'],
  transit: ['PICKED', 'OUTBOUND', 'IN_TRANSIT'],
  pending_finish: ['ARRIVED'],
  finished: ['FINISHED'],
};

const TASK_SELECT = `
  SELECT t.id, t.task_no, t.order_no, t.apply_no, t.customer_name, t.status,
         t.ship_location, t.delivery_area, t.delivery_address,
         t.plan_freight, t.actual_freight, t.mileage,
         t.plan_pickup_date, t.outbound_date, t.ship_time, t.arrive_time, t.finish_time,
         t.create_time, t.version, c.carrier_name,
         (SELECT GROUP_CONCAT(v.vin ORDER BY v.id SEPARATOR '、') FROM shipping_task_vehicle v
           WHERE v.task_id = t.id AND v.deleted = 0) AS vins,
         (SELECT GROUP_CONCAT(v.vehicle_model ORDER BY v.id SEPARATOR '、') FROM shipping_task_vehicle v
           WHERE v.task_id = t.id AND v.deleted = 0) AS vehicle_models
  FROM shipping_task t
  LEFT JOIN carrier c ON c.id = t.carrier_id`;

function actionsOf(status) {
  if (status === 'CARRIER_ACCEPTED') return ['PICKUP'];
  if (status === 'IN_TRANSIT') return ['ARRIVE'];
  if (status === 'ARRIVED') return ['FINISH'];
  if (status === 'PICKED' || status === 'OUTBOUND') return ['WAIT_OUTBOUND'];
  return [];
}

/** 我的任务列表 */
router.get('/tasks', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const tab = String(req.query.tab ?? '');
  const keyword = String(req.query.keyword ?? '').trim();
  const where = ['t.deleted = 0', 't.driver_id = ?'];
  const params = [Number(req.auth.driverId)];

  if (TAB_STATUS[tab]) {
    where.push(`t.status IN (${TAB_STATUS[tab].map(() => '?').join(',')})`);
    params.push(...TAB_STATUS[tab]);
  } else {
    where.push("t.status IN ('CARRIER_ACCEPTED','PICKED','OUTBOUND','IN_TRANSIT','ARRIVED','FINISHED')");
  }
  if (keyword) {
    const kw = `%${keyword}%`;
    where.push(`(t.task_no LIKE ? OR t.customer_name LIKE ? OR EXISTS (
      SELECT 1 FROM shipping_task_vehicle v WHERE v.task_id = t.id AND v.deleted = 0 AND v.vin LIKE ?
    ))`);
    params.push(kw, kw, kw);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const totalRows = await query(`SELECT COUNT(*) AS n FROM shipping_task t ${whereSql}`, params);
  const rows = await query(
    `${TASK_SELECT} ${whereSql} ORDER BY t.create_time DESC, t.id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(rows, Number(totalRows[0].n), page, size));
}));

/** 任务详情 */
router.get('/tasks/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [task] = await query(
    `SELECT t.*, c.carrier_name, c.contact_person AS carrier_contact, c.contact_phone AS carrier_phone,
            d.driver_name, d.phone AS driver_phone
     FROM shipping_task t
     LEFT JOIN carrier c ON c.id = t.carrier_id
     LEFT JOIN driver d ON d.id = t.driver_id
     WHERE t.id = ? AND t.deleted = 0`,
    [id]
  );
  if (!task) throw errNotFound('任务不存在');
  if (Number(task.driver_id) !== Number(req.auth.driverId)) throw errBiz('该任务未指派给您');

  const [vehicles, logs, files] = await Promise.all([
    query('SELECT * FROM shipping_task_vehicle WHERE task_id = ? AND deleted = 0 ORDER BY id', [id]),
    query('SELECT * FROM task_status_log WHERE task_id = ? AND deleted = 0 ORDER BY create_time, id', [id]),
    query('SELECT * FROM task_file WHERE task_id = ? AND deleted = 0 ORDER BY id', [id]),
  ]);

  ok(res, {
    task,
    vehicles,
    status_logs: logs,
    files,
    allowed_actions: actionsOf(task.status),
    pickup_photo_min: PICKUP_PHOTO_MIN,
    dev_tools: (process.env.PORTAL_DEV_TOOLS || '1') === '1',
  });
}));

/** 确认提车（照片强制） */
router.post('/tasks/:id/pickup', wrap(async (req, res) => {
  const result = await pickupTask({
    taskId: Number(req.params.id),
    driverId: req.auth.driverId,
    version: req.body.version,
    photos: req.body.photos,
    pickupDate: req.body.pickup_date,
    operator: req.auth.name,
  });
  ok(res, result, '提车确认成功，等待仓库出库');
}));

/** 确认到达（必须已在途；实际运费必填） */
router.post('/tasks/:id/arrive', wrap(async (req, res) => {
  const result = await arriveTask({
    taskId: Number(req.params.id),
    driverId: req.auth.driverId,
    version: req.body.version,
    photos: req.body.photos,
    actualFreight: req.body.actual_freight,
    mileage: req.body.mileage,
    arriveTime: req.body.arrive_time,
    operator: req.auth.name,
  });
  ok(res, result, `到达确认成功，已生成运费单 ${result.freight_no}`);
}));

/** 结单 */
router.post('/tasks/:id/finish', wrap(async (req, res) => {
  const result = await finishTask({
    taskId: Number(req.params.id),
    driverId: req.auth.driverId,
    version: req.body.version,
    photos: req.body.photos,
    receiver: req.body.receiver,
    remark: req.body.remark,
    operator: req.auth.name,
  });
  ok(res, result, '任务已结单');
}));

/** 消息中心 */
router.get('/notifications', wrap(async (req, res) => {
  const rows = await query(
    `SELECT * FROM notification
     WHERE receiver_type = 'DRIVER' AND receiver_id = ? AND deleted = 0
     ORDER BY id DESC LIMIT 100`,
    [req.auth.driverId]
  );
  ok(res, rows);
}));

router.post('/notifications/:id/read', wrap(async (req, res) => {
  await query(
    `UPDATE notification SET read_status = 1
     WHERE id = ? AND receiver_type = 'DRIVER' AND receiver_id = ?`,
    [Number(req.params.id), req.auth.driverId]
  );
  ok(res, null);
}));

module.exports = router;
