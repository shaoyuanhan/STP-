/**
 * 电子签章 - 电子签台账（契约 5.7）
 * 生命周期：WAIT_SIGN 待签署 → SIGNED 已签署 / CANCELLED 已取消（任务取消时关联待签署电子签同步置为已取消）
 */
const { Router } = require('express');
const { query } = require('../db');
const { wrap, ok, pageOf, pageData } = require('../helpers');
const { sendXlsx, text, dateTime } = require('../exporter');

const router = Router();

const SIGN_STATUS_LABELS = {
  WAIT_SIGN: '待签署',
  SIGNED: '已签署',
  CANCELLED: '已取消',
};

const TASK_STATUS_LABELS = {
  WAIT_DISPATCH: '待派单',
  DISPATCHED: '已派单',
  CARRIER_ACCEPTED: '承运商已接单',
  OUTBOUND: '已出库',
  PICKED: '已提车',
  IN_TRANSIT: '在途',
  ARRIVED: '已到达',
  FINISHED: '已完结',
  CANCELLED: '已取消',
};

/** 列表与导出共用筛选：esign_id/task_no/vin/apply_no/sign_status */
function esignWhere(q) {
  const { esign_id = '', task_no = '', vin = '', apply_no = '', sign_status = '' } = q;
  const where = ['e.deleted = 0'];
  const params = [];
  if (esign_id) where.push('e.esign_id LIKE ?'), params.push(`%${esign_id}%`);
  if (task_no) where.push('e.task_no LIKE ?'), params.push(`%${task_no}%`);
  if (vin) where.push('e.vin LIKE ?'), params.push(`%${vin}%`);
  if (apply_no) where.push('e.apply_no LIKE ?'), params.push(`%${apply_no}%`);
  if (sign_status) where.push('e.sign_status = ?'), params.push(sign_status);
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

const ESIGN_SELECT = `
  SELECT e.*, t.status AS task_status, t.customer_name
  FROM esign_record e
  LEFT JOIN shipping_task t ON t.id = e.task_id`;

/** 导出列（与列表展示一致） */
const ESIGN_EXPORT_COLUMNS = [
  { header: '电子签 ID', value: (r) => r.esign_id, width: 32 },
  { header: '任务单号', value: (r) => text(r.task_no), width: 20 },
  { header: '发运申请号', value: (r) => text(r.apply_no), width: 20 },
  { header: '客户', value: (r) => text(r.customer_name), width: 20 },
  { header: 'VIN', value: (r) => text(r.vin), width: 22 },
  { header: '签署类型', value: (r) => text(r.sign_type), width: 16 },
  { header: '触发节点', value: (r) => text(r.trigger_node), width: 24 },
  { header: '签署方', value: (r) => text(r.sign_party), width: 24 },
  { header: '发起时间', value: (r) => dateTime(r.initiate_time), width: 18 },
  { header: '签署状态', value: (r) => SIGN_STATUS_LABELS[r.sign_status] || r.sign_status, width: 10 },
  { header: '签署时间', value: (r) => dateTime(r.sign_time), width: 18 },
  { header: '任务状态', value: (r) => TASK_STATUS_LABELS[r.task_status] || text(r.task_status), width: 14 },
  { header: '创建时间', value: (r) => dateTime(r.create_time), width: 18 },
];

/** 台账列表：esign_id/task_no/vin/apply_no/sign_status 筛选 */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { whereSql, params } = esignWhere(req.query);

  const totalRows = await query(`SELECT COUNT(*) AS n FROM esign_record e ${whereSql}`, params);
  const list = await query(
    `${ESIGN_SELECT}
     ${whereSql}
     ORDER BY e.initiate_time DESC, e.id DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(list, Number(totalRows[0].n), page, size));
}));

/** 导出：按当前筛选条件导出全部（不分页） */
router.get('/export', wrap(async (req, res) => {
  const { whereSql, params } = esignWhere(req.query);
  const rows = await query(
    `${ESIGN_SELECT}
     ${whereSql}
     ORDER BY e.initiate_time DESC, e.id DESC
     LIMIT 50000`,
    params
  );
  sendXlsx(res, { prefix: '电子签台账', sheetName: '电子签', columns: ESIGN_EXPORT_COLUMNS, rows });
}));

module.exports = router;
