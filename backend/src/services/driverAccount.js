/**
 * 司机登录账号统一维护
 *
 * 规则：
 *   1. 有司机档案就必须有账号，账号与档案一对一，由系统自动维护，不支持人工新建；
 *   2. 账号以 driver_id 为准定位，不按手机号猜；
 *   3. 手机号在承运商内唯一（uk_type_phone_carrier），同手机号可在不同承运商各有一个账号；
 *   4. 司机改手机号/姓名/承运商时同步账号，停用司机时同步停用账号。
 */
const { errBiz } = require('../helpers');

const DRIVER_ROLE = 'DRIVER';

/** 该承运商内手机号是否已被其他司机账号占用 */
async function phoneTaken(conn, phone, carrierId, excludeId) {
  const [rows] = await conn.query(
    `SELECT id FROM sys_account
     WHERE account_type = 'DRIVER' AND phone = ? AND carrier_scope = ? AND deleted = 0
       ${excludeId ? 'AND id <> ?' : ''}
     LIMIT 1`,
    excludeId ? [phone, carrierId, excludeId] : [phone, carrierId]
  );
  return rows.length > 0;
}

/**
 * 确保司机档案有可用账号，并同步姓名/手机号/承运商
 * @returns {{ accountId: number|null, phoneConflict: boolean, blocked?: boolean }}
 *   phoneConflict 手机号冲突时保留账号原手机号；blocked 表示手机号属于本承运商另一位在用司机，无法建号
 */
async function ensureDriverAccount(conn, { driverId, driverName, phone, carrierId, operator = 'system' }) {
  const name = String(driverName ?? '').trim().slice(0, 64);
  const operatorName = String(operator || 'system').slice(0, 64);

  const [byDriver] = await conn.query(
    "SELECT * FROM sys_account WHERE account_type = 'DRIVER' AND driver_id = ? AND deleted = 0",
    [driverId]
  );

  if (byDriver.length) {
    const account = byDriver[0];
    let finalPhone = phone;
    let phoneConflict = false;
    if (phone && phone !== account.phone) {
      if (await phoneTaken(conn, phone, carrierId, account.id)) {
        phoneConflict = true;
        finalPhone = account.phone;
      }
    }
    await conn.query(
      `UPDATE sys_account SET phone = ?, display_name = ?, carrier_id = ?, role = ?, update_name = ? WHERE id = ?`,
      [finalPhone, name, carrierId, DRIVER_ROLE, operatorName, account.id]
    );
    return { accountId: account.id, phoneConflict };
  }

  // 手机号已被本承运商某个账号占用：原绑司机档案已不存在时改绑（档案重建/迁移），否则视为冲突
  const [byPhone] = await conn.query(
    `SELECT * FROM sys_account
     WHERE account_type = 'DRIVER' AND phone = ? AND carrier_scope = ? AND deleted = 0`,
    [phone, carrierId]
  );
  if (byPhone.length) {
    const heldId = byPhone[0].driver_id ? Number(byPhone[0].driver_id) : null;
    if (heldId && heldId !== Number(driverId)) {
      const [alive] = await conn.query('SELECT id FROM driver WHERE id = ? AND deleted = 0', [heldId]);
      if (alive.length) return { accountId: null, phoneConflict: true, blocked: true };
    }
    await conn.query(
      `UPDATE sys_account SET driver_id = ?, display_name = ?, carrier_id = ?, role = ?, update_name = ? WHERE id = ?`,
      [driverId, name, carrierId, DRIVER_ROLE, operatorName, byPhone[0].id]
    );
    return { accountId: byPhone[0].id, phoneConflict: false, reassigned: true };
  }

  const [r] = await conn.query(
    `INSERT INTO sys_account
      (account_type, phone, password_hash, display_name, carrier_id, driver_id, role, status, create_name, update_name)
     VALUES ('DRIVER', ?, NULL, ?, ?, ?, ?, 1, ?, ?)`,
    [phone, name, carrierId, driverId, DRIVER_ROLE, operatorName, operatorName]
  );
  return { accountId: r.insertId, phoneConflict: false };
}

/** 司机停用/启用时同步账号状态 */
async function syncDriverAccountStatus(conn, driverId, status, operator) {
  await conn.query(
    `UPDATE sys_account SET status = ?, update_name = ?
     WHERE account_type = 'DRIVER' AND driver_id = ? AND deleted = 0`,
    [Number(status) === 1 ? 1 : 0, String(operator || 'system').slice(0, 64), driverId]
  );
}

/** 建号失败的统一提示（承运商端新增/编辑司机时使用） */
function assertAccountReady(result, phone) {
  if (result?.blocked) {
    throw errBiz(`手机号 ${phone} 在本承运商已被其他司机使用，请先处理原司机账号`);
  }
}

module.exports = { ensureDriverAccount, syncDriverAccountStatus, assertAccountReady, DRIVER_ROLE };
