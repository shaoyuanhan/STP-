/**
 * 结算管理 - 应付运费对账
 * PRD: 任务完结后生成运费单；支持修改运费(需二次确认+原因)；确认对账
 */
const { Router } = require('express');
const { query } = require('../db');
const { BizError, wrap, pageOf } = require('../helpers');

const router = Router();

const FO_SELECT = `
  SELECT f.*,
         c.carrier_name,
         d.name AS driver_name
  FROM freight_orders f
  LEFT JOIN carriers c ON c.id = f.carrier_id
  LEFT JOIN drivers d ON d.id = f.driver_id`;

/** 运费单列表 */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { freight_no = '', task_no = '', carrier_id = '', status = '' } = req.query;
  const where = [];
  const params = [];
  if (freight_no) where.push('f.freight_no LIKE ?'), params.push(`%${freight_no}%`);
  if (task_no) where.push('f.task_no LIKE ?'), params.push(`%${task_no}%`);
  if (carrier_id) where.push('f.carrier_id = ?'), params.push(Number(carrier_id));
  if (status) where.push('f.status = ?'), params.push(status);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRows = await query(`SELECT COUNT(*) AS n FROM freight_orders f ${whereSql}`, params);
  const sumRows = await query(
    `SELECT COALESCE(SUM(actual_freight),0) AS amt FROM freight_orders f ${whereSql}`,
    params
  );
  const list = await query(`${FO_SELECT} ${whereSql} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`, [...params, size, offset]);
  res.json({ list, total: totalRows[0].n, amount: Number(sumRows[0].amt), page, size });
}));

/** 费用明细：运费单 + 修改记录 */
router.get('/:id', wrap(async (req, res) => {
  const { id } = req.params;
  const [order] = await query(`${FO_SELECT} WHERE f.id = ?`, [Number(id)]);
  if (!order) throw new BizError('运费单不存在', 404);
  const adjustments = await query(
    'SELECT * FROM freight_adjustments WHERE freight_order_id = ? ORDER BY created_at DESC',
    [Number(id)]
  );
  res.json({ order, adjustments });
}));

/** 修改运费：记录前后金额与原因 */
router.post('/:id/adjust', wrap(async (req, res) => {
  const { id } = req.params;
  const { amount, reason } = req.body;
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt < 0) throw new BizError('请输入有效的运费金额');
  if (!reason?.trim()) throw new BizError('请填写修改原因');

  const [order] = await query('SELECT * FROM freight_orders WHERE id = ?', [Number(id)]);
  if (!order) throw new BizError('运费单不存在', 404);
  if (Number(order.actual_freight) === amt) throw new BizError('新运费与当前运费一致，无需修改');

  await query('UPDATE freight_orders SET actual_freight = ? WHERE id = ?', [amt, Number(id)]);
  await query(
    'INSERT INTO freight_adjustments (freight_order_id, before_amount, after_amount, reason, operator) VALUES (?, ?, ?, ?, ?)',
    [Number(id), Number(order.actual_freight), amt, reason.trim(), req.body.operator || '系统管理员']
  );
  res.json({ message: '运费修改成功，已记录修改日志' });
}));

/** 确认对账：仅待对账可确认 */
router.post('/:id/recon', wrap(async (req, res) => {
  const { id } = req.params;
  const [order] = await query('SELECT * FROM freight_orders WHERE id = ?', [Number(id)]);
  if (!order) throw new BizError('运费单不存在', 404);
  if (order.status !== 'PENDING_RECON') throw new BizError('仅"待对账"状态的运费单可确认对账');
  await query("UPDATE freight_orders SET status = 'RECONED' WHERE id = ?", [Number(id)]);
  res.json({ message: '确认对账成功' });
}));

module.exports = router;
