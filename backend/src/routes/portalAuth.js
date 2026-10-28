/**
 * 门户认证：承运商员工密码登录 / 司机短信验证码登录
 * 前缀 /api/portal/auth
 */
const { Router } = require('express');
const crypto = require('node:crypto');
const { query, withTransaction } = require('../db');
const { wrap, ok, errParam, errBiz, errAuth, errNotFound, localDateStr } = require('../helpers');
const { signToken, verifyPassword, normalizePhone, requireAuth } = require('../services/security');
const { loadAccess } = require('../services/access');
const { sendLoginCode } = require('../services/notify');
const { ensureDriverAccount } = require('../services/driverAccount');

const router = Router();

/** 在途/进行中任务：已派单到已到达，排除待派单与终态 */
const ACTIVE_TASK_STATUSES = ['DISPATCHED', 'CARRIER_ACCEPTED', 'PICKED', 'OUTBOUND', 'IN_TRANSIT', 'ARRIVED'];
const TICKET_TTL_SECONDS = 300;

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
    data_scope: account.data_scope ?? { carriers: [] },
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
    data_scope: { carriers: access.carriers },
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
 * 按手机号取全部司机档案：一个手机号可能在多家承运商各有独立档案。
 * active_task_count 为该档案名下进行中任务数，用于多档案时自动定位承运商。
 */
async function driverProfiles(phone) {
  const rows = await query(
    `SELECT d.id AS driver_id, d.driver_name, d.phone, d.status, d.carrier_id, c.carrier_name
     FROM driver d
     LEFT JOIN carrier c ON c.id = d.carrier_id
     WHERE d.phone = ? AND d.deleted = 0
     ORDER BY d.id`,
    [phone]
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => Number(r.driver_id));
  const counts = await query(
    `SELECT driver_id, COUNT(*) AS n FROM shipping_task
     WHERE deleted = 0
       AND driver_id IN (${ids.map(() => '?').join(',')})
       AND status IN (${ACTIVE_TASK_STATUSES.map(() => '?').join(',')})
     GROUP BY driver_id`,
    [...ids, ...ACTIVE_TASK_STATUSES]
  );
  const activeMap = new Map(counts.map((c) => [Number(c.driver_id), Number(c.n)]));
  return rows.map((r) => ({
    driver_id: Number(r.driver_id),
    driver_name: r.driver_name,
    phone: r.phone,
    status: Number(r.status),
    carrier_id: r.carrier_id === null ? null : Number(r.carrier_id),
    carrier_name: r.carrier_name || '',
    active_task_count: activeMap.get(Number(r.driver_id)) || 0,
  }));
}

/** 多承运商时的一次性选择凭证：5 分钟有效、绑定手机号、用后作废 */
async function createLoginTicket(phone) {
  const ticket = crypto.randomBytes(24).toString('hex');
  await query(
    'INSERT INTO login_ticket (ticket, phone, expire_time) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
    [ticket, phone, TICKET_TTL_SECONDS]
  );
  return ticket;
}

async function consumeLoginTicket(ticket) {
  const rows = await query(
    'SELECT * FROM login_ticket WHERE ticket = ? AND used = 0 AND expire_time > NOW() LIMIT 1',
    [ticket]
  );
  if (!rows.length) throw errAuth('选择已过期，请重新获取验证码');
  await query('UPDATE login_ticket SET used = 1 WHERE id = ?', [rows[0].id]);
  return rows[0];
}

/** 司机登录：确保账号存在、签发带承运商上下文的 token */
async function loginDriver(res, driver, extra = {}) {
  const { accountId } = await withTransaction(async (conn) => {
    const result = await ensureDriverAccount(conn, {
      driverId: driver.driver_id,
      driverName: driver.driver_name,
      phone: driver.phone,
      carrierId: driver.carrier_id,
      operator: '司机登录',
    });
    if (result.blocked) throw errBiz('该手机号在本承运商已被其他司机占用，请联系承运商处理');
    return result;
  });
  const [account] = await query('SELECT * FROM sys_account WHERE id = ? AND deleted = 0', [accountId]);
  if (!account) throw errAuth('账号不存在，请联系承运商');
  if (Number(account.status) !== 1) throw errAuth('账号已停用，请联系承运商');

  await query('UPDATE sys_account SET last_login_time = NOW() WHERE id = ?', [account.id]);
  const profile = await loadProfile(account);
  const token = signToken({
    sub: account.id,
    type: 'DRIVER',
    carrierId: driver.carrier_id,
    driverId: driver.driver_id,
    name: driver.driver_name,
    role: 'DRIVER',
  });
  ok(res, { need_choice: false, token, profile, ...extra }, '登录成功');
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

/**
 * 司机档案按承运商隔离后，同一手机号可能在多家承运商各有账号。
 * 指定 carrier_id 时按承运商定位；未指定时取最近登录的账号，其次最早创建。
 */
function pickDriverAccount(accounts, carrierId) {
  if (carrierId) return accounts.find((a) => Number(a.carrier_id) === Number(carrierId)) || null;
  return [...accounts].sort((a, b) => {
    const at = a.last_login_time ? new Date(a.last_login_time).getTime() : 0;
    const bt = b.last_login_time ? new Date(b.last_login_time).getTime() : 0;
    if (at !== bt) return bt - at;
    return a.id - b.id;
  })[0];
}

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
  const account = pickDriverAccount(drivers, req.body.carrier_id);
  if (!account) throw errAuth('该承运商下没有此司机账号');
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
  const drivers = await query('SELECT status FROM driver WHERE phone = ? AND deleted = 0', [phone]);
  if (!drivers.length) throw errNotFound('该手机号未登记为司机，请联系承运商添加');
  // 同手机号可能在多家承运商各有档案，只要有一份启用即可收码
  if (!drivers.some((d) => Number(d.status) === 1)) throw errBiz('该司机已停用，请联系承运商');

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

/**
 * 司机验证码登录，首次登录自动开通账号。
 *
 * 承运商定位规则：
 *   1. 只有一份启用档案 → 直接登录；
 *   2. 多份档案且只有一份有进行中任务 → 自动登录该承运商；
 *   3. 其余情况 → 返回承运商列表和一次性 ticket，由司机选择后再换 token。
 */
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

  const all = await driverProfiles(phone);
  if (!all.length) throw errNotFound('该手机号未登记为司机，请联系承运商添加');
  const enabled = all.filter((d) => d.status === 1);
  if (!enabled.length) throw errBiz('该司机已停用，请联系承运商');

  const carrierId = req.body.carrier_id ? Number(req.body.carrier_id) : null;
  if (carrierId) {
    const target = enabled.find((d) => d.carrier_id === carrierId);
    if (!target) throw errAuth('该承运商下没有可用的司机档案');
    return loginDriver(res, target);
  }

  if (enabled.length === 1) return loginDriver(res, enabled[0]);

  const working = enabled.filter((d) => d.active_task_count > 0);
  if (working.length === 1) return loginDriver(res, working[0], { auto_selected: true });

  const ticket = await createLoginTicket(phone);
  return ok(res, {
    need_choice: true,
    ticket,
    expire_in: TICKET_TTL_SECONDS,
    carriers: enabled.map((d) => ({
      carrier_id: d.carrier_id,
      carrier_name: d.carrier_name,
      driver_id: d.driver_id,
      driver_name: d.driver_name,
      active_task_count: d.active_task_count,
    })),
  }, '该手机号属于多家承运商，请选择要登录的承运商');
}));

/** 多承运商登录：凭 ticket + 选择的承运商换 token */
router.post('/sms-login/confirm', wrap(async (req, res) => {
  const ticket = String(req.body.ticket ?? '').trim();
  const carrierId = Number(req.body.carrier_id);
  if (!ticket) throw errParam('缺少选择凭证');
  if (!carrierId) throw errParam('请选择要登录的承运商');

  const record = await consumeLoginTicket(ticket);
  const enabled = (await driverProfiles(record.phone)).filter((d) => d.status === 1);
  const target = enabled.find((d) => d.carrier_id === carrierId);
  if (!target) throw errAuth('该承运商下没有可用的司机档案');
  return loginDriver(res, target);
}));

/** 当前司机可登录的承运商列表（切换承运商用） */
router.get('/my-carriers', requireAuth(), wrap(async (req, res) => {
  if (req.auth.type !== 'DRIVER') throw errBiz('仅司机账号可查询');
  const [account] = await query('SELECT * FROM sys_account WHERE id = ? AND deleted = 0', [req.auth.sub]);
  if (!account) throw errAuth('账号不存在');
  const list = (await driverProfiles(account.phone)).filter((d) => d.status === 1);
  ok(res, list.map((d) => ({
    carrier_id: d.carrier_id,
    carrier_name: d.carrier_name,
    driver_id: d.driver_id,
    driver_name: d.driver_name,
    active_task_count: d.active_task_count,
    current: Number(d.driver_id) === Number(account.driver_id),
  })));
}));

/** 司机切换承运商：校验目标档案归属后重签 token，无需重新收验证码 */
router.post('/switch-carrier', requireAuth(), wrap(async (req, res) => {
  if (req.auth.type !== 'DRIVER') throw errBiz('仅司机账号可切换承运商');
  const carrierId = Number(req.body.carrier_id);
  if (!carrierId) throw errParam('请选择承运商');
  const [account] = await query('SELECT * FROM sys_account WHERE id = ? AND deleted = 0', [req.auth.sub]);
  if (!account) throw errAuth('账号不存在');
  const target = (await driverProfiles(account.phone))
    .find((d) => d.carrier_id === carrierId && d.status === 1);
  if (!target) throw errAuth('该承运商下没有可用的司机档案');
  return loginDriver(res, target);
}));

/** 当前登录账号 */
router.get('/me', requireAuth(), wrap(async (req, res) => {
  const rows = await query('SELECT * FROM sys_account WHERE id = ? AND deleted = 0', [req.auth.sub]);
  if (!rows.length) throw errAuth('账号不存在');
  const profile = await loadProfile(rows[0]);
  const unread = await query(
    `SELECT COUNT(*) AS n FROM notification
     WHERE receiver_type = ? AND receiver_id = ? AND channel = 'INBOX' AND read_status = 0 AND deleted = 0`,
    [profile.type, profile.type === 'CARRIER' ? profile.carrier_id : profile.driver_id]
  );
  ok(res, { ...profile, unread: Number(unread[0].n) });
}));

module.exports = router;
