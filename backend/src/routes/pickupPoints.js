const { Router } = require('express');
const { query, withTransaction } = require('../db');
const {
  wrap, ok, errParam, errBiz, errNotFound, pageOf, pageData, queryOf, assertPhone,
} = require('../helpers');
const { regionOptions, resolveRegion } = require('../services/regions');

const router = Router();

const PICKUP_QUERY_ALIASES = {
  factoryId: 'factory_id',
  pickupCode: 'pickup_code',
  pickupName: 'pickup_name',
  provinceCode: 'province_code',
  contactPerson: 'contact_person',
};

function pickupWhere(q) {
  const {
    factory_id = '', pickup_code = '', pickup_name = '', province_code = '',
    contact_person = '', enabled = '',
  } = q;
  const where = ['p.deleted = 0', 'f.deleted = 0'];
  const params = [];
  const like = (value) => `%${String(value).trim()}%`;
  if (factory_id) where.push('p.factory_id = ?'), params.push(Number(factory_id));
  if (pickup_code) where.push('p.pickup_code LIKE ?'), params.push(like(pickup_code));
  if (pickup_name) where.push('p.pickup_name LIKE ?'), params.push(like(pickup_name));
  if (province_code) where.push('p.province_code = ?'), params.push(String(province_code).trim());
  if (contact_person) where.push('p.contact_person LIKE ?'), params.push(like(contact_person));
  if (enabled !== '') {
    if (!['0', '1', 0, 1].includes(enabled)) throw errParam('启用状态筛选值无效');
    where.push('p.enabled = ?'), params.push(Number(enabled));
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

router.get('/', wrap(async (req, res) => {
  const q = queryOf(req, PICKUP_QUERY_ALIASES);
  const { page, size, offset } = pageOf(q);
  const { whereSql, params } = pickupWhere(q);
  const totalRows = await query(
    `SELECT COUNT(*) AS n FROM factory_pickup_point p
     JOIN factory f ON f.id = p.factory_id ${whereSql}`,
    params
  );
  const list = await query(
    `SELECT p.*, f.factory_code, f.factory_name, f.company_code, f.company_name
     FROM factory_pickup_point p
     JOIN factory f ON f.id = p.factory_id
     ${whereSql}
     ORDER BY p.create_time DESC, p.id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(list, Number(totalRows[0].n), page, size));
}));

router.get('/regions', wrap(async (_req, res) => {
  ok(res, regionOptions);
}));

router.get('/factory-options', wrap(async (_req, res) => {
  const list = await query(
    `SELECT id, factory_code, factory_name, company_name
     FROM factory WHERE deleted = 0 ORDER BY factory_name ASC, id ASC`
  );
  ok(res, list);
}));

function requiredText(value, label, maxLength) {
  const textValue = String(value ?? '').trim();
  if (!textValue) throw errParam(`${label}必填`);
  if (textValue.length > maxLength) throw errParam(`${label}不能超过 ${maxLength} 字`);
  return textValue;
}

function normalizeRegion(body) {
  const provinceCode = requiredText(body.province_code ?? body.provinceCode, '省份代码', 6);
  const cityCode = requiredText(body.city_code ?? body.cityCode, '城市代码', 6);
  const districtCode = requiredText(body.district_code ?? body.districtCode, '区县代码', 6);
  if (!/^\d{6}$/.test(provinceCode) || !/^\d{6}$/.test(cityCode) || !/^\d{6}$/.test(districtCode)) {
    throw errParam('省市区代码必须为 6 位数字');
  }
  const region = resolveRegion(provinceCode, cityCode, districtCode);
  if (!region) throw errParam('省市区代码无效或层级关系不匹配');
  return region;
}

function booleanFlag(value, label, defaultValue = 0) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 1 || value === '1' || value === 'true') return 1;
  if (value === false || value === 0 || value === '0' || value === 'false') return 0;
  throw errParam(`${label}必须为布尔值`);
}

function normalizePickupPointBody(body) {
  const factoryId = Number(body.factory_id ?? body.factoryId);
  if (!Number.isInteger(factoryId) || factoryId <= 0) throw errParam('所属工厂必选');
  const isDefault = booleanFlag(body.is_default ?? body.isDefault, '默认标识');
  const remark = String(body.remark ?? '').trim();
  if (remark.length > 512) throw errParam('备注不能超过 512 字');
  return {
    factory_id: factoryId,
    pickup_code: requiredText(body.pickup_code ?? body.pickupCode, '提车点编码', 32),
    pickup_name: requiredText(body.pickup_name ?? body.pickupName, '提车点名称/仓库', 128),
    ...normalizeRegion(body),
    detail_address: requiredText(body.detail_address ?? body.detailAddress, '详细地址', 255),
    contact_person: requiredText(body.contact_person ?? body.contactPerson, '提车联系人', 64),
    contact_phone: assertPhone(body.contact_phone ?? body.contactPhone, { label: '提车联系人电话' }),
    is_default: isDefault,
    remark: remark || null,
  };
}

async function queryRows(conn, sql, params = []) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

async function assertFactoryExists(factoryId, conn) {
  const [factory] = await queryRows(conn, 'SELECT id FROM factory WHERE id = ? AND deleted = 0', [factoryId]);
  if (!factory) throw errNotFound('工厂不存在');
}

async function assertPickupCodeUnique(pickupCode, excludeId, conn) {
  const duplicate = await queryRows(
    conn,
    `SELECT id FROM factory_pickup_point WHERE pickup_code = ? AND deleted = 0${excludeId ? ' AND id != ?' : ''}`,
    excludeId ? [pickupCode, excludeId] : [pickupCode]
  );
  if (duplicate.length) throw errBiz(`提车点编码 ${pickupCode} 已存在`);
}

async function clearOtherDefaultPickupPoints(conn, factoryId, excludeId = 0) {
  await conn.query(
    `UPDATE factory_pickup_point SET is_default = 0, update_name = '系统管理员'
     WHERE factory_id = ? AND id != ? AND deleted = 0`,
    [factoryId, excludeId]
  );
}

router.post('/', wrap(async (req, res) => {
  const created = await withTransaction(async (conn) => {
    const value = normalizePickupPointBody(req.body);
    await assertFactoryExists(value.factory_id, conn);
    await assertPickupCodeUnique(value.pickup_code, null, conn);
    if (value.is_default) await clearOtherDefaultPickupPoints(conn, value.factory_id);
    const inserted = await queryRows(
      conn,
      `INSERT INTO factory_pickup_point (
        factory_id, pickup_code, pickup_name,
        province_code, province_name, city_code, city_name, district_code, district_name,
        detail_address, contact_person, contact_phone, is_default, enabled, remark,
        create_name, update_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, '系统管理员', '系统管理员')`,
      [
        value.factory_id, value.pickup_code, value.pickup_name,
        value.province_code, value.province_name, value.city_code, value.city_name,
        value.district_code, value.district_name, value.detail_address,
        value.contact_person, value.contact_phone, value.is_default, value.remark,
      ]
    );
    const [row] = await queryRows(conn, 'SELECT * FROM factory_pickup_point WHERE id = ?', [inserted.insertId]);
    return row;
  });
  ok(res, created, '新增提车点成功');
}));

router.put('/:id/status', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const enabled = Number(req.body.enabled);
  if (!Number.isInteger(enabled) || ![0, 1].includes(enabled)) {
    throw errParam('状态值仅支持 1（启用）或 0（停用）');
  }
  const result = await withTransaction(async (conn) => {
    const [existing] = await queryRows(
      conn,
      'SELECT id, is_default FROM factory_pickup_point WHERE id = ? AND deleted = 0',
      [id]
    );
    if (!existing) throw errNotFound('提车点不存在');
    const clearDefault = enabled === 0 && existing.is_default === 1;
    await conn.query(
      `UPDATE factory_pickup_point SET enabled = ?, is_default = ?, update_name = '系统管理员'
       WHERE id = ?`,
      [enabled, clearDefault ? 0 : existing.is_default, id]
    );
    const [row] = await queryRows(conn, 'SELECT * FROM factory_pickup_point WHERE id = ?', [id]);
    return { row, clearDefault };
  });
  const resultMessage = enabled === 0
    ? (result.clearDefault ? '提车点已停用，并取消默认标识' : '提车点已停用')
    : '提车点已启用';
  ok(res, result.row, resultMessage);
}));

router.put('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const updated = await withTransaction(async (conn) => {
    const [existing] = await queryRows(
      conn,
      'SELECT id, enabled FROM factory_pickup_point WHERE id = ? AND deleted = 0',
      [id]
    );
    if (!existing) throw errNotFound('提车点不存在');
    const value = normalizePickupPointBody(req.body);
    await assertFactoryExists(value.factory_id, conn);
    await assertPickupCodeUnique(value.pickup_code, id, conn);
    if (value.is_default && !existing.enabled) throw errBiz('请先启用该提车点，再设为默认提车点');
    if (value.is_default) await clearOtherDefaultPickupPoints(conn, value.factory_id, id);
    await conn.query(
      `UPDATE factory_pickup_point SET
        factory_id = ?, pickup_code = ?, pickup_name = ?,
        province_code = ?, province_name = ?, city_code = ?, city_name = ?,
        district_code = ?, district_name = ?, detail_address = ?,
        contact_person = ?, contact_phone = ?, is_default = ?, remark = ?,
        update_name = '系统管理员'
       WHERE id = ?`,
      [
        value.factory_id, value.pickup_code, value.pickup_name,
        value.province_code, value.province_name, value.city_code, value.city_name,
        value.district_code, value.district_name, value.detail_address,
        value.contact_person, value.contact_phone, value.is_default, value.remark,
        id,
      ]
    );
    const [row] = await queryRows(conn, 'SELECT * FROM factory_pickup_point WHERE id = ?', [id]);
    return row;
  });
  ok(res, updated, '提车点信息已保存');
}));

module.exports = router;
