/**
 * 账号管理（仅平台管理员）
 * 前缀 /api/portal/accounts
 * 账号只负责登录身份，功能权限和数据权限在角色上配置。
 */
const { Router } = require('express');
const { query } = require('../db');
const { wrap, ok, pageOf, pageData, errParam, errBiz, errNotFound } = require('../helpers');
const { requireAuth, hashPassword, normalizePhone } = require('../services/security');
const { accountTypeOf, loadAccess } = require('../services/access');

const router = Router();
router.use(requireAuth(['ADMIN']));

async function assertAccountPerm(req, code) {
  const access = await loadAccess(req.auth.sub);
  if (!access.permissions.includes(code)) throw errBiz('当前角色没有该操作权限');
}

function cleanUsername(value) {
  const name = String(value ?? '').trim();
  if (!name) return null;
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5]{2,32}$/.test(name)) {
    throw errParam('登录账号为 2-32 位字母、数字或中文');
  }
  return name;
}

async function loadRole(roleId) {
  const rows = await query('SELECT * FROM sys_role WHERE id = ? AND deleted = 0', [Number(roleId)]);
  if (!rows.length) throw errNotFound('角色不存在');
  if (Number(rows[0].status) !== 1) throw errBiz('该角色已停用');
  return rows[0];
}

async function assertRefs(role, carrierId, driverId) {
  if (role.role_kind === 'CARRIER') {
    if (!carrierId) throw errParam('承运商账号必须选择所属承运商');
    const rows = await query('SELECT id FROM carrier WHERE id = ? AND deleted = 0', [carrierId]);
    if (!rows.length) throw errNotFound('承运商不存在');
    return { carrierId: rows[0].id, driverId: null };
  }
  if (role.role_kind === 'DRIVER') {
    if (!driverId) throw errParam('司机账号必须选择对应司机');
    const rows = await query('SELECT id, status FROM driver WHERE id = ? AND deleted = 0', [driverId]);
    if (!rows.length) throw errNotFound('司机不存在');
    if (Number(rows[0].status) !== 1) throw errBiz('该司机已停用，不能开通登录');
    return { carrierId: null, driverId: rows[0].id };
  }
  return { carrierId: null, driverId: null };
}

router.get('/', wrap(async (req, res) => {
  await assertAccountPerm(req, 'accounts:view');
  const { page, size, offset } = pageOf(req.query);
  const where = ['a.deleted = 0'];
  const params = [];
  const keyword = String(req.query.keyword ?? '').trim();
  if (keyword) {
    where.push('(a.username LIKE ? OR a.phone LIKE ? OR a.display_name LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.join(' AND ');
  const totalRows = await query(`SELECT COUNT(*) AS n FROM sys_account a WHERE ${whereSql}`, params);
  const list = await query(
    `SELECT a.id, a.username, a.account_type, a.phone, a.display_name, a.carrier_id, a.driver_id,
            a.role_id, a.role, a.status, a.last_login_time,
            r.role_name, r.role_kind, c.carrier_name, d.driver_name
     FROM sys_account a
     LEFT JOIN sys_role r ON r.id = a.role_id
     LEFT JOIN carrier c ON c.id = a.carrier_id
     LEFT JOIN driver d ON d.id = a.driver_id
     WHERE ${whereSql}
     ORDER BY a.id DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(list, Number(totalRows[0].n), page, size));
}));

router.post('/', wrap(async (req, res) => {
  await assertAccountPerm(req, 'accounts:create');
  const role = await loadRole(req.body.role_id);
  const accountType = accountTypeOf(role);
  const displayName = String(req.body.display_name ?? '').trim();
  if (!displayName) throw errParam('请填写姓名');
  const phone = normalizePhone(req.body.phone);
  const password = String(req.body.password ?? '');
  if (password.length < 6) throw errParam('密码至少 6 位');
  const username = cleanUsername(req.body.username);
  const refs = await assertRefs(role, req.body.carrier_id, req.body.driver_id);

  if (username) {
    const dup = await query('SELECT id FROM sys_account WHERE username = ? AND deleted = 0', [username]);
    if (dup.length) throw errBiz('登录账号已存在');
  }
  const phoneDup = await query(
    'SELECT id FROM sys_account WHERE account_type = ? AND phone = ? AND deleted = 0',
    [accountType, phone]
  );
  if (phoneDup.length) throw errBiz('该类型下手机号已存在');
  if (role.role_kind === 'DRIVER') {
    const bound = await query(
      'SELECT id FROM sys_account WHERE account_type = ? AND driver_id = ? AND deleted = 0',
      ['DRIVER', refs.driverId]
    );
    if (bound.length) throw errBiz('该司机已有登录账号');
  }

  const result = await query(
    `INSERT INTO sys_account
      (account_type, username, phone, password_hash, display_name, carrier_id, driver_id, role, role_id, status, create_name, update_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      accountType, username, phone, hashPassword(password), displayName,
      refs.carrierId, refs.driverId, role.role_code, role.id,
      req.auth.name || '平台管理员', req.auth.name || '平台管理员',
    ]
  );
  ok(res, { id: result.insertId }, '账号已创建');
}));

router.put('/:id', wrap(async (req, res) => {
  await assertAccountPerm(req, 'accounts:edit');
  const id = Number(req.params.id);
  const rows = await query('SELECT * FROM sys_account WHERE id = ? AND deleted = 0', [id]);
  if (!rows.length) throw errNotFound('账号不存在');
  const current = rows[0];
  const role = await loadRole(req.body.role_id ?? current.role_id);
  const accountType = accountTypeOf(role);
  const displayName = String(req.body.display_name ?? current.display_name).trim();
  if (!displayName) throw errParam('请填写姓名');
  const phone = normalizePhone(req.body.phone ?? current.phone);
  const username = req.body.username === undefined ? current.username : cleanUsername(req.body.username);
  const status = req.body.status === undefined ? Number(current.status) : (Number(req.body.status) === 1 ? 1 : 0);
  const refs = await assertRefs(role, req.body.carrier_id ?? current.carrier_id, req.body.driver_id ?? current.driver_id);

  if (Number(req.auth.sub) === id && (role.role_kind !== 'PLATFORM' || status !== 1)) {
    throw errBiz('不能取消自己的管理员权限');
  }
  if (username) {
    const dup = await query('SELECT id FROM sys_account WHERE username = ? AND deleted = 0 AND id <> ?', [username, id]);
    if (dup.length) throw errBiz('登录账号已存在');
  }
  const phoneDup = await query(
    'SELECT id FROM sys_account WHERE account_type = ? AND phone = ? AND deleted = 0 AND id <> ?',
    [accountType, phone, id]
  );
  if (phoneDup.length) throw errBiz('该类型下手机号已存在');
  if (role.role_kind === 'DRIVER') {
    const bound = await query(
      'SELECT id FROM sys_account WHERE account_type = ? AND driver_id = ? AND deleted = 0 AND id <> ?',
      ['DRIVER', refs.driverId, id]
    );
    if (bound.length) throw errBiz('该司机已有登录账号');
  }

  const password = String(req.body.password ?? '');
  if (password && password.length < 6) throw errParam('密码至少 6 位');
  const values = [
    accountType, username, phone, displayName, refs.carrierId, refs.driverId, role.role_code, role.id, status,
    req.auth.name || '平台管理员',
  ];
  let passwordSql = '';
  if (password) {
    passwordSql = ', password_hash = ?';
    values.push(hashPassword(password));
  }
  values.push(id);
  await query(
    `UPDATE sys_account
     SET account_type = ?, username = ?, phone = ?, display_name = ?, carrier_id = ?, driver_id = ?,
         role = ?, role_id = ?, status = ?, update_name = ?${passwordSql}
     WHERE id = ?`,
    values
  );
  ok(res, { id }, '账号已更新');
}));

module.exports = router;
