/**
 * 基础数据 - 司机管理
 * PRD: 姓名和身份证号不可修改；停用后不可再分派任务、不影响当前在途运单
 */
const { Router } = require('express');
const { query } = require('../db');
const { BizError, wrap, pageOf } = require('../helpers');

const router = Router();

/** 列表 */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { keyword = '', carrier_id = '', status = '' } = req.query;
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(d.name LIKE ? OR d.phone LIKE ? OR d.id_card LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (carrier_id) where.push('d.carrier_id = ?'), params.push(Number(carrier_id));
  if (status) where.push('d.status = ?'), params.push(status);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [totalRows] = await query(`SELECT COUNT(*) AS n FROM drivers d ${whereSql}`, params);
  const list = await query(
    `SELECT d.*, c.carrier_name, c.carrier_code
     FROM drivers d
     LEFT JOIN carriers c ON c.id = d.carrier_id
     ${whereSql}
     ORDER BY d.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  res.json({ list, total: totalRows.n, page, size });
}));

/** 可选司机（派单后承接商接单时分配）：按承运商过滤且启用中 */
router.get('/options', wrap(async (req, res) => {
  const { carrier_id = '' } = req.query;
  const sql = `
    SELECT d.id, d.name, d.phone, d.vehicle_type, d.carrier_id, c.carrier_name
    FROM drivers d LEFT JOIN carriers c ON c.id = d.carrier_id
    WHERE d.status = 'ENABLED' ${carrier_id ? 'AND d.carrier_id = ?' : ''}
    ORDER BY d.name`;
  const list = await query(sql, carrier_id ? [Number(carrier_id)] : []);
  res.json({ list });
}));

/** 新增司机 */
router.post('/', wrap(async (req, res) => {
  const { name, phone, id_card, license_no = null, vehicle_type = null,
    license_valid_from, license_valid_to, carrier_id = null, remark = null } = req.body;
  if (!name?.trim()) throw new BizError('司机姓名必填');
  if (!phone?.trim()) throw new BizError('手机号必填');
  if (!id_card?.trim()) throw new BizError('身份证号必填');
  if (!license_valid_from) throw new BizError('驾驶证有效期自必填');
  if (!license_valid_to) throw new BizError('驾驶证有效期至必填');

  const dup = await query('SELECT id FROM drivers WHERE id_card = ?', [id_card.trim()]);
  if (dup.length) throw new BizError('该身份证号已存在，请勿重复添加', 409);

  const r = await query(
    `INSERT INTO drivers (name, phone, id_card, license_no, vehicle_type, license_valid_from, license_valid_to, carrier_id, status, remark)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ENABLED', ?)`,
    [name.trim(), phone.trim(), id_card.trim(), license_no, vehicle_type, license_valid_from, license_valid_to,
      carrier_id ? Number(carrier_id) : null, remark]
  );
  const [created] = await query(
    `SELECT d.*, c.carrier_name, c.carrier_code FROM drivers d LEFT JOIN carriers c ON c.id = d.carrier_id WHERE d.id = ?`,
    [r.insertId]
  );
  res.status(201).json({ message: '新增成功', data: created });
}));

/** 编辑：姓名与身份证号不可修改 */
router.put('/:id', wrap(async (req, res) => {
  const { id } = req.params;
  const { phone, license_no = null, vehicle_type = null,
    license_valid_from, license_valid_to, carrier_id = null, remark = null } = req.body;
  const [exist] = await query('SELECT * FROM drivers WHERE id = ?', [Number(id)]);
  if (!exist) throw new BizError('司机不存在', 404);
  if (!phone?.trim()) throw new BizError('手机号必填');
  if (!license_valid_from || !license_valid_to) throw new BizError('驾驶证有效期必填');

  await query(
    `UPDATE drivers SET phone = ?, license_no = ?, vehicle_type = ?, license_valid_from = ?, license_valid_to = ?, carrier_id = ?, remark = ? WHERE id = ?`,
    [phone.trim(), license_no, vehicle_type, license_valid_from, license_valid_to,
      carrier_id ? Number(carrier_id) : null, remark, Number(id)]
  );
  const [updated] = await query(
    `SELECT d.*, c.carrier_name, c.carrier_code FROM drivers d LEFT JOIN carriers c ON c.id = d.carrier_id WHERE d.id = ?`,
    [Number(id)]
  );
  res.json({ message: '修改成功（姓名与身份证号不可修改）', data: updated });
}));

/** 停用/启用：停用后不可再分派任务，不影响在途运单 */
router.put('/:id/status', wrap(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['ENABLED', 'DISABLED'].includes(status)) throw new BizError('非法状态');
  const [exist] = await query('SELECT * FROM drivers WHERE id = ?', [Number(id)]);
  if (!exist) throw new BizError('司机不存在', 404);

  await query('UPDATE drivers SET status = ? WHERE id = ?', [status, Number(id)]);
  res.json({
    message: status === 'DISABLED' ? '已停用，该司机不可再被分派任务，在途运单不受影响' : '已启用',
  });
}));

module.exports = router;
