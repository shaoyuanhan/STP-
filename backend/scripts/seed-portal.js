/**
 * 初始化登录账号
 * 运行: node scripts/seed-portal.js
 * 说明: 平台管理员 admin / 123456；承运商与司机密码统一 123456。
 * 司机只能登录小程序，承运商和平台管理员登录后台。
 */
require('../src/db');
const { query } = require('../src/db');
const { hashPassword } = require('../src/services/security');

const DEFAULT_PASSWORD = '123456';

async function upsertStaff(carrierId, phone, displayName, role) {
  const rows = await query(
    `SELECT id FROM sys_account WHERE account_type = ? AND phone = ? AND deleted = 0`,
    [role, phone]
  );
  if (rows.length) {
    await query(
      'UPDATE sys_account SET carrier_id = ?, display_name = ?, password_hash = ?, status = 1, role = ? WHERE id = ?',
      [carrierId, displayName, hashPassword(DEFAULT_PASSWORD), role, rows[0].id]
    );
    return { phone, updated: true };
  }
  await query(
    `INSERT INTO sys_account
      (account_type, phone, password_hash, display_name, carrier_id, driver_id, role, status, create_name, update_name)
     VALUES (?, ?, ?, ?, ?, NULL, ?, 1, '系统初始化', '系统初始化')`,
    [role, phone, hashPassword(DEFAULT_PASSWORD), displayName, carrierId, role]
  );
  return { phone, created: true };
}

async function ensureUsernameColumn() {
  const cols = await query("SHOW COLUMNS FROM sys_account LIKE 'username'");
  if (cols.length) return;
  await query(
    "ALTER TABLE sys_account ADD COLUMN username VARCHAR(64) DEFAULT NULL COMMENT '登录账号' AFTER account_type"
  );
  await query('ALTER TABLE sys_account ADD UNIQUE KEY uk_username (username)');
}

async function upsertAdmin() {
  const phone = '+8613800138000';
  const rows = await query(
    "SELECT id FROM sys_account WHERE account_type = 'ADMIN' AND deleted = 0 LIMIT 1"
  );
  if (rows.length) {
    await query(
      `UPDATE sys_account
       SET username = 'admin', phone = ?, display_name = '系统管理员', password_hash = ?, role = 'ADMIN', status = 1
       WHERE id = ?`,
      [phone, hashPassword(DEFAULT_PASSWORD), rows[0].id]
    );
    return;
  }
  await query(
    `INSERT INTO sys_account
      (account_type, username, phone, password_hash, display_name, carrier_id, driver_id, role, status, create_name, update_name)
     VALUES ('ADMIN', 'admin', ?, ?, '系统管理员', NULL, NULL, 'ADMIN', 1, '系统初始化', '系统初始化')`,
    [phone, hashPassword(DEFAULT_PASSWORD)]
  );
}

async function main() {
  await ensureUsernameColumn();
  await upsertAdmin();
  const carriers = await query('SELECT id, carrier_name, contact_phone FROM carrier WHERE deleted = 0 ORDER BY id');
  const result = { staff: [], drivers: [] };

  let seq = 1;
  for (const c of carriers) {
    const phone = `+86138000000${String(seq).padStart(2, '0')}`;
    const name = `${c.carrier_name.slice(0, 6)}调度`;
    result.staff.push(await upsertStaff(c.id, phone, name, 'CARRIER_ADMIN'));
    seq += 1;
  }

  const drivers = await query('SELECT id, driver_name, phone FROM driver WHERE deleted = 0 ORDER BY id');
  for (const d of drivers) {
    const rows = await query(
      `SELECT id FROM sys_account WHERE account_type = 'DRIVER' AND driver_id = ? AND deleted = 0`,
      [d.id]
    );
    if (rows.length) {
      await query(
        'UPDATE sys_account SET phone = ?, display_name = ?, password_hash = ?, status = 1, role = ? WHERE id = ?',
        [d.phone, d.driver_name, hashPassword(DEFAULT_PASSWORD), 'DRIVER', rows[0].id]
      );
    } else {
      await query(
        `INSERT INTO sys_account
          (account_type, phone, password_hash, display_name, carrier_id, driver_id, role, status, create_name, update_name)
         VALUES ('DRIVER', ?, ?, ?, NULL, ?, 'DRIVER', 1, '系统初始化', '系统初始化')`,
        [d.phone, hashPassword(DEFAULT_PASSWORD), d.driver_name, d.id]
      );
    }
    result.drivers.push({ id: d.id, name: d.driver_name, phone: d.phone });
  }

  console.log('平台管理员：admin / 123456');
  console.log('承运商账号（密码 123456，登录后台）：');
  result.staff.forEach((s) => console.log(`  ${s.phone}`));
  console.log('司机账号（密码 123456，只能登录小程序）：');
  result.drivers.forEach((d) => console.log(`  ${d.name} ${d.phone}`));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
