/**
 * 账号与角色分开。
 * 角色配置功能权限（模块 + 按钮）和数据权限（承运商运单范围、物料类型 成品/散件）。
 */
const { query } = require('../db');

const MATERIALS = [
  { value: 'FINISHED', label: '成品' },
  { value: 'LOOSE', label: '散件' },
];

/** 功能权限目录。kind 决定这组权限属于哪类登录端。 */
const MODULES = [
  {
    code: 'dashboard', name: '工作台', kind: 'PLATFORM',
    actions: [{ code: 'dashboard:view', name: '查看' }],
  },
  {
    code: 'carriers', name: '承运商管理', kind: 'PLATFORM',
    actions: [
      { code: 'carriers:view', name: '查看' },
      { code: 'carriers:create', name: '新增' },
      { code: 'carriers:edit', name: '编辑' },
      { code: 'carriers:status', name: '启用/停用' },
      { code: 'carriers:export', name: '导出' },
    ],
  },
  {
    code: 'drivers', name: '司机管理', kind: 'PLATFORM',
    actions: [
      { code: 'drivers:view', name: '查看' },
      { code: 'drivers:create', name: '新增' },
      { code: 'drivers:edit', name: '编辑' },
      { code: 'drivers:status', name: '启用/停用' },
      { code: 'drivers:export', name: '导出' },
    ],
  },
  {
    code: 'tasks', name: '发运任务', kind: 'PLATFORM',
    actions: [
      { code: 'tasks:view', name: '查看' },
      { code: 'tasks:dispatch', name: '派单' },
      { code: 'tasks:reassign', name: '改派' },
      { code: 'tasks:cancel', name: '取消派单' },
      { code: 'tasks:export', name: '导出' },
    ],
  },
  {
    code: 'tracking', name: '运输监控', kind: 'PLATFORM',
    actions: [{ code: 'tracking:view', name: '查看' }],
  },
  {
    code: 'freight', name: '结算管理', kind: 'PLATFORM',
    actions: [
      { code: 'freight:view', name: '查看' },
      { code: 'freight:export', name: '导出' },
      { code: 'freight:adjust', name: '调整运费' },
    ],
  },
  {
    code: 'esigns', name: '电子签台账', kind: 'PLATFORM',
    actions: [
      { code: 'esigns:view', name: '查看' },
      { code: 'esigns:export', name: '导出' },
    ],
  },
  {
    code: 'accounts', name: '账号管理', kind: 'PLATFORM',
    actions: [
      { code: 'accounts:view', name: '查看' },
      { code: 'accounts:create', name: '新增' },
      { code: 'accounts:edit', name: '编辑' },
    ],
  },
  {
    code: 'roles', name: '角色管理', kind: 'PLATFORM',
    actions: [
      { code: 'roles:view', name: '查看' },
      { code: 'roles:create', name: '新增' },
      { code: 'roles:edit', name: '编辑' },
      { code: 'roles:perm', name: '配置权限' },
    ],
  },
  {
    code: 'portal-dashboard', name: '承运商工作台', kind: 'CARRIER',
    actions: [{ code: 'portal.dashboard:view', name: '查看' }],
  },
  {
    code: 'portal-tasks', name: '运输任务', kind: 'CARRIER',
    actions: [
      { code: 'portal.tasks:view', name: '查看' },
      { code: 'portal.tasks:accept', name: '接单' },
      { code: 'portal.tasks:assign', name: '分配司机' },
    ],
  },
  {
    code: 'portal-drivers', name: '承运商司机', kind: 'CARRIER',
    actions: [
      { code: 'portal.drivers:view', name: '查看' },
      { code: 'portal.drivers:create', name: '新增' },
      { code: 'portal.drivers:edit', name: '编辑' },
      { code: 'portal.drivers:status', name: '启用/停用' },
    ],
  },
  {
    code: 'portal-messages', name: '消息中心', kind: 'CARRIER',
    actions: [{ code: 'portal.messages:view', name: '查看' }],
  },
  {
    code: 'mini-tasks', name: '我的任务', kind: 'DRIVER',
    actions: [
      { code: 'mini.tasks:view', name: '查看' },
      { code: 'mini.tasks:pickup', name: '确认提车' },
      { code: 'mini.tasks:arrive', name: '确认到达' },
      { code: 'mini.tasks:finish', name: '结单' },
    ],
  },
  {
    code: 'mini-messages', name: '消息', kind: 'DRIVER',
    actions: [{ code: 'mini.messages:view', name: '查看' }],
  },
];

const ALL_CODES = MODULES.flatMap((mod) => mod.actions.map((action) => action.code));
const CODES_BY_KIND = {
  PLATFORM: new Set(MODULES.filter((mod) => mod.kind === 'PLATFORM').flatMap((mod) => mod.actions.map((a) => a.code))),
  CARRIER: new Set(MODULES.filter((mod) => mod.kind === 'CARRIER').flatMap((mod) => mod.actions.map((a) => a.code))),
  DRIVER: new Set(MODULES.filter((mod) => mod.kind === 'DRIVER').flatMap((mod) => mod.actions.map((a) => a.code))),
};

function codesOf(kind) {
  if (kind === 'SUPER') return [...ALL_CODES];
  return [...(CODES_BY_KIND[kind] || [])];
}

function accountTypeOf(role) {
  if (role.role_kind === 'SUPER' || role.role_kind === 'PLATFORM') return 'ADMIN';
  if (role.role_kind === 'DRIVER') return 'DRIVER';
  return role.role_code === 'CARRIER002' ? 'CARRIER_DISPATCHER' : 'CARRIER_ADMIN';
}

async function columnExists(table, column) {
  const rows = await query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [column]);
  return rows.length > 0;
}

async function ensureAccess() {
  await query(`CREATE TABLE IF NOT EXISTS sys_role (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    role_code VARCHAR(32) NOT NULL,
    role_name VARCHAR(64) NOT NULL,
    role_kind VARCHAR(16) NOT NULL COMMENT 'PLATFORM/CARRIER/DRIVER',
    remark VARCHAR(255) DEFAULT NULL,
    status TINYINT NOT NULL DEFAULT 1,
    builtin TINYINT NOT NULL DEFAULT 0,
    create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted TINYINT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uk_role_code (role_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色'`);

  await query(`CREATE TABLE IF NOT EXISTS sys_role_perm (
    role_id BIGINT UNSIGNED NOT NULL,
    perm_code VARCHAR(64) NOT NULL,
    PRIMARY KEY (role_id, perm_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色功能权限'`);

  await query(`CREATE TABLE IF NOT EXISTS sys_role_data (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    role_id BIGINT UNSIGNED NOT NULL,
    data_type VARCHAR(16) NOT NULL COMMENT 'CARRIER/MATERIAL',
    data_value VARCHAR(32) NOT NULL COMMENT '承运商ID、*、FINISHED、LOOSE',
    PRIMARY KEY (id),
    UNIQUE KEY uk_role_data (role_id, data_type, data_value)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='角色数据权限'`);

  if (!(await columnExists('sys_account', 'role_id'))) {
    await query('ALTER TABLE sys_account ADD COLUMN role_id BIGINT UNSIGNED DEFAULT NULL COMMENT \'角色ID\' AFTER role');
  }
  if (!(await columnExists('shipping_task', 'material_type'))) {
    await query("ALTER TABLE shipping_task ADD COLUMN material_type VARCHAR(16) DEFAULT NULL COMMENT '物料类型:FINISHED-成品,LOOSE-散件' AFTER ship_method");
  }

  // 内置角色编码统一为「端前缀 + 三位流水」，历史编码先迁移
  const legacyCodes = {
    PLATFORM_ADMIN: 'PLATFORM001',
    CARRIER_ADMIN: 'CARRIER001',
    CARRIER_DISPATCHER: 'CARRIER002',
    DRIVER: 'DRIVER001',
  };
  for (const [oldCode, newCode] of Object.entries(legacyCodes)) {
    const [oldRows, newRows] = await Promise.all([
      query('SELECT id FROM sys_role WHERE role_code = ? LIMIT 1', [oldCode]),
      query('SELECT id FROM sys_role WHERE role_code = ? LIMIT 1', [newCode]),
    ]);
    if (oldRows.length && !newRows.length) {
      await query('UPDATE sys_role SET role_code = ? WHERE id = ?', [newCode, oldRows[0].id]);
      await query('UPDATE sys_account SET role = ? WHERE role = ?', [newCode, oldCode]);
    }
  }

  const builtins = [
    { code: 'PLATFORM001', name: '超级管理员', kind: 'SUPER', remark: '超级管理员，全部功能与全部数据' },
    { code: 'CARRIER001', name: '承运商管理员', kind: 'CARRIER', remark: '承运商后台；运单范围取账号所属承运商' },
    { code: 'CARRIER002', name: '承运商调度', kind: 'CARRIER', remark: '承运商后台，不含司机新增与停用' },
    { code: 'DRIVER001', name: '司机', kind: 'DRIVER', remark: '只能登录小程序' },
  ];
  for (const role of builtins) {
    const rows = await query('SELECT id FROM sys_role WHERE role_code = ? AND deleted = 0', [role.code]);
    let id = rows[0]?.id;
    if (!id) {
      const ins = await query(
        `INSERT INTO sys_role (role_code, role_name, role_kind, remark, status, builtin)
         VALUES (?, ?, ?, ?, 1, 1)`,
        [role.code, role.name, role.kind, role.remark]
      );
      id = ins.insertId;
    } else if (role.code === 'PLATFORM001') {
      await query('UPDATE sys_role SET role_kind = \'SUPER\' WHERE id = ? AND role_kind <> \'SUPER\'', [id]);
    }
    const permCount = await query('SELECT COUNT(*) AS n FROM sys_role_perm WHERE role_id = ?', [id]);
    if (!Number(permCount[0].n)) {
      let perms = codesOf(role.kind);
      if (role.code === 'CARRIER002') {
        perms = perms.filter((code) => code !== 'portal.drivers:create' && code !== 'portal.drivers:status');
      }
      for (const code of perms) {
        await query('INSERT INTO sys_role_perm (role_id, perm_code) VALUES (?, ?)', [id, code]);
      }
    }
    const dataCount = await query('SELECT COUNT(*) AS n FROM sys_role_data WHERE role_id = ?', [id]);
    if (!Number(dataCount[0].n)) {
      await query('INSERT INTO sys_role_data (role_id, data_type, data_value) VALUES (?, \'CARRIER\', \'*\')', [id]);
      await query('INSERT INTO sys_role_data (role_id, data_type, data_value) VALUES (?, \'MATERIAL\', \'FINISHED\')', [id]);
      await query('INSERT INTO sys_role_data (role_id, data_type, data_value) VALUES (?, \'MATERIAL\', \'LOOSE\')', [id]);
    }
  }

  const typeToCode = {
    ADMIN: 'PLATFORM001',
    CARRIER_ADMIN: 'CARRIER001',
    CARRIER_DISPATCHER: 'CARRIER002',
    DRIVER: 'DRIVER001',
  };
  const roles = await query('SELECT id, role_code FROM sys_role WHERE deleted = 0');
  const roleId = Object.fromEntries(roles.map((row) => [row.role_code, row.id]));
  const accounts = await query('SELECT id, account_type, role_id FROM sys_account WHERE deleted = 0 AND role_id IS NULL');
  for (const account of accounts) {
    const code = typeToCode[account.account_type];
    if (code && roleId[code]) {
      await query('UPDATE sys_account SET role_id = ?, role = ? WHERE id = ?', [roleId[code], code, account.id]);
    }
  }
}

async function loadAccess(accountId) {
  const rows = await query(
    `SELECT a.id, a.account_type, a.carrier_id, a.role_id, r.role_code, r.role_name, r.role_kind, r.status AS role_status
     FROM sys_account a
     LEFT JOIN sys_role r ON r.id = a.role_id AND r.deleted = 0
     WHERE a.id = ? AND a.deleted = 0`,
    [accountId]
  );
  const account = rows[0];
  if (!account || !account.role_id || Number(account.role_status) !== 1) {
    return {
      roleId: account?.role_id ?? null,
      roleCode: account?.role_code ?? null,
      roleName: account?.role_name ?? null,
      roleKind: null,
      permissions: [],
      carriers: [],
      materials: [],
    };
  }
  const perms = await query('SELECT perm_code FROM sys_role_perm WHERE role_id = ?', [account.role_id]);
  const data = await query('SELECT data_type, data_value FROM sys_role_data WHERE role_id = ?', [account.role_id]);
  const carrierValues = data.filter((row) => row.data_type === 'CARRIER').map((row) => row.data_value);
  const materialValues = data.filter((row) => row.data_type === 'MATERIAL').map((row) => row.data_value);
  let carriers = carrierValues.includes('*') ? 'ALL' : carrierValues.map((value) => Number(value)).filter((id) => id > 0);
  if (account.role_kind === 'CARRIER') {
    const own = Number(account.carrier_id);
    if (!own) carriers = [];
    else if (carriers === 'ALL') carriers = [own];
    else carriers = carriers.filter((id) => id === own);
  }
  if (account.role_kind === 'DRIVER') carriers = [];
  const materials = materialValues.includes('*') || (materialValues.includes('FINISHED') && materialValues.includes('LOOSE'))
    ? 'ALL'
    : materialValues.filter((value) => value === 'FINISHED' || value === 'LOOSE');
  return {
    roleId: account.role_id,
    roleCode: account.role_code,
    roleName: account.role_name,
    roleKind: account.role_kind,
    permissions: perms.map((row) => row.perm_code),
    carriers,
    materials,
  };
}

/** 把角色的承运商、物料范围追加到运单查询。未登录不限制（外部接口）。 */
function applyTaskScope(where, params, access) {
  if (!access) return;
  if (access.carriers !== 'ALL') {
    if (!access.carriers.length) where.push('1 = 0');
    else {
      where.push(`t.carrier_id IN (${access.carriers.map(() => '?').join(',')})`);
      params.push(...access.carriers);
    }
  }
  if (access.materials !== 'ALL') {
    if (!access.materials.length) where.push('1 = 0');
    else {
      where.push(`(t.material_type IS NULL OR t.material_type IN (${access.materials.map(() => '?').join(',')}))`);
      params.push(...access.materials);
    }
  }
}

module.exports = {
  MATERIALS,
  MODULES,
  ALL_CODES,
  codesOf,
  accountTypeOf,
  ensureAccess,
  loadAccess,
  applyTaskScope,
};
