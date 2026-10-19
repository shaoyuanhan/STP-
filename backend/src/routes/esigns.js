/**
 * 电子签章 - 电子签台账（契约 5.7）
 * 生命周期：WAIT_SIGN 待签署 → SIGNED 已签署 / CANCELLED 已取消（任务取消时关联待签署电子签同步置为已取消）
 */
const { Router } = require('express');
const { query } = require('../db');
const { wrap, ok, pageOf, pageData } = require('../helpers');

const router = Router();

/** 台账列表：esign_id/task_no/vin/apply_no/sign_status 筛选 */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { esign_id = '', task_no = '', vin = '', apply_no = '', sign_status = '' } = req.query;
  const where = ['e.deleted = 0'];
  const params = [];
  if (esign_id) where.push('e.esign_id LIKE ?'), params.push(`%${esign_id}%`);
  if (task_no) where.push('e.task_no LIKE ?'), params.push(`%${task_no}%`);
  if (vin) where.push('e.vin LIKE ?'), params.push(`%${vin}%`);
  if (apply_no) where.push('e.apply_no LIKE ?'), params.push(`%${apply_no}%`);
  if (sign_status) where.push('e.sign_status = ?'), params.push(sign_status);
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRows = await query(`SELECT COUNT(*) AS n FROM esign_record e ${whereSql}`, params);
  const list = await query(
    `SELECT e.*, t.status AS task_status, t.customer_name
     FROM esign_record e
     LEFT JOIN shipping_task t ON t.id = e.task_id
     ${whereSql}
     ORDER BY e.initiate_time DESC, e.id DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(list, Number(totalRows[0].n), page, size));
}));

module.exports = router;
