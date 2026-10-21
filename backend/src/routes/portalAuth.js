/**
 * 门户认证：承运商员工密码登录 / 司机短信验证码登录
 * 前缀 /api/portal/auth
 */
const { Router } = require('express');
const { query } = require('../db');
const { wrap, ok, errParam, errBiz, errAuth, errNotFound, localDateStr } = require('../helpers');
const { signToken, verifyPassword, normalizePhone, requireAuth } = require('../services/security');
const { loadAccess } = require('../services/access');
const { sendLoginCode } = require('../services/notify');

const router = Router();

function accountKind(accountType) {
  if (accountType === 'DRIVER') return 'DRIVER';
  if (accountType === 'ADMIN') return 'ADMIN';
  return 'CARRIER';
}

function profileOf(account, carrierName, driverName) {
  return {
    account_id: account.id,
    type: accountKind(account.account_type),
    account_type: account.account_type,
    username: account.username ?? null,
    name: account.display_name,
    phone: account.phone,
    role: account.role,
    role_id: account.role_id ?? null,
    role_name: account.role_name ?? null,
    permissions: account.permissions ?? [],
    data_scope: account.data_scope ?? { carriers: [], materials: [] },
    carrier_id: account.carrier_id,
    carrier_name: carrierName ?? null,
    driver_id: account.driver_id,
    driver_name: driverName ?? null,
  };
}

async function loadProfile(account) {
  let carrierName = null;
  let driverName = null;
  if (account.carrier_id) {
    const rows = await query('SELECT carrier_name FROM carrier WHERE id = ?', [account.carrier_id]);
    carrierName = rows[0]?.carrier_name ?? null;
  }
  if (account.driver_id) {
    const rows = await query('SELECT driver_name FROM driver WHERE id = ?', [account.driver_id]);
    driverName = rows[0]?.driver_name ?? null;
  }
  const access = await loadAccess(account.id);
  return profileOf({
    ...account,
    role: access.roleCode || account.role,
    role_id: access.roleId,
    role_name: access.roleName,
    permissions: access.permissions,
    data_scope: { carriers: access.carriers, materials: access.materials },
  }, carrierName, driverName);
}

/** 按登录账号或手机号找出未删除账号 */
async function findAccounts(accountName) {
  const name = String(accountName ?? '').trim();
  if (!name) throw errParam('请输入账号');
  const byName = await query(
    'SELECT * FROM sys_account WHERE username = ? AND deleted = 0',
    [name]
  );
  if (byName.length) return byName;
  let phone = name;
  try {
    phone = normalizePhone(name);
  } catch (e) {
    return [];
  }
  return query('SELECT * FROM sys_account WHERE phone = ? AND deleted = 0', [phone]);
}

async function issueLogin(res, account) {
  if (Number(account.status) !== 1) throw errAuth('账号已停用，请联系平台管理员');
  await query('UPDATE sys_account SET last_login_time = NOW() WHERE id = ?', [account.id]);
  const profile = await loadProfile(account);
  const token = signToken({
    sub: account.id,
    type: profile.type,
    carrierId: account.carrier_id,
    driverId: account.driver_id,
    name: account.display_name,
    role: account.role,
  });
  ok(res, { token, profile }, '登录成功');
}

/**
 * 后台登录：平台管理员、承运商管理员、承运商调度。
 * 司机账号在此被拒绝，只能走小程序。
 */
router.post('/login', wrap(async (req, res) => {
  const password = String(req.body.password ?? '');
  if (!password) throw errParam('请输入密码');
  const rows = await findAccounts(req.body.account ?? req.body.username ?? req.body.phone);
  const web = rows.filter((row) => row.account_type !== 'DRIVER');
  if (!web.length) {
    if (rows.some((row) => row.account_type === 'DRIVER')) {
      throw errBiz('司机账号只能登录小程序');
    }
    throw errAuth('账号不存在或密码错误');
  }
  const account = web[0];
  if (!verifyPassword(password, account.password_hash)) throw errAuth('账号不存在或密码错误');
  await issueLogin(res, account);
}));

/** 小程序登录：仅司机，账号 + 密码 */
router.post('/driver-login', wrap(async (req, res) => {
  const password = String(req.body.password ?? '');
  if (!password) throw errParam('请输入密码');
  const rows = await findAccounts(req.body.account ?? req.body.username ?? req.body.phone);
  const drivers = rows.filter((row) => row.account_type === 'DRIVER');
  if (!drivers.length) {
    if (rows.length) throw errBiz('该账号不是司机，请使用后台登录');
    throw errAuth('账号不存在或密码错误');
  }
  const account = drivers[0];
  if (!verifyPassword(password, account.password_hash)) throw errAuth('账号不存在或密码错误');
  await issueLogin(res, account);
}));

/** 承运商员工登录（管理员/调度） */
router.post('/staff-login', wrap(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const password = String(req.body.password ?? '');
  if (!password) throw errParam('密码必填');

  const rows = await query(
    `SELECT * FROM sys_account
     WHERE phone = ? AND account_type IN ('CARRIER_ADMIN','CARRIER_DISPATCHER') AND deleted = 0`,
    [phone]
  );
  if (!rows.length) throw errAuth('账号不存在或密码错误');
  const account = rows[0];
  if (Number(account.status) !== 1) throw errAuth('账号已停用，请联系平台管理员');
  if (!verifyPassword(password, account.password_hash)) throw errAuth('账号不存在或密码错误');

  await query('UPDATE sys_account SET last_login_time = NOW() WHERE id = ?', [account.id]);
  const profile = await loadProfile(account);
  const token = signToken({
    sub: account.id, type: 'CARRIER', carrierId: account.carrier_id,
    driverId: null, name: account.display_name, role: account.role,
  });
  ok(res, { token, profile }, '登录成功');
}));

/** 获取短信验证码（司机） */
router.post('/sms-code', wrap(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const drivers = await query('SELECT * FROM driver WHERE phone = ? AND deleted = 0', [phone]);
  if (!drivers.length) throw errNotFound('该手机号未登记为司机，请联系承运商添加');
  if (Number(drivers[0].status) !== 1) throw errBiz('该司机已停用，请联系承运商');

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await query(
    `INSERT INTO sms_code (phone, code, scene, expire_time, used)
     VALUES (?, ?, 'LOGIN', DATE_ADD(NOW(), INTERVAL 5 MINUTE), 0)`,
    [phone, code]
  );
  await sendLoginCode(phone, code);

  const mock = (process.env.SMS_PROVIDER || 'mock') === 'mock';
  ok(res, mock ? { dev_code: code, mock: true } : { mock: false }, '验证码已发送');
}));

/** 司机验证码登录，首次登录自动开通账号 */
router.post('/sms-login', wrap(async (req, res) => {
  const phone = normalizePhone(req.body.phone);
  const code = String(req.body.code ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw errParam('请输入 6 位验证码');

  const codes = await query(
    `SELECT * FROM sms_code
     WHERE phone = ? AND scene = 'LOGIN' AND used = 0 AND expire_time > NOW()
     ORDER BY id DESC LIMIT 1`,
    [phone]
  );
  if (!codes.length) throw errAuth('验证码已过期，请重新获取');
  if (codes[0].code !== code) throw errAuth('验证码不正确');
  await query('UPDATE sms_code SET used = 1 WHERE id = ?', [codes[0].id]);

  const drivers = await query('SELECT * FROM driver WHERE phone = ? AND deleted = 0', [phone]);
  if (!drivers.length) throw errNotFound('司机不存在');
  const driver = drivers[0];
  if (Number(driver.status) !== 1) throw errBiz('该司机已停用，请联系承运商');

  let accounts = await query(
    `SELECT * FROM sys_account WHERE account_type = 'DRIVER' AND driver_id = ? AND deleted = 0`,
    [driver.id]
  );
  if (!accounts.length) {
    const ins = await query(
      `INSERT INTO sys_account (account_type, phone, password_hash, display_name, driver_id, role, status, create_name, update_name)
       VALUES ('DRIVER', ?, NULL, ?, ?, 'DRIVER', 1, '司机自助开通', '司机自助开通')`,
      [phone, driver.driver_name, driver.id]
    );
    accounts = await query('SELECT * FROM sys_account WHERE id = ?', [ins.insertId]);
  }
  const account = accounts[0];
  if (Number(account.status) !== 1) throw errAuth('账号已停用，请联系承运商');

  await query('UPDATE sys_account SET last_login_time = NOW(), phone = ?, display_name = ? WHERE id = ?',
    [phone, driver.driver_name, account.id]);
  const profile = await loadProfile({ ...account, phone, display_name: driver.driver_name });
  const token = signToken({
    sub: account.id, type: 'DRIVER', carrierId: null,
    driverId: driver.id, name: driver.driver_name, role: 'DRIVER',
  });
  ok(res, { token, profile }, '登录成功');
}));

/** 当前登录账号 */
router.get('/me', requireAuth(), wrap(async (req, res) => {
  const rows = await query('SELECT * FROM sys_account WHERE id = ? AND deleted = 0', [req.auth.sub]);
  if (!rows.length) throw errAuth('账号不存在');
  const profile = await loadProfile(rows[0]);
  const unread = await query(
    `SELECT COUNT(*) AS n FROM notification
     WHERE receiver_type = ? AND receiver_id = ? AND read_status = 0 AND deleted = 0`,
    [profile.type, profile.type === 'CARRIER' ? profile.carrier_id : profile.driver_id]
  );
  ok(res, { ...profile, unread: Number(unread[0].n) });
}));

module.exports = router;
