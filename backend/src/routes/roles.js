/**
 * 角色管理（仅平台管理员，且需角色权限）
 * 前缀 /api/portal/roles
 */
const { Router } = require('express');
const { query } = require('../db');
const { wrap, ok, pageOf, pageData, errParam, errBiz, errNotFound } = require('../helpers');
const { requireAuth } = require('../services/security');
const { MODULES, MATERIALS, ALL_CODES, accountTypeOf, loadAccess } = require('../services/access');

const router = Router();
router.use(requireAuth(['ADMIN']));

async function assertPerm(req, code) {
  const access = await loadAccess(req.auth.sub);
  if (!access.permissions.includes(code)) throw errBiz('当前角色没有该操作权限');
  return access;
}

router.get('/catalog', wrap(async (req, res) => {
  await assertPerm(req, 'roles:view');
  const carriers = await query(
    'SELECT id, carrier_name FROM carrier WHERE deleted = 0 AND status = 1 ORDER BY id'
  );
  ok(res, { modules: MODULES, materials: MATERIALS, carriers });
}));

router.get('/', wrap(async (req, res) => {
  await assertPerm(req, 'roles:view');
  const { page, size, offset } = pageOf(req.query);
  const where = ['deleted = 0'];
  const params = [];
  const like = (col, value) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    where.push(`${col} LIKE ?`);
    params.push(`%${v}%`);
  };
  like('role_name', req.query.role_name);
  like('role_code', req.query.role_code);
  if (req.query.role_kind) {
    where.push('role_kind = ?');
    params.push(String(req.query.role_kind));
  }
  if (req.query.status !== '' && req.query.status !== undefined && req.query.status !== null) {
    where.push('status = ?');
    params.push(Number(req.query.status));
  }
  const keyword = String(req.query.keyword ?? '').trim();
  if (keyword) {
    where.push('(role_name LIKE ? OR role_code LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.join(' AND ');
  const totalRows = await query(`SELECT COUNT(*) AS n FROM sys_role WHERE ${whereSql}`, params);
  const list = await query(
    `SELECT id, role_code, role_name, role_kind, remark, status, builtin, update_time
     FROM sys_role WHERE ${whereSql} ORDER BY builtin DESC, id ASC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(list, Number(totalRows[0].n), page, size));
}));

router.get('/:id', wrap(async (req, res) => {
  await assertPerm(req, 'roles:view');
  const id = Number(req.params.id);
  const rows = await query('SELECT * FROM sys_role WHERE id = ? AND deleted = 0', [id]);
  if (!rows.length) throw errNotFound('角色不存在');
  const perms = await query('SELECT perm_code FROM sys_role_perm WHERE role_id = ?', [id]);
  const data = await query('SELECT data_type, data_value FROM sys_role_data WHERE role_id = ?', [id]);
  ok(res, {
    ...rows[0],
    permissions: perms.map((row) => row.perm_code),
    carrier_ids: data.filter((row) => row.data_type === 'CARRIER' && row.data_value !== '*').map((row) => Number(row.data_value)),
    carrier_all: data.some((row) => row.data_type === 'CARRIER' && row.data_value === '*'),
    materials: data.filter((row) => row.data_type === 'MATERIAL').map((row) => row.data_value),
  });
}));

const KIND_PREFIX = { SUPER: 'PLATFORM', PLATFORM: 'PLATFORM', CARRIER: 'CARRIER', DRIVER: 'DRIVER' };

/** 角色编码按端前缀 + 三位流水生成：PLATFORM001 / CARRIER001 / DRIVER001 */
async function nextRoleCode(kind) {
  const prefix = KIND_PREFIX[kind] || 'PLATFORM';
  const rows = await query('SELECT role_code FROM sys_role WHERE role_code LIKE ?', [`${prefix}%`]);
  let max = 0;
  for (const row of rows) {
    const matched = /^([A-Z]+)(\d{3})$/.exec(String(row.role_code));
    if (matched && matched[1] === prefix) max = Math.max(max, Number(matched[2]));
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

function readRoleBody(body, current) {
  const roleName = String(body.role_name ?? current?.role_name ?? '').trim();
  if (!roleName) throw errParam('请填写角色名称');
  const roleKind = String(body.role_kind ?? current?.role_kind ?? '');
  if (!['SUPER', 'PLATFORM', 'CARRIER', 'DRIVER'].includes(roleKind)) throw errParam('请选择角色类型');
  const remark = String(body.remark ?? current?.remark ?? '').trim() || null;
  const status = body.status === undefined ? Number(current?.status ?? 1) : (Number(body.status) === 1 ? 1 : 0);
  return { roleName, roleKind, remark, status };
}

router.post('/', wrap(async (req, res) => {
  await assertPerm(req, 'roles:create');
  const role = readRoleBody(req.body);
  const roleCode = await nextRoleCode(role.roleKind);
  const ins = await query(
    `INSERT INTO sys_role (role_code, role_name, role_kind, remark, status, builtin)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [roleCode, role.roleName, role.roleKind, role.remark, role.status]
  );
  ok(res, { id: ins.insertId, role_code: roleCode }, '角色已创建');
}));

router.put('/:id', wrap(async (req, res) => {
  await assertPerm(req, 'roles:edit');
  const id = Number(req.params.id);
  const rows = await query('SELECT * FROM sys_role WHERE id = ? AND deleted = 0', [id]);
  if (!rows.length) throw errNotFound('角色不存在');
  const current = rows[0];
  const role = readRoleBody(req.body, current);
  if (Number(current.builtin) === 1 && role.roleKind !== current.role_kind) {
    throw errBiz('内置角色不能改类型');
  }
  await query(
    'UPDATE sys_role SET role_name = ?, role_kind = ?, remark = ?, status = ? WHERE id = ?',
    [role.roleName, role.roleKind, role.remark, role.status, id]
  );
  const accountType = accountTypeOf({ role_kind: role.roleKind, role_code: current.role_code });
  await query('UPDATE sys_account SET account_type = ? WHERE role_id = ? AND deleted = 0', [accountType, id]);
  ok(res, { id }, '角色已更新');
}));

router.put('/:id/permissions', wrap(async (req, res) => {
  await assertPerm(req, 'roles:perm');
  const id = Number(req.params.id);
  const rows = await query('SELECT * FROM sys_role WHERE id = ? AND deleted = 0', [id]);
  if (!rows.length) throw errNotFound('角色不存在');
  const role = rows[0];
  const permissions = [...new Set((req.body.permissions || []).map((code) => String(code)))].filter((code) => ALL_CODES.includes(code));
  const carrierAll = Boolean(req.body.carrier_all);
  const carrierIds = [...new Set((req.body.carrier_ids || []).map((value) => Number(value)).filter((value) => value > 0))];
  const materials = [...new Set((req.body.materials || []).map((value) => String(value)))].filter((value) => value === 'FINISHED' || value === 'LOOSE');
  const scopeAll = role.role_kind === 'SUPER' || role.role_kind === 'PLATFORM';
  if (!carrierAll && scopeAll && !carrierIds.length) {
    throw errParam('请选择承运商，或勾选全部承运商');
  }
  if (!materials.length) throw errParam('请至少选择一种物料类型');

  await query('DELETE FROM sys_role_perm WHERE role_id = ?', [id]);
  for (const code of permissions) {
    await query('INSERT INTO sys_role_perm (role_id, perm_code) VALUES (?, ?)', [id, code]);
  }
  await query('DELETE FROM sys_role_data WHERE role_id = ?', [id]);
  if (carrierAll || !scopeAll) {
    await query('INSERT INTO sys_role_data (role_id, data_type, data_value) VALUES (?, \'CARRIER\', \'*\')', [id]);
  } else {
    for (const carrierId of carrierIds) {
      await query('INSERT INTO sys_role_data (role_id, data_type, data_value) VALUES (?, \'CARRIER\', ?)', [id, String(carrierId)]);
    }
  }
  for (const material of materials) {
    await query('INSERT INTO sys_role_data (role_id, data_type, data_value) VALUES (?, \'MATERIAL\', ?)', [id, material]);
  }
  ok(res, { id }, '权限已保存');
}));

module.exports = router;
