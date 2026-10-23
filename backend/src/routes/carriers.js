/**
 * 基础数据 - 承运商管理（契约 5.2）
 * 规则：编码 CAR-XXX 系统自动生成且只读；名称去重(A0002)；停用后不可被派单、在途不受影响
 * 全部查询过滤 deleted=0
 */
const { Router } = require('express');
const { query, nextSeq } = require('../db');
const { wrap, ok, errParam, errBiz, errNotFound, pageOf, pageData, assertPhone } = require('../helpers');
const { sendXlsx, text, dateTime, phoneText } = require('../exporter');

const router = Router();

/** 列表与导出共用的筛选条件（名称/编码/联系人/电话/第三方ID/状态） */
function carrierWhere(q) {
  const {
    carrier_name = '', carrier_code = '', contact_person = '', contact_phone = '',
    external_carrier_id = '', status = '',
  } = q;
  const where = ['c.deleted = 0'];
  const params = [];
  const kw = (v) => `%${String(v).trim()}%`;
  if (carrier_name) where.push('c.carrier_name LIKE ?'), params.push(kw(carrier_name));
  if (carrier_code) where.push('c.carrier_code LIKE ?'), params.push(kw(carrier_code));
  if (contact_person) where.push('c.contact_person LIKE ?'), params.push(kw(contact_person));
  if (contact_phone) where.push('c.contact_phone LIKE ?'), params.push(kw(contact_phone));
  if (external_carrier_id) where.push('c.external_carrier_id LIKE ?'), params.push(kw(external_carrier_id));
  if (status !== '' && status !== undefined && status !== null) {
    where.push('c.status = ?');
    params.push(Number(status));
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

const CARRIER_SELECT = `
  SELECT c.*,
         (SELECT COUNT(*)
            FROM driver d
           WHERE d.carrier_id = c.id AND d.deleted = 0 AND d.status = 1) AS driver_count
  FROM carrier c`;

/** 导出列（与列表展示一致） */
const CARRIER_EXPORT_COLUMNS = [
  { header: '承运商编码', value: (r) => r.carrier_code, width: 14 },
  { header: '第三方承运商ID', value: (r) => text(r.external_carrier_id), width: 20 },
  { header: '承运商名称', value: (r) => r.carrier_name, width: 28 },
  { header: '联系人', value: (r) => r.contact_person, width: 12 },
  { header: '联系电话', value: (r) => phoneText(r.contact_phone), width: 16 },
  { header: '合作路线', value: (r) => text(r.cooperation_routes), width: 30 },
  { header: '在册司机', value: (r) => Number(r.driver_count) || 0, type: 'number', width: 10 },
  { header: '状态', value: (r) => (Number(r.status) === 1 ? '合作中' : '已停用'), width: 10 },
  { header: '备注', value: (r) => text(r.remark), width: 30 },
  { header: '创建时间', value: (r) => dateTime(r.create_time), width: 20 },
];

/** 列表：按字段分项筛选 + 在册（关联且启用的）司机数 */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { whereSql, params } = carrierWhere(req.query);

  const totalRows = await query(`SELECT COUNT(*) AS n FROM carrier c ${whereSql}`, params);
  const list = await query(
    `${CARRIER_SELECT}
     ${whereSql}
     ORDER BY c.create_time DESC, c.id DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(list, Number(totalRows[0].n), page, size));
}));

/** 导出：按当前筛选条件导出全部（不分页） */
router.get('/export', wrap(async (req, res) => {
  const { whereSql, params } = carrierWhere(req.query);
  const rows = await query(
    `${CARRIER_SELECT}
     ${whereSql}
     ORDER BY c.create_time DESC, c.id DESC
     LIMIT 50000`,
    params
  );
  sendXlsx(res, { prefix: '承运商管理', sheetName: '承运商', columns: CARRIER_EXPORT_COLUMNS, rows });
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
  // 第三方承运商ID：外部系统主键，选填，全局唯一（派单/回传可用其定位）
  const external_carrier_id = body.external_carrier_id?.toString().trim() || null;
  if (external_carrier_id && external_carrier_id.length > 64) throw errParam('第三方承运商ID不能超过 64 字');
  if (cooperation_routes && cooperation_routes.length > 512) throw errParam('合作路线不能超过 512 字');
  if (remark && remark.length > 512) throw errParam('备注不能超过 512 字');
  return { carrier_name, contact_person, contact_phone, cooperation_routes, remark, external_carrier_id };
}

/** 第三方承运商ID去重（A0002） */
async function assertExternalCarrierIdUnique(externalCarrierId, excludeId) {
  if (!externalCarrierId) return;
  const dup = await query(
    `SELECT id FROM carrier WHERE external_carrier_id = ? AND deleted = 0${excludeId ? ' AND id != ?' : ''}`,
    excludeId ? [externalCarrierId, excludeId] : [externalCarrierId]
  );
  if (dup.length) throw errBiz(`第三方承运商ID ${externalCarrierId} 已被其他承运商使用`);
}

/** 新增：编码系统自动生成，名称去重(A0002) */
router.post('/', wrap(async (req, res) => {
  const v = normalizeCarrierBody(req.body);
  const dup = await query('SELECT id FROM carrier WHERE carrier_name = ? AND deleted = 0', [v.carrier_name]);
  if (dup.length) throw errBiz('承运商名称已存在，请勿重复添加');
  await assertExternalCarrierIdUnique(v.external_carrier_id);

  const carrier_code = await nextSeq('CAR');
  const r = await query(
    `INSERT INTO carrier (carrier_code, external_carrier_id, carrier_name, contact_person, contact_phone, cooperation_routes, remark, status, create_name, update_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, '系统管理员', '系统管理员')`,
    [carrier_code, v.external_carrier_id, v.carrier_name, v.contact_person, v.contact_phone, v.cooperation_routes, v.remark]
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
  await assertExternalCarrierIdUnique(v.external_carrier_id, id);

  await query(
    `UPDATE carrier SET external_carrier_id = ?, carrier_name = ?, contact_person = ?, contact_phone = ?, cooperation_routes = ?, remark = ?, update_name = '系统管理员' WHERE id = ?`,
    [v.external_carrier_id, v.carrier_name, v.contact_person, v.contact_phone, v.cooperation_routes, v.remark, id]
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
