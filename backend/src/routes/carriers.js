/**
 * 基础数据 - 承运商管理
 * PRD: 编码自动生成 CAR-三位序列号；名称去重；停用后不可被派单、不影响在途运单
 */
const { Router } = require('express');
const { query, nextSeq } = require('../db');
const { BizError, wrap, pageOf } = require('../helpers');

const router = Router();

/** 列表：关键字/状态筛选 + 在册司机数 */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { keyword = '', status = '' } = req.query;
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(carrier_name LIKE ? OR contact_person LIKE ? OR contact_phone LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (status) where.push('status = ?'), params.push(status);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [totalRows] = await query(`SELECT COUNT(*) AS n FROM carriers ${whereSql}`, params);
  const list = await query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM drivers d WHERE d.carrier_id = c.id AND d.status = 'ENABLED') AS driver_count
     FROM carriers c
     ${whereSql}
     ORDER BY c.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  res.json({ list, total: totalRows.n, page, size });
}));

/** 新增：编码系统生成，名称去重校验 */
router.post('/', wrap(async (req, res) => {
  const { carrier_name, contact_person, contact_phone, coop_routes = null, remark = null } = req.body;
  if (!carrier_name?.trim()) throw new BizError('承运商名称必填');
  if (!contact_person?.trim()) throw new BizError('联系人必填');
  if (!contact_phone?.trim()) throw new BizError('联系电话必填');

  const dup = await query('SELECT id FROM carriers WHERE carrier_name = ?', [carrier_name.trim()]);
  if (dup.length) throw new BizError('承运商名称已存在，请勿重复添加', 409);

  const carrier_code = await nextSeq('CAR');
  const r = await query(
    `INSERT INTO carriers (carrier_code, carrier_name, contact_person, contact_phone, coop_routes, status, remark)
     VALUES (?, ?, ?, ?, ?, 'COOPERATING', ?)`,
    [carrier_code, carrier_name.trim(), contact_person.trim(), contact_phone.trim(), coop_routes, remark]
  );
  const [created] = await query('SELECT * FROM carriers WHERE id = ?', [r.insertId]);
  res.status(201).json({ message: '新增成功', data: created });
}));

/** 编辑：联系人/电话/合作路线/备注可改，名称去重 */
router.put('/:id', wrap(async (req, res) => {
  const { id } = req.params;
  const { carrier_name, contact_person, contact_phone, coop_routes = null, remark = null } = req.body;
  const [exist] = await query('SELECT * FROM carriers WHERE id = ?', [id]);
  if (!exist) throw new BizError('承运商不存在', 404);
  if (!carrier_name?.trim() || !contact_person?.trim() || !contact_phone?.trim()) {
    throw new BizError('名称、联系人、联系电话必填');
  }
  const dup = await query('SELECT id FROM carriers WHERE carrier_name = ? AND id != ?', [carrier_name.trim(), Number(id)]);
  if (dup.length) throw new BizError('承运商名称已存在', 409);

  await query(
    `UPDATE carriers SET carrier_name = ?, contact_person = ?, contact_phone = ?, coop_routes = ?, remark = ? WHERE id = ?`,
    [carrier_name.trim(), contact_person.trim(), contact_phone.trim(), coop_routes, remark, Number(id)]
  );
  const [updated] = await query('SELECT * FROM carriers WHERE id = ?', [Number(id)]);
  res.json({ message: '修改成功', data: updated });
}));

/** 停用/启用：停用后不可被派单，不影响在途运单 */
router.put('/:id/status', wrap(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['COOPERATING', 'DISABLED'].includes(status)) throw new BizError('非法状态');
  const [exist] = await query('SELECT * FROM carriers WHERE id = ?', [Number(id)]);
  if (!exist) throw new BizError('承运商不存在', 404);

  await query('UPDATE carriers SET status = ? WHERE id = ?', [status, Number(id)]);
  const [updated] = await query('SELECT * FROM carriers WHERE id = ?', [Number(id)]);
  res.json({
    message: status === 'DISABLED' ? '已停用，该承运商不可被派单，在途运单不受影响' : '已启用',
    data: updated,
  });
}));

module.exports = router;
