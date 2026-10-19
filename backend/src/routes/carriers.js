/**
 * 基础数据 - 承运商管理（契约 5.2）
 * 规则：编码 CAR-XXX 系统自动生成且只读；名称去重(A0002)；停用后不可被派单、在途不受影响
 * 全部查询过滤 deleted=0
 */
const { Router } = require('express');
const { query, nextSeq } = require('../db');
const { wrap, ok, errParam, errBiz, errNotFound, pageOf, pageData, assertPhone } = require('../helpers');

const router = Router();

/** 列表：关键字/状态筛选 + 在册（关联且启用的）司机数 */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { keyword = '', status = '' } = req.query;
  const where = ['c.deleted = 0'];
  const params = [];
  if (keyword) {
    where.push('(c.carrier_name LIKE ? OR c.contact_person LIKE ? OR c.carrier_code LIKE ? OR c.contact_phone LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  if (status !== '' && status !== undefined && status !== null) {
    where.push('c.status = ?');
    params.push(Number(status));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRows = await query(`SELECT COUNT(*) AS n FROM carrier c ${whereSql}`, params);
  const list = await query(
    `SELECT c.*,
            (SELECT COUNT(*)
               FROM carrier_driver cd
               JOIN driver d ON d.id = cd.driver_id AND d.deleted = 0
              WHERE cd.carrier_id = c.id AND cd.deleted = 0 AND d.status = 1) AS driver_count
     FROM carrier c
     ${whereSql}
     ORDER BY c.create_time DESC, c.id DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(list, Number(totalRows[0].n), page, size));
}));

/** 校验并归一化承运商入参（新增/编辑共用） */
function normalizeCarrierBody(body) {
  const carrier_name = String(body.carrier_name ?? '').trim();
  const contact_person = String(body.contact_person ?? '').trim();
  if (!carrier_name) throw errParam('承运商名称必填');
  if (carrier_name.length > 128) throw errParam('承运商名称不能超过 128 字');
  if (!contact_person) throw errParam('联系人必填');
  const contact_phone = assertPhone(body.contact_phone, { label: '联系电话' });
  const cooperation_routes = body.cooperation_routes?.toString().trim() || null;
  const remark = body.remark?.toString().trim() || null;
  if (cooperation_routes && cooperation_routes.length > 512) throw errParam('合作路线不能超过 512 字');
  if (remark && remark.length > 512) throw errParam('备注不能超过 512 字');
  return { carrier_name, contact_person, contact_phone, cooperation_routes, remark };
}

/** 新增：编码系统自动生成，名称去重(A0002) */
router.post('/', wrap(async (req, res) => {
  const v = normalizeCarrierBody(req.body);
  const dup = await query('SELECT id FROM carrier WHERE carrier_name = ? AND deleted = 0', [v.carrier_name]);
  if (dup.length) throw errBiz('承运商名称已存在，请勿重复添加');

  const carrier_code = await nextSeq('CAR');
  const r = await query(
    `INSERT INTO carrier (carrier_code, carrier_name, contact_person, contact_phone, cooperation_routes, remark, status, create_name, update_name)
     VALUES (?, ?, ?, ?, ?, ?, 1, '系统管理员', '系统管理员')`,
    [carrier_code, v.carrier_name, v.contact_person, v.contact_phone, v.cooperation_routes, v.remark]
  );
  const [created] = await query('SELECT * FROM carrier WHERE id = ?', [r.insertId]);
  ok(res, created);
}));

/** 编辑：编码只读；名称改名校验去重(A0002) */
router.put('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [exist] = await query('SELECT * FROM carrier WHERE id = ? AND deleted = 0', [id]);
  if (!exist) throw errNotFound('承运商不存在');

  const v = normalizeCarrierBody(req.body);
  const dup = await query('SELECT id FROM carrier WHERE carrier_name = ? AND deleted = 0 AND id != ?', [v.carrier_name, id]);
  if (dup.length) throw errBiz('承运商名称已存在，请勿重复添加');

  await query(
    `UPDATE carrier SET carrier_name = ?, contact_person = ?, contact_phone = ?, cooperation_routes = ?, remark = ?, update_name = '系统管理员' WHERE id = ?`,
    [v.carrier_name, v.contact_person, v.contact_phone, v.cooperation_routes, v.remark, id]
  );
  const [updated] = await query('SELECT * FROM carrier WHERE id = ?', [id]);
  ok(res, updated);
}));

/** 停用/启用：停用后不可被派单，不影响在途运单 */
router.put('/:id/status', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!Number.isInteger(Number(status)) || ![0, 1].includes(Number(status))) {
    throw errParam('状态值仅支持 1（合作中）或 0（已停用）');
  }
  const st = Number(status);
  const [exist] = await query('SELECT * FROM carrier WHERE id = ? AND deleted = 0', [id]);
  if (!exist) throw errNotFound('承运商不存在');

  await query('UPDATE carrier SET status = ?, update_name = ? WHERE id = ?', [st, '系统管理员', id]);
  const [updated] = await query('SELECT * FROM carrier WHERE id = ?', [id]);
  ok(res, updated, 'success');
}));

module.exports = router;
