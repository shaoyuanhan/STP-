/**
 * 基础数据 - 司机管理（契约 5.3）
 * 规则：姓名/身份证不可改(A0002)；司机档案归属于唯一承运商（driver.carrier_id），
 *       同一司机在多家承运商下是各自独立的档案；
 *       停用后不可分派任务、不影响在途运单；外部狮桥同步 source=2，自建 source=1
 */
const { Router } = require('express');
const { query, withTransaction } = require('../db');
const {
  wrap, ok, errParam, errBiz, errNotFound, pageOf, pageData,
  assertPhone, assertIdCard,
} = require('../helpers');
const { sendXlsx, text, dateOnly, dateTime, phoneText } = require('../exporter');
const { verifyToken } = require('../services/security');
const { loadAccess } = require('../services/access');
const { ensureDriverAccount, syncDriverAccountStatus } = require('../services/driverAccount');

const router = Router();

/** 登录账号的数据权限；未登录/司机端不按承运商范围过滤（司机端不走本接口） */
async function accessOf(req) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const payload = verifyToken(token);
  if (!payload?.sub || payload.type === 'DRIVER') return null;
  return loadAccess(payload.sub);
}

/** 角色的承运商范围：司机档案归属的承运商须在范围内 */
function applyCarrierScope(where, params, access) {
  if (!access || access.carriers === 'ALL') return;
  if (!access.carriers.length) {
    where.push('1 = 0');
    return;
  }
  where.push(`d.carrier_id IN (${access.carriers.map(() => '?').join(',')})`);
  params.push(...access.carriers);
}

/** 建号结果校验：手机号在承运商内被其他司机占用时中止，避免账号手机号与档案不一致 */
function assertNoPhoneConflict(result, phone) {
  if (result?.blocked) throw errBiz(`手机号 ${phone} 已被本承运商其他司机占用，请先处理原司机账号`);
  if (result?.phoneConflict) throw errBiz(`手机号 ${phone} 已被本承运商其他司机占用，请更换手机号`);
}

/** 行后处理：carrier_id 统一成数字，carrier_name 为空时给空串便于前端直接展示 */
function decorateDriver(row) {
  return {
    ...row,
    carrier_id: row.carrier_id === null || row.carrier_id === undefined ? null : Number(row.carrier_id),
    carrier_name: row.carrier_name || '',
  };
}

/** 列表与导出共用的筛选条件（姓名/手机号/身份证号/驾驶证号/第三方ID/承运商/状态 + 数据权限） */
function driverWhere(q, access) {
  const {
    driver_name = '', phone = '', id_card = '', license_no = '',
    external_driver_id = '', carrier_id = '', status = '',
  } = q;
  const where = ['d.deleted = 0'];
  const params = [];
  applyCarrierScope(where, params, access);
  const kw = (v) => `%${String(v).trim()}%`;
  if (driver_name) where.push('d.driver_name LIKE ?'), params.push(kw(driver_name));
  if (phone) where.push('d.phone LIKE ?'), params.push(kw(phone));
  if (id_card) where.push('d.id_card LIKE ?'), params.push(kw(id_card));
  if (license_no) where.push('d.license_no LIKE ?'), params.push(kw(license_no));
  if (external_driver_id) where.push('d.external_driver_id LIKE ?'), params.push(kw(external_driver_id));
  if (carrier_id) {
    where.push('d.carrier_id = ?');
    params.push(Number(carrier_id));
  }
  if (status !== '' && status !== undefined && status !== null) {
    where.push('d.status = ?');
    params.push(Number(status));
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

/** 导出列（与列表展示一致） */
const DRIVER_EXPORT_COLUMNS = [
  { header: '姓名', value: (r) => r.driver_name, width: 12 },
  { header: '第三方司机ID', value: (r) => text(r.external_driver_id), width: 20 },
  { header: '手机号', value: (r) => phoneText(r.phone), width: 16 },
  { header: '身份证号', value: (r) => r.id_card, width: 22 },
  { header: '驾驶证号', value: (r) => text(r.license_no), width: 22 },
  { header: '准驾车型', value: (r) => text(r.license_type), width: 10 },
  { header: '有效期自', value: (r) => dateOnly(r.license_valid_from), width: 12 },
  { header: '有效期至', value: (r) => dateOnly(r.license_valid_to), width: 12 },
  {
    header: '所属承运商',
    value: (r) => text(r.carrier_name) || '-',
    width: 28,
  },
  { header: '来源', value: (r) => ({ 1: '系统录入', 2: '狮桥同步' }[Number(r.source)] || '-'), width: 12 },
  { header: '状态', value: (r) => (Number(r.status) === 1 ? '启用' : '停用'), width: 8 },
  { header: '创建时间', value: (r) => dateTime(r.create_time), width: 20 },
];

/** 列表/导出/详情共用的查询主体：司机 + 所属承运商名 */
const DRIVER_SELECT = `
  SELECT d.*, c.carrier_name AS carrier_name
  FROM driver d
  LEFT JOIN carrier c ON c.id = d.carrier_id AND c.deleted = 0`;

/** 列表：按字段分项筛选，含所属承运商 */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { whereSql, params } = driverWhere(req.query, await accessOf(req));

  const totalRows = await query(`SELECT COUNT(*) AS n FROM driver d ${whereSql}`, params);
  const rows = await query(
    `${DRIVER_SELECT}
     ${whereSql}
     ORDER BY d.create_time DESC, d.id DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(rows.map(decorateDriver), Number(totalRows[0].n), page, size));
}));

/** 导出：按当前筛选条件导出全部（不分页） */
router.get('/export', wrap(async (req, res) => {
  const { whereSql, params } = driverWhere(req.query, await accessOf(req));
  const rows = await query(
    `${DRIVER_SELECT}
     ${whereSql}
     ORDER BY d.create_time DESC, d.id DESC
     LIMIT 50000`,
    params
  );
  sendXlsx(res, {
    prefix: '司机管理',
    sheetName: '司机',
    columns: DRIVER_EXPORT_COLUMNS,
    rows: rows.map(decorateDriver),
  });
}));

/** 可选司机下拉（狮桥接单模拟用）：该承运商下启用的司机 */
router.get('/options', wrap(async (req, res) => {
  const { carrier_id = '' } = req.query;
  let list;
  if (carrier_id) {
    list = await query(
      `SELECT d.id, d.driver_name AS name, d.phone, d.license_type, d.external_driver_id
       FROM driver d
       WHERE d.carrier_id = ? AND d.deleted = 0 AND d.status = 1
       ORDER BY d.id`,
      [Number(carrier_id)]
    );
  } else {
    list = await query(
      `SELECT d.id, d.driver_name AS name, d.phone, d.license_type, d.external_driver_id
       FROM driver d WHERE d.deleted = 0 AND d.status = 1 ORDER BY d.id`
    );
  }
  ok(res, list);
}));

/** 校验驾驶证有效期起止顺序，倒置抛 A0001 */
function assertLicenseRange(from, to) {
  if (!from) throw errParam('驾驶证有效期自必填');
  if (!to) throw errParam('驾驶证有效期至必填');
  if (String(from) > String(to)) {
    throw errParam(`驾驶证有效期起（${from}）不能晚于有效期止（${to}）`);
  }
}

/** 校验并归一化司机入参（新增/编辑共用，不含姓名身份证不可改校验） */
function normalizeDriverBody(body) {
  const phone = assertPhone(body.phone, { label: '手机号', mobileOnly: true });
  const id_card = assertIdCard(body.id_card, { label: '身份证号' });
  assertLicenseRange(body.license_valid_from, body.license_valid_to);
  const license_no = body.license_no?.toString().trim() || null;
  const license_type = body.license_type?.toString().trim() || null;
  const remark = body.remark?.toString().trim() || null;
  // 第三方司机ID：外部系统主键，承运商内唯一（接单/回传可用其定位）
  const external_driver_id = body.external_driver_id?.toString().trim() || null;
  if (external_driver_id && external_driver_id.length > 64) throw errParam('第三方司机ID不能超过 64 字');
  const carrier_id = Number(body.carrier_id);
  if (!Number.isInteger(carrier_id) || carrier_id <= 0) throw errParam('所属承运商必填');
  return { phone, id_card, license_no, license_type, license_valid_from: body.license_valid_from, license_valid_to: body.license_valid_to, remark, carrier_id, external_driver_id };
}

/** 所属承运商必须存在 */
async function assertCarrierExists(carrierId) {
  const rows = await query('SELECT id, carrier_name FROM carrier WHERE id = ? AND deleted = 0', [carrierId]);
  if (!rows.length) throw errNotFound(`承运商不存在（ID: ${carrierId}）`);
  return rows[0];
}

/** 第三方司机ID去重（A0002）：承运商内唯一 */
async function assertExternalDriverIdUnique(externalDriverId, carrierId, excludeId) {
  if (!externalDriverId) return;
  const dup = await query(
    `SELECT id FROM driver WHERE carrier_id = ? AND external_driver_id = ? AND deleted = 0${excludeId ? ' AND id != ?' : ''}`,
    excludeId ? [carrierId, externalDriverId, excludeId] : [carrierId, externalDriverId]
  );
  if (dup.length) throw errBiz(`第三方司机ID ${externalDriverId} 已被本承运商其他司机使用`);
}

/** 新增司机：source=1 自建；同一承运商内身份证唯一(A0002) */
router.post('/', wrap(async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!name) throw errParam('司机姓名必填');
  if (name.length > 64) throw errParam('司机姓名不能超过 64 字');
  const v = normalizeDriverBody(req.body);
  await assertCarrierExists(v.carrier_id);

  const dup = await query(
    'SELECT id FROM driver WHERE carrier_id = ? AND id_card = ? AND deleted = 0',
    [v.carrier_id, v.id_card]
  );
  if (dup.length) throw errBiz('该承运商下已存在相同身份证号的司机，请勿重复添加');
  await assertExternalDriverIdUnique(v.external_driver_id, v.carrier_id);

  const createdId = await withTransaction(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO driver (driver_name, external_driver_id, phone, id_card, carrier_id, license_no, license_type, license_valid_from, license_valid_to, source, status, remark, create_name, update_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, '系统管理员', '系统管理员')`,
      [name, v.external_driver_id, v.phone, v.id_card, v.carrier_id, v.license_no, v.license_type, v.license_valid_from, v.license_valid_to, v.remark]
    );
    const account = await ensureDriverAccount(conn, {
      driverId: r.insertId,
      driverName: name,
      phone: v.phone,
      carrierId: v.carrier_id,
      operator: '系统管理员',
    });
    assertNoPhoneConflict(account, v.phone);
    return r.insertId;
  });

  const [created] = await query(`${DRIVER_SELECT} WHERE d.id = ?`, [createdId]);
  ok(res, created ? decorateDriver(created) : null);
}));

/** 编辑：姓名与身份证号不可修改(A0002)；可调整所属承运商（有在途任务时禁止） */
router.put('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [exist] = await query('SELECT * FROM driver WHERE id = ? AND deleted = 0', [id]);
  if (!exist) throw errNotFound('司机不存在');

  // 姓名与身份证号不可修改（契约 5.3 / 既有需求 10）
  if (req.body.name !== undefined && String(req.body.name).trim() !== exist.driver_name) {
    throw errBiz('司机姓名不可修改');
  }
  if (req.body.id_card !== undefined && String(req.body.id_card).trim().toUpperCase() !== exist.id_card) {
    throw errBiz('身份证号不可修改');
  }

  const v = normalizeDriverBody({ ...req.body, id_card: exist.id_card });
  const carrierChanged = Number(exist.carrier_id) !== v.carrier_id;
  if (carrierChanged) {
    await assertCarrierExists(v.carrier_id);
    const active = await query(
      `SELECT id FROM shipping_task
       WHERE driver_id = ? AND deleted = 0
         AND status IN ('CARRIER_ACCEPTED','PICKED','OUTBOUND','IN_TRANSIT','ARRIVED')
       LIMIT 1`,
      [id]
    );
    if (active.length) throw errBiz('该司机存在在途任务，暂不能更换所属承运商');
    const dup = await query(
      'SELECT id FROM driver WHERE carrier_id = ? AND id_card = ? AND deleted = 0 AND id != ?',
      [v.carrier_id, v.id_card, id]
    );
    if (dup.length) throw errBiz('目标承运商下已存在相同身份证号的司机档案');
  }
  await assertExternalDriverIdUnique(v.external_driver_id, v.carrier_id, id);

  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE driver SET carrier_id = ?, external_driver_id = ?, phone = ?, license_no = ?, license_type = ?, license_valid_from = ?, license_valid_to = ?, remark = ?, update_name = '系统管理员' WHERE id = ?`,
      [v.carrier_id, v.external_driver_id, v.phone, v.license_no, v.license_type, v.license_valid_from, v.license_valid_to, v.remark, id]
    );
    const account = await ensureDriverAccount(conn, {
      driverId: id,
      driverName: exist.driver_name,
      phone: v.phone,
      carrierId: v.carrier_id,
      operator: '系统管理员',
    });
    assertNoPhoneConflict(account, v.phone);
  });

  const [updated] = await query(`${DRIVER_SELECT} WHERE d.id = ?`, [id]);
  ok(res, updated ? decorateDriver(updated) : null);
}));

/** 停用/启用：停用后不可再分派任务，不影响在途运单 */
router.put('/:id/status', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body;
  if (!Number.isInteger(Number(status)) || ![0, 1].includes(Number(status))) {
    throw errParam('状态值仅支持 1（启用）或 0（停用）');
  }
  const [exist] = await query('SELECT * FROM driver WHERE id = ? AND deleted = 0', [id]);
  if (!exist) throw errNotFound('司机不存在');

  await withTransaction(async (conn) => {
    await conn.query('UPDATE driver SET status = ?, update_name = ? WHERE id = ?', [Number(status), '系统管理员', id]);
    await syncDriverAccountStatus(conn, id, Number(status), '系统管理员');
  });
  const [updated] = await query('SELECT * FROM driver WHERE id = ?', [id]);
  ok(res, updated);
}));

module.exports = router;
