/**
 * 工作台统计（契约 5.1：结构自定，前端适配）
 * 输出：各状态任务数、今日新增、待对账笔数/金额、在途数、电子签待签署数、合作中承运商/启用司机数
 */
const { Router } = require('express');
const { query } = require('../db');
const { wrap, ok } = require('../helpers');

const router = Router();

// 任务状态全集（保证每个状态都有计数，前端可直接遍历渲染）
const TASK_STATUSES = [
  'WAIT_DISPATCH', 'DISPATCHED', 'CARRIER_ACCEPTED', 'PICKED',
  'OUTBOUND', 'IN_TRANSIT', 'ARRIVED', 'FINISHED', 'CANCELLED',
];

router.get('/', wrap(async (req, res) => {
  const [statusRows, todayRows, billRows, esignRows, carrierRows, driverRows] = await Promise.all([
    query('SELECT status, COUNT(*) AS n FROM shipping_task WHERE deleted = 0 GROUP BY status'),
    query('SELECT COUNT(*) AS n FROM shipping_task WHERE deleted = 0 AND create_time >= CURDATE()'),
    query("SELECT COUNT(*) AS n, COALESCE(SUM(actual_freight), 0) AS amount FROM freight_bill WHERE deleted = 0 AND reconcile_status = 0"),
    query("SELECT COUNT(*) AS n FROM esign_record WHERE deleted = 0 AND sign_status = 'WAIT_SIGN'"),
    query('SELECT COUNT(*) AS n FROM carrier WHERE deleted = 0 AND status = 1'),
    query('SELECT COUNT(*) AS n FROM driver WHERE deleted = 0 AND status = 1'),
  ]);

  // 各状态任务数
  const task = {};
  TASK_STATUSES.forEach((s) => { task[s] = 0; });
  statusRows.forEach((r) => { task[r.status] = Number(r.n); });
  const total = statusRows.reduce((s, r) => s + Number(r.n), 0);

  ok(res, {
    task: { ...task, total },                                    // 各状态任务数 + 总数
    todayNew: Number(todayRows[0].n),                            // 今日新增任务数
    inTransit: task.IN_TRANSIT,                                  // 在途数
    freightPending: {                                            // 待对账笔数/金额
      count: Number(billRows[0].n),
      amount: Number(billRows[0].amount),
    },
    esignWaitSign: Number(esignRows[0].n),                       // 电子签待签署数
    cooperatingCarriers: Number(carrierRows[0].n),              // 合作中承运商数
    enabledDrivers: Number(driverRows[0].n),                    // 启用司机数
  });
}));

module.exports = router;
