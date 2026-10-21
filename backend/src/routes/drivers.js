/**
 * 基础数据 - 司机管理（契约 5.3）
 * 规则：姓名/身份证不可改(A0002)；司机-承运商多对多经 carrier_driver 维护；
 *       停用后不可分派任务、不影响在途运单；外部狮桥同步 source=2，自建 source=1
 */
const { Router } = require('express');
const { query, withTransaction } = require('../db');
const {
  wrap, ok, errParam, errBiz, errNotFound, pageOf, pageData,
  assertPhone, assertIdCard,
} = require('../helpers');

const router = Router();

/** 行后处理：carriers 逗号连接字符串 + carrier_ids 数组 */
function decorateDriver(row) {
  const carriers = row.carriers ? String(row.carriers).split(',').filter(Boolean) : [];
  return {
    ...row,
    carriers: carriers.join(','),
    carrier_ids: row.carrier_id_list ? String(row.carrier_id_list).split(',').filter(Boolean).map(Number) : [],
  };
}

/** 列表：按字段分项筛选（姓名/手机号/身份证号/驾驶证号/第三方ID/承运商/状态），含所属承运商（逗号连接） */
router.get('/', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const {
    driver_name = '', phone = '', id_card = '', license_no = '',
    external_driver_id = '', carrier_id = '', status = '',
  } = req.query;
  const where = ['d.deleted = 0'];
  const params = [];
  const kw = (v) => `%${String(v).trim()}%`;
  if (driver_name) where.push('d.driver_name LIKE ?'), params.push(kw(driver_name));
  if (phone) where.push('d.phone LIKE ?'), params.push(kw(phone));
  if (id_card) where.push('d.id_card LIKE ?'), params.push(kw(id_card));
  if (license_no) where.push('d.license_no LIKE ?'), params.push(kw(license_no));
  if (external_driver_id) where.push('d.external_driver_id LIKE ?'), params.push(kw(external_driver_id));
  if (carrier_id) {
    where.push('EXISTS (SELECT 1 FROM carrier_driver cd WHERE cd.driver_id = d.id AND cd.carrier_id = ? AND cd.deleted = 0)');
    params.push(Number(carrier_id));
  }
  if (status !== '' && status !== undefined && status !== null) {
    where.push('d.status = ?');
    params.push(Number(status));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRows = await query(`SELECT COUNT(*) AS n FROM driver d ${whereSql}`, params);
  const rows = await query(
    `SELECT d.*,
            GROUP_CONCAT(c.carrier_name ORDER BY c.id SEPARATOR ',') AS carriers,
            GROUP_CONCAT(c.id ORDER BY c.id SEPARATOR ',') AS carrier_id_list
     FROM driver d
     LEFT JOIN carrier_driver cd ON cd.driver_id = d.id AND cd.deleted = 0
     LEFT JOIN carrier c ON c.id = cd.carrier_id AND c.deleted = 0
     ${whereSql}
     GROUP BY d.id
     ORDER BY d.create_time DESC, d.id DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(rows.map(decorateDriver), Number(totalRows[0].n), page, size));
}));

/** 可选司机下拉（狮桥接单模拟用）：该承运商关联且启用的司机 */
router.get('/options', wrap(async (req, res) => {
  const { carrier_id = '' } = req.query;
  let list;
  if (carrier_id) {
    list = await query(
      `SELECT d.id, d.driver_name AS name, d.phone, d.license_type, d.external_driver_id
       FROM driver d
       JOIN carrier_driver cd ON cd.driver_id = d.id AND cd.deleted = 0
       WHERE cd.carrier_id = ? AND d.deleted = 0 AND d.status = 1
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
  // 第三方司机ID：外部系统主键，选填，全局唯一（接单/回传可用其定位）
  const external_driver_id = body.external_driver_id?.toString().trim() || null;
  if (external_driver_id && external_driver_id.length > 64) throw errParam('第三方司机ID不能超过 64 字');
  const carrier_ids = Array.isArray(body.carrier_ids)
    ? [...new Set(body.carrier_ids.map(Number).filter(Number.isInteger))]
    : undefined; // undefined=不维护关联；[]=清空
  return { phone, id_card, license_no, license_type, license_valid_from: body.license_valid_from, license_valid_to: body.license_valid_to, remark, carrier_ids, external_driver_id };
}

/** 第三方司机ID去重（A0002） */
async function assertExternalDriverIdUnique(externalDriverId, excludeId) {
  if (!externalDriverId) return;
  const dup = await query(
    `SELECT id FROM driver WHERE external_driver_id = ? AND deleted = 0${excludeId ? ' AND id != ?' : ''}`,
    excludeId ? [externalDriverId, excludeId] : [externalDriverId]
  );
  if (dup.length) throw errBiz(`第三方司机ID ${externalDriverId} 已被其他司机使用`);
}

/** 维护司机-承运商关联：全量替换 carrier_driver（软删 + 复活） */
async function replaceCarrierDrivers(conn, driverId, carrierIds, operator) {
  await conn.query('UPDATE carrier_driver SET deleted = 1, update_name = ? WHERE driver_id = ? AND deleted = 0', [operator, driverId]);
  for (const cid of carrierIds) {
    const [[c]] = await conn.query('SELECT id, carrier_name FROM carrier WHERE id = ? AND deleted = 0', [cid]);
    if (!c) throw errNotFound(`承运商不存在（ID: ${cid}）`);
    await conn.query(
      `INSERT INTO carrier_driver (carrier_id, driver_id, create_name, update_name)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE deleted = 0, update_name = VALUES(update_name)`,
      [cid, driverId, operator, operator]
    );
  }
}

/** 新增司机：source=1 自建；身份证去重(A0002)；carrier_ids 建立多对多关联 */
router.post('/', wrap(async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!name) throw errParam('司机姓名必填');
  if (name.length > 64) throw errParam('司机姓名不能超过 64 字');
  const v = normalizeDriverBody(req.body);

  const dup = await query('SELECT id FROM driver WHERE id_card = ? AND deleted = 0', [v.id_card]);
  if (dup.length) throw errBiz('该身份证号已存在，请勿重复添加');
  await assertExternalDriverIdUnique(v.external_driver_id);

  const driverId = await withTransaction(async (conn) => {
    const [r] = await conn.query(
      `INSERT INTO driver (driver_name, external_driver_id, phone, id_card, license_no, license_type, license_valid_from, license_valid_to, source, status, remark, create_name, update_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, '系统管理员', '系统管理员')`,
      [name, v.external_driver_id, v.phone, v.id_card, v.license_no, v.license_type, v.license_valid_from, v.license_valid_to, v.remark]
    );
    if (v.carrier_ids) await replaceCarrierDrivers(conn, r.insertId, v.carrier_ids, '系统管理员');
    return r.insertId;
  });

  const [created] = await query(
    `SELECT d.*, GROUP_CONCAT(c.carrier_name ORDER BY c.id SEPARATOR ',') AS carriers,
            GROUP_CONCAT(c.id ORDER BY c.id SEPARATOR ',') AS carrier_id_list
     FROM driver d
     LEFT JOIN carrier_driver cd ON cd.driver_id = d.id AND cd.deleted = 0
     LEFT JOIN carrier c ON c.id = cd.carrier_id AND c.deleted = 0
     WHERE d.id = ? GROUP BY d.id`,
    [driverId]
  );
  ok(res, created ? decorateDriver(created) : null);
}));

/** 编辑：姓名与身份证号不可修改(A0002)；carrier_ids 全量替换关联 */
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
  await assertExternalDriverIdUnique(v.external_driver_id, id);
  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE driver SET external_driver_id = ?, phone = ?, license_no = ?, license_type = ?, license_valid_from = ?, license_valid_to = ?, remark = ?, update_name = '系统管理员' WHERE id = ?`,
      [v.external_driver_id, v.phone, v.license_no, v.license_type, v.license_valid_from, v.license_valid_to, v.remark, id]
    );
    if (v.carrier_ids) await replaceCarrierDrivers(conn, id, v.carrier_ids, '系统管理员');
  });

  const [updated] = await query(
    `SELECT d.*, GROUP_CONCAT(c.carrier_name ORDER BY c.id SEPARATOR ',') AS carriers,
            GROUP_CONCAT(c.id ORDER BY c.id SEPARATOR ',') AS carrier_id_list
     FROM driver d
     LEFT JOIN carrier_driver cd ON cd.driver_id = d.id AND cd.deleted = 0
     LEFT JOIN carrier c ON c.id = cd.carrier_id AND c.deleted = 0
     WHERE d.id = ? GROUP BY d.id`,
    [id]
  );
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

  await query('UPDATE driver SET status = ?, update_name = ? WHERE id = ?', [Number(status), '系统管理员', id]);
  const [updated] = await query('SELECT * FROM driver WHERE id = ?', [id]);
  ok(res, updated);
}));

module.exports = router;
