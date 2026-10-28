/**
 * 承运商端 API（前缀 /api/portal/carrier）
 * 权限：登录账号类型 CARRIER，所有查询强制按 token 内的 carrier_id 做数据隔离
 */
const { Router } = require('express');
const { query, withTransaction } = require('../db');
const {
  wrap, ok, pageOf, pageData, errParam, errBiz, errAuth, errNotFound,
  assertPhone, assertIdCard, localDateStr,
} = require('../helpers');
const { requireAuth } = require('../services/security');
const { loadAccess, applyTaskScope } = require('../services/access');
const { assignDriver, withStatusLogNames } = require('../services/taskFlow');
const { ensureDriverAccount, assertAccountReady } = require('../services/driverAccount');

const router = Router();
router.use(requireAuth(['CARRIER', 'ADMIN']));

/** 承运商账号只看自己；平台账号按角色里勾选的承运商范围看承运商后台。 */
async function carrierScope(req) {
  const access = await loadAccess(req.auth.sub);
  if (req.auth.type === 'ADMIN') {
    if (!access.permissions.some((code) => code.startsWith('portal.'))) {
      throw errAuth('当前账号无权访问承运商后台');
    }
    if (access.carriers === 'ALL') return { access, mode: 'all', ids: [] };
    return { access, mode: 'list', ids: access.carriers };
  }
  return { access, mode: 'one', ids: [Number(req.auth.carrierId)] };
}

function inScope(scope, carrierId) {
  if (scope.mode === 'all') return true;
  return scope.ids.includes(Number(carrierId));
}

function carrierFilter(scope, column) {
  if (scope.mode === 'all') return { sql: '1 = 1', params: [] };
  if (!scope.ids.length) return { sql: '1 = 0', params: [] };
  if (scope.ids.length === 1) return { sql: `${column} = ?`, params: [scope.ids[0]] };
  return { sql: `${column} IN (${scope.ids.map(() => '?').join(',')})`, params: [...scope.ids] };
}

async function ownCarrierId(req) {
  if (req.auth.type === 'CARRIER') return Number(req.auth.carrierId);
  const scope = await carrierScope(req);
  if (scope.ids.length === 1) return scope.ids[0];
  throw errBiz('当前账号可查看多家承运商，新增和改派请使用对应承运商账号');
}

const TASK_STATUS_LABELS = {
  WAIT_DISPATCH: '待派单',
  DISPATCHED: '待接单',
  CARRIER_ACCEPTED: '待提车',
  PICKED: '已提车',
  OUTBOUND: '已出库',
  IN_TRANSIT: '在途',
  ARRIVED: '待结单',
  FINISHED: '已完结',
  CANCELLED: '已取消',
};

const TASK_SELECT = `
  SELECT t.id, t.task_no, t.order_no, t.apply_no, t.customer_name, t.status,
         t.ship_location, t.delivery_area, t.delivery_address, t.plan_freight, t.mileage,
         t.plan_pickup_date, t.outbound_date, t.ship_time, t.arrive_time, t.finish_time,
         t.create_time, t.version, t.carrier_id,
         (SELECT GROUP_CONCAT(v.vin ORDER BY v.id SEPARATOR '、') FROM shipping_task_vehicle v
           WHERE v.task_id = t.id AND v.deleted = 0) AS vins,
         (SELECT GROUP_CONCAT(v.vehicle_model ORDER BY v.id SEPARATOR '、') FROM shipping_task_vehicle v
           WHERE v.task_id = t.id AND v.deleted = 0) AS vehicle_models,
         d.driver_name, d.phone AS driver_phone, c.carrier_name
  FROM shipping_task t
  LEFT JOIN driver d ON d.id = t.driver_id
  LEFT JOIN carrier c ON c.id = t.carrier_id`;

async function taskWhere(req) {
  const { status = '', keyword = '', task_no = '', order_no = '', apply_no = '', vin = '', customer_name = '' } = req.query;
  const scope = await carrierScope(req);
  const filter = carrierFilter(scope, 't.carrier_id');
  const where = ['t.deleted = 0', filter.sql, "t.status <> 'WAIT_DISPATCH'"];
  const params = [...filter.params];
  applyTaskScope(where, params, { ...scope.access, carriers: 'ALL' });
  if (status) { where.push('t.status = ?'); params.push(String(status)); }
  const exact = (sql, value) => {
    const v = String(value).trim();
    if (!v) return;
    where.push(sql);
    params.push(`%${v}%`);
  };
  exact('t.task_no LIKE ?', task_no);
  exact('t.order_no LIKE ?', order_no);
  exact('t.apply_no LIKE ?', apply_no);
  exact('t.customer_name LIKE ?', customer_name);
  const vinValue = String(vin).trim();
  if (vinValue) {
    where.push(`EXISTS (
      SELECT 1 FROM shipping_task_vehicle v WHERE v.task_id = t.id AND v.deleted = 0 AND v.vin LIKE ?
    )`);
    params.push(`%${vinValue}%`);
  }
  if (keyword) {
    const kw = `%${String(keyword).trim()}%`;
    where.push(`(t.task_no LIKE ? OR t.customer_name LIKE ? OR EXISTS (
      SELECT 1 FROM shipping_task_vehicle v WHERE v.task_id = t.id AND v.deleted = 0 AND v.vin LIKE ?
    ))`);
    params.push(kw, kw, kw);
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

/** 任务列表 */
router.get('/tasks', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { whereSql, params } = await taskWhere(req);
  const totalRows = await query(`SELECT COUNT(*) AS n FROM shipping_task t ${whereSql}`, params);
  const rows = await query(
    `${TASK_SELECT} ${whereSql} ORDER BY t.create_time DESC, t.id DESC LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(rows, Number(totalRows[0].n), page, size));
}));

/** 各状态数量（工作台） */
router.get('/tasks/counts', wrap(async (req, res) => {
  const scope = await carrierScope(req);
  const filter = carrierFilter(scope, 'carrier_id');
  const rows = await query(
    `SELECT status, COUNT(*) AS n FROM shipping_task
     WHERE deleted = 0 AND ${filter.sql} AND status <> 'WAIT_DISPATCH'
     GROUP BY status`,
    filter.params
  );
  const counts = {
    DISPATCHED: 0, CARRIER_ACCEPTED: 0, PICKED: 0, IN_TRANSIT: 0, ARRIVED: 0, FINISHED: 0, CANCELLED: 0,
  };
  rows.forEach((r) => {
    if (r.status === 'OUTBOUND') counts.PICKED += Number(r.n);
    else if (counts[r.status] !== undefined) counts[r.status] += Number(r.n);
  });
  counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
  ok(res, { counts, labels: TASK_STATUS_LABELS });
}));

/** 任务详情（含车辆、时间轴、附件、派单记录） */
router.get('/tasks/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [task] = await query(
    `SELECT t.*, d.driver_name, d.phone AS driver_phone, d.license_type
     FROM shipping_task t LEFT JOIN driver d ON d.id = t.driver_id
     WHERE t.id = ? AND t.deleted = 0`,
    [id]
  );
  if (!task) throw errNotFound('任务不存在');
  const scope = await carrierScope(req);
  if (!inScope(scope, task.carrier_id)) throw errBiz('该任务不属于当前承运商');

  const [vehicles, logs, files, dispatchRecords] = await Promise.all([
    query('SELECT * FROM shipping_task_vehicle WHERE task_id = ? AND deleted = 0 ORDER BY id', [id]),
    query('SELECT * FROM task_status_log WHERE task_id = ? AND deleted = 0 ORDER BY create_time, id', [id]),
    query('SELECT * FROM task_file WHERE task_id = ? AND deleted = 0 ORDER BY id', [id]),
    query('SELECT * FROM dispatch_record WHERE task_id = ? AND deleted = 0 ORDER BY dispatch_time, id', [id]),
  ]);

  ok(res, {
    task,
    vehicles,
    status_logs: withStatusLogNames(logs),
    files,
    dispatch_records: dispatchRecords,
    allowed_actions: task.status === 'DISPATCHED' ? ['ASSIGN'] : [],
  });
}));

/** 接单并指派司机 */
router.post('/tasks/:id/assign', wrap(async (req, res) => {
  const taskId = Number(req.params.id);
  const driverId = Number(req.body.driver_id);
  if (!driverId) throw errParam('请选择司机');

  const [taskRow] = await query('SELECT carrier_id FROM shipping_task WHERE id = ? AND deleted = 0', [taskId]);
  if (!taskRow) throw errNotFound('任务不存在');
  const scope = await carrierScope(req);
  if (!inScope(scope, taskRow.carrier_id)) throw errBiz('该任务不属于当前承运商');
  const carrierId = req.auth.type === 'CARRIER' ? Number(req.auth.carrierId) : Number(taskRow.carrier_id);
  const carrierRows = await query('SELECT * FROM carrier WHERE id = ?', [carrierId]);
  if (!carrierRows.length) throw errNotFound('承运商不存在');
  if (Number(carrierRows[0].status) !== 1) throw errBiz('承运商已停用，不可接单');

  const result = await assignDriver({
    taskId,
    carrierId,
    carrierName: carrierRows[0].carrier_name,
    driverId,
    version: req.body.version,
    operator: req.auth.name,
    operatorName: req.auth.name,
  });
  ok(res, result, `接单成功，已指派司机（任务 ${result.task_no}）`);
}));

/** 本承运商司机列表；传 carrier_id 时只返回该承运商司机（接单指派用） */
router.get('/drivers', wrap(async (req, res) => {
  const carrierIdParam = Number(req.query.carrier_id || 0);
  const scope = await carrierScope(req);
  if (carrierIdParam && !inScope(scope, carrierIdParam)) {
    throw errBiz('该任务不属于当前承运商');
  }
  const filter = carrierIdParam
    ? { sql: 'd.carrier_id = ?', params: [carrierIdParam] }
    : carrierFilter(scope, 'd.carrier_id');
  const params = [...filter.params];
  const conditions = [];
  const like = (col, value) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    conditions.push(`${col} LIKE ?`);
    params.push(`%${v}%`);
  };
  like('d.driver_name', req.query.driver_name);
  like('d.phone', req.query.phone);
  like('d.license_no', req.query.license_no);
  if (req.query.status !== '' && req.query.status !== undefined && req.query.status !== null) {
    conditions.push('d.status = ?');
    params.push(Number(req.query.status));
  }
  const keyword = String(req.query.keyword ?? '').trim();
  if (keyword) {
    conditions.push('(d.driver_name LIKE ? OR d.phone LIKE ? OR d.license_no LIKE ?)');
    const kw = `%${keyword}%`;
    params.push(kw, kw, kw);
  }
  const kwSql = conditions.length ? `AND ${conditions.join(' AND ')}` : '';
  const rows = await query(
    `SELECT d.id, d.driver_name, d.phone, d.id_card, d.license_no, d.license_type,
            d.license_valid_from, d.license_valid_to, d.source, d.status, d.remark, d.create_time,
            (SELECT COUNT(*) FROM shipping_task t
              WHERE t.driver_id = d.id AND t.deleted = 0
                AND t.status IN ('CARRIER_ACCEPTED','PICKED','OUTBOUND','IN_TRANSIT','ARRIVED')) AS active_task_count,
            (SELECT a.status FROM sys_account a
              WHERE a.driver_id = d.id AND a.account_type = 'DRIVER' AND a.deleted = 0 LIMIT 1) AS account_status
     FROM driver d
     WHERE d.deleted = 0 AND ${filter.sql} ${kwSql}
     ORDER BY d.status DESC, d.id`,
    params
  );
  ok(res, rows);
}));

function assertLicenseRange(from, to) {
  if (!from) throw errParam('驾驶证有效期自必填');
  if (!to) throw errParam('驾驶证有效期至必填');
  if (String(from) > String(to)) throw errParam('驾驶证有效期起不能晚于有效期止');
}

/** 新增司机：档案仅归属当前承运商；同身份证在其他承运商的档案互不影响 */
router.post('/drivers', wrap(async (req, res) => {
  const name = String(req.body.name ?? '').trim();
  if (!name) throw errParam('司机姓名必填');
  if (name.length > 64) throw errParam('司机姓名不能超过 64 字');
  const phone = assertPhone(req.body.phone, { label: '手机号', mobileOnly: true });
  const idCard = assertIdCard(req.body.id_card, { label: '身份证号' });
  const licenseFrom = String(req.body.license_valid_from ?? '');
  const licenseTo = String(req.body.license_valid_to ?? '');
  assertLicenseRange(licenseFrom, licenseTo);
  if (licenseTo < localDateStr()) throw errParam('驾驶证已过期，请填写有效证件');

  const licenseNo = String(req.body.license_no ?? '').trim() || null;
  const licenseType = String(req.body.license_type ?? '').trim() || null;
  const remark = String(req.body.remark ?? '').trim() || null;
  const carrierId = await ownCarrierId(req);
  const operator = req.auth.name;

  const result = await withTransaction(async (conn) => {
    const [existing] = await conn.query(
      'SELECT * FROM driver WHERE carrier_id = ? AND id_card = ? AND deleted = 0',
      [carrierId, idCard]
    );
    let driverId;
    let reused = false;
    if (existing.length) {
      // 本承运商下已建档：沿用档案并更新联系方式，不重复创建
      driverId = existing[0].id;
      reused = true;
      if (existing[0].driver_name !== name) {
        throw errBiz(`本承运商已存在该身份证号的司机「${existing[0].driver_name}」，请核对后再添加`);
      }
      await conn.query('UPDATE driver SET phone = ?, remark = COALESCE(?, remark), update_name = ? WHERE id = ?',
        [phone, remark, operator, driverId]);
    } else {
      const [ins] = await conn.query(
        `INSERT INTO driver
          (driver_name, phone, id_card, carrier_id, license_no, license_type, license_valid_from, license_valid_to,
           source, status, remark, create_name, update_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
        [name, phone, idCard, carrierId, licenseNo, licenseType, licenseFrom, licenseTo, remark, operator, operator]
      );
      driverId = ins.insertId;
    }

    const account = await ensureDriverAccount(conn, {
      driverId,
      driverName: name,
      phone,
      carrierId,
      operator,
    });
    assertAccountReady(account, phone);
    return { driverId, reused };
  });

  const [driver] = await query('SELECT * FROM driver WHERE id = ?', [result.driverId]);
  ok(res, { driver, reused: result.reused },
    result.reused ? '该司机已在当前承运商建档，信息已更新' : '司机新增成功，可使用手机号验证码登录司机端');
}));

/** 编辑司机（姓名、身份证不可改；只能编辑本承运商档案） */
router.put('/drivers/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const scope = await carrierScope(req);
  const [driver] = await query('SELECT * FROM driver WHERE id = ? AND deleted = 0', [id]);
  if (!driver) throw errNotFound('司机不存在');
  if (!inScope(scope, driver.carrier_id)) throw errNotFound('该司机不属于当前承运商');
  if (Number(driver.source) === 2) throw errBiz('狮桥同步司机不可在平台编辑');
  if (req.body.name !== undefined && String(req.body.name).trim() !== driver.driver_name) {
    throw errBiz('司机姓名不可修改');
  }
  if (req.body.id_card !== undefined && String(req.body.id_card).trim().toUpperCase() !== driver.id_card) {
    throw errBiz('身份证号不可修改');
  }

  const phone = req.body.phone === undefined
    ? driver.phone
    : assertPhone(req.body.phone, { label: '手机号', mobileOnly: true });
  const from = req.body.license_valid_from ?? driver.license_valid_from;
  const to = req.body.license_valid_to ?? driver.license_valid_to;
  assertLicenseRange(from, to);
  const licenseNo = req.body.license_no === undefined ? driver.license_no : (String(req.body.license_no).trim() || null);
  const licenseType = req.body.license_type === undefined ? driver.license_type : (String(req.body.license_type).trim() || null);
  const remark = req.body.remark === undefined ? driver.remark : (String(req.body.remark).trim() || null);

  await withTransaction(async (conn) => {
    await conn.query(
      `UPDATE driver SET phone = ?, license_no = ?, license_type = ?, license_valid_from = ?,
              license_valid_to = ?, remark = ?, update_name = ? WHERE id = ?`,
      [phone, licenseNo, licenseType, from, to, remark, req.auth.name, id]
    );
    const account = await ensureDriverAccount(conn, {
      driverId: id,
      driverName: driver.driver_name,
      phone,
      carrierId: driver.carrier_id,
      operator: req.auth.name,
    });
    assertAccountReady(account, phone);
  });

  const [updated] = await query('SELECT * FROM driver WHERE id = ?', [id]);
  ok(res, updated, '司机信息已更新');
}));

/** 启用/停用司机 */
router.put('/drivers/:id/status', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const status = Number(req.body.status);
  if (![0, 1].includes(status)) throw errParam('状态值仅支持 1（启用）或 0（停用）');
  const scope = await carrierScope(req);
  const [driver] = await query('SELECT id, carrier_id FROM driver WHERE id = ? AND deleted = 0', [id]);
  if (!driver || !inScope(scope, driver.carrier_id)) throw errNotFound('该司机不属于当前承运商');
  await withTransaction(async (conn) => {
    await conn.query('UPDATE driver SET status = ?, update_name = ? WHERE id = ?', [status, req.auth.name, id]);
    await conn.query(
      `UPDATE sys_account SET status = ?, update_name = ? WHERE account_type = 'DRIVER' AND driver_id = ? AND deleted = 0`,
      [status, req.auth.name, id]
    );
  });
  ok(res, { id, status }, status === 1 ? '司机已启用' : '司机已停用，停用后不可再分派任务');
}));

/** 消息中心 */
router.get('/notifications', wrap(async (req, res) => {
  const scope = await carrierScope(req);
  const filter = carrierFilter(scope, 'receiver_id');
  const rows = await query(
    `SELECT * FROM notification
     WHERE receiver_type = 'CARRIER' AND channel = 'INBOX' AND deleted = 0 AND ${filter.sql}
     ORDER BY id DESC LIMIT 100`,
    filter.params
  );
  ok(res, rows);
}));

router.post('/notifications/:id/read', wrap(async (req, res) => {
  const scope = await carrierScope(req);
  const filter = carrierFilter(scope, 'receiver_id');
  await query(
    `UPDATE notification SET read_status = 1
     WHERE id = ? AND receiver_type = 'CARRIER' AND ${filter.sql}`,
    [Number(req.params.id), ...filter.params]
  );
  ok(res, null);
}));

module.exports = router;
