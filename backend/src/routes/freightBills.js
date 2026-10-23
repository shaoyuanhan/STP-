/**
 * 结算管理 - 应付运费对账（契约 5.6）
 * 规则：到达时生成运费单（待对账）；修改运费仅待对账可改（已对账 A0002），每次修改写调整记录；
 *       确认对账 0→1，reconciler=系统管理员
 */
const { Router } = require('express');
const { query, withTransaction } = require('../db');
const {
  wrap, ok, errParam, errBiz, errState, errNotFound,
  pageOf, pageData, assertAmount,
} = require('../helpers');
const { sendXlsx, text, dateTime } = require('../exporter');

const router = Router();

/** 列表与导出共用的筛选条件 */
function freightWhere(q) {
  const { freight_no = '', task_no = '', order_no = '', carrier_id = '', reconcile_status = '' } = q;
  const where = ['f.deleted = 0'];
  const params = [];
  if (freight_no) where.push('f.freight_no LIKE ?'), params.push(`%${freight_no}%`);
  if (task_no) where.push('f.task_no LIKE ?'), params.push(`%${task_no}%`);
  if (order_no) where.push('t.order_no LIKE ?'), params.push(`%${order_no}%`);
  if (carrier_id) where.push('f.carrier_id = ?'), params.push(Number(carrier_id));
  if (reconcile_status !== '' && reconcile_status !== undefined && reconcile_status !== null) {
    where.push('f.reconcile_status = ?');
    params.push(Number(reconcile_status));
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

/** 导出列（与列表展示一致） */
const FREIGHT_EXPORT_COLUMNS = [
  { header: '运费单号', value: (r) => r.freight_no, width: 20 },
  { header: '任务单号', value: (r) => r.task_no, width: 20 },
  { header: '订单号', value: (r) => text(r.order_no), width: 20 },
  { header: '客户', value: (r) => text(r.customer_name), width: 20 },
  { header: '承运商', value: (r) => text(r.carrier_name), width: 24 },
  { header: '起点', value: (r) => text(r.start_location), width: 20 },
  { header: '终点', value: (r) => text(r.end_location), width: 20 },
  { header: '里程(km)', value: (r) => r.mileage, type: 'number', width: 12 },
  { header: '计划运费', value: (r) => r.plan_freight, type: 'number', width: 12 },
  { header: '实际运费', value: (r) => r.actual_freight, type: 'number', width: 12 },
  { header: '对账状态', value: (r) => (Number(r.reconcile_status) === 1 ? '已对账' : '待对账'), width: 10 },
  { header: '对账人', value: (r) => text(r.reconciler), width: 12 },
  { header: '对账时间', value: (r) => dateTime(r.reconcile_time), width: 18 },
  { header: '到达时间', value: (r) => dateTime(r.create_time), width: 18 },
  { header: '完结时间', value: (r) => dateTime(r.finish_time), width: 18 },
];

const BILL_SELECT = `
  SELECT f.*,
         c.carrier_name, c.carrier_code,
         d.driver_name,
         t.customer_name, t.order_no, t.apply_no, t.status AS task_status
  FROM freight_bill f
  LEFT JOIN carrier c ON c.id = f.carrier_id
  LEFT JOIN driver d ON d.id = f.driver_id
  LEFT JOIN shipping_task t ON t.id = f.task_id`;

/** 运费单列表：多条件筛选 + 合计金额 */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { whereSql, params } = freightWhere(req.query);

  const totalRows = await query(`SELECT COUNT(*) AS n FROM freight_bill f LEFT JOIN shipping_task t ON t.id = f.task_id ${whereSql}`, params);
  const sumRows = await query(
    `SELECT COALESCE(SUM(f.actual_freight), 0) AS amount, COALESCE(SUM(f.plan_freight), 0) AS plan_amount
     FROM freight_bill f LEFT JOIN shipping_task t ON t.id = f.task_id ${whereSql}`,
    params
  );
  const list = await query(`${BILL_SELECT} ${whereSql} ORDER BY f.create_time DESC, f.id DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
  ok(res, pageData(list, Number(totalRows[0].n), page, size, {
    amount: Number(sumRows[0].amount),       // 实际运费合计
    plan_amount: Number(sumRows[0].plan_amount), // 计划运费合计
  }));
}));

/** 导出：按当前筛选条件导出全部（不分页） */
router.get('/export', wrap(async (req, res) => {
  const { whereSql, params } = freightWhere(req.query);
  const rows = await query(
    `${BILL_SELECT} ${whereSql} ORDER BY f.create_time DESC, f.id DESC LIMIT 50000`,
    params
  );
  sendXlsx(res, { prefix: '应付运费对账', sheetName: '运费单', columns: FREIGHT_EXPORT_COLUMNS, rows });
}));

/** 费用明细：运费单 + 调整记录（无修改则空数组） */
router.get('/:id/detail', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [bill] = await query(`${BILL_SELECT} WHERE f.id = ? AND f.deleted = 0`, [id]);
  if (!bill) throw errNotFound('运费单不存在');
  const adjustLogs = await query(
    'SELECT * FROM freight_adjust_log WHERE freight_bill_id = ? AND deleted = 0 ORDER BY create_time, id',
    [id]
  );
  ok(res, { bill, adjustLogs });
}));

/** 修改运费：仅「待对账」可改（已对账 A0002），写调整记录（每次修改一条） */
router.put('/:id/freight', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const amount = assertAmount(req.body.actual_freight, { label: '实际运费' });
  const reason = String(req.body.reason ?? '').trim();
  if (!reason) throw errParam('请填写修改原因');
  if (reason.length > 255) throw errParam('修改原因不能超过 255 字');

  const result = await withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM freight_bill WHERE id = ? AND deleted = 0 FOR UPDATE', [id]);
    if (!rows.length) throw errNotFound('运费单不存在');
    const bill = rows[0];
    if (Number(bill.reconcile_status) === 1) throw errBiz('该运费单已对账，不可修改运费');
    if (Number(bill.actual_freight) === amount) throw errBiz('新运费与当前运费一致，无需修改');

    await conn.query(
      "UPDATE freight_bill SET actual_freight = ?, update_name = '系统管理员' WHERE id = ?",
      [amount, id]
    );
    await conn.query(
      `INSERT INTO freight_adjust_log (freight_bill_id, freight_no, before_freight, after_freight, adjust_reason, operator, create_name, update_name)
       VALUES (?, ?, ?, ?, ?, '系统管理员', '系统管理员', '系统管理员')`,
      [id, bill.freight_no, Number(bill.actual_freight), amount, reason]
    );
    return { bill, after: amount };
  });

  ok(res, {
    id,
    freight_no: result.bill.freight_no,
    before_freight: Number(result.bill.actual_freight),
    after_freight: result.after,
    message: '运费修改成功，已记录调整日志',
  });
}));

/** 确认对账：待对账 0→1，对账人=系统管理员 */
router.post('/:id/reconcile', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const result = await withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM freight_bill WHERE id = ? AND deleted = 0 FOR UPDATE', [id]);
    if (!rows.length) throw errNotFound('运费单不存在');
    const bill = rows[0];
    if (Number(bill.reconcile_status) === 1) throw errState('该运费单已对账，请勿重复操作');

    await conn.query(
      `UPDATE freight_bill SET reconcile_status = 1, reconcile_time = NOW(), reconciler = '系统管理员', update_name = '系统管理员' WHERE id = ?`,
      [id]
    );
    return bill;
  });

  ok(res, {
    id,
    freight_no: result.freight_no,
    reconcile_status: 1,
    reconciler: '系统管理员',
    message: '确认对账成功',
  });
}));

module.exports = router;
