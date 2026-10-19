/**
 * 电子签章 - 电子签台账
 * PRD: 记录 物流电子签/客户电子签 发起与签署状态；任务取消时关联签单同步取消
 */
const { Router } = require('express');
const { query } = require('../db');
const { wrap, pageOf } = require('../helpers');

const router = Router();

/** 台账列表 */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { esign_id = '', task_no = '', sign_type = '', status = '' } = req.query;
  const where = [];
  const params = [];
  if (esign_id) where.push('e.esign_id LIKE ?'), params.push(`%${esign_id}%`);
  if (task_no) where.push('e.task_no LIKE ?'), params.push(`%${task_no}%`);
  if (sign_type) where.push('e.sign_type = ?'), params.push(sign_type);
  if (status) where.push('e.status = ?'), params.push(status);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [totalRows] = await query(`SELECT COUNT(*) AS n FROM esign_records e ${whereSql}`, params);
  const list = await query(
    `SELECT e.*, t.status AS task_status
     FROM esign_records e
     LEFT JOIN ship_tasks t ON t.id = e.task_id
     ${whereSql}
     ORDER BY e.initiated_at DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  res.json({ list, total: totalRows.n, page, size });
}));

module.exports = router;
