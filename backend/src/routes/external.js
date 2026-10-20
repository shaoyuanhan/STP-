/**
 * 外部系统接口（契约第 6 节，前缀 /api/external，camelCase，均幂等，不走登录态）
 *
 * 调用方与接口清单：
 *   CRM  ① POST /shipping-tasks/receive        发运申请任务接收（applyNo 幂等 C0001，taskNo 自动生成）
 *   CRM  ② POST /esign/sync                     物流电子签同步（esignId 幂等，VIN+applyNo 匹配，vin 查车辆明细表）
 *   CRM  ③ GET  /shipping-tasks/cancel-check    送车发运申请取消前状态查询
 *   狮桥 ④ POST /esign/receipt-sync             物流电子签签收回执确认（幂等）
 *   CRM  ⑥ POST /shipping-tasks/cancel          送车发运申请取消（按取消规则，关联待签署电子签置 CANCELLED）
 *   WMS  ⑧ POST /wms/outbound-status            WMS 出库状态同步（CARRIER_ACCEPTED→OUTBOUND，出库在前、司机提车在后）
 *   狮桥 ⑩ POST /drivers/sync                   司机信息同步（身份证号 UPSERT，source=2，维护 carrier_driver）
 *   狮桥 ⑫ POST /shipping-tasks/status-sync     任务状态同步（ACCEPT/PICKUP/ARRIVE/FINISH，按状态机校验）
 *   狮桥 ⑭ POST /esign/sign-status              电子签签署状态同步（WAIT_SIGN→SIGNED/CANCELLED）
 *
 * 统一定位（契约第 6 节）：优先 applyNo（发运申请号，CRM 业务主键），兼容 taskNo；都无 → A0001。
 * 系统触发写入时 create_name/update_name 记来源系统：CRM 系统 / 狮桥物流 / WMS 系统。
 */
const { Router } = require('express');
const { query, withTransaction, nextSeq } = require('../db');
const {
  wrap, ok, errParam, errBiz, errDup, errState, errNotFound,
  localDateStr, assertPhone, assertIdCard, assertAmount, cutStr,
} = require('../helpers');

const router = Router();

/* ======================= 通用辅助 ======================= */

/**
 * 外部回调统一定位任务（非事务版）：优先 applyNo，兼容 taskNo；都无 → A0001（既有需求 4）。
 */
async function resolveTask({ applyNo, taskNo }) {
  const apply = String(applyNo ?? '').trim();
  const no = String(taskNo ?? '').trim();
  if (!apply && !no) throw errParam('请提供发运申请号 applyNo（推荐）或任务单号 taskNo');
  const rows = await query(
    `SELECT * FROM shipping_task WHERE ${apply ? 'apply_no = ?' : 'task_no = ?'} AND deleted = 0`,
    [apply || no]
  );
  if (!rows.length) {
    throw errNotFound(apply ? `发运申请号 ${apply} 对应的任务不存在` : `任务单号 ${no} 对应的任务不存在`);
  }
  return rows[0];
}

/** 写任务状态流转日志（from_status 初始为 NULL；source: STP/CRM/SQ/WMS） */
async function writeStatusLog(conn, { taskId, taskNo, fromStatus, toStatus, source, operator, remark }) {
  await conn.query(
    `INSERT INTO task_status_log (task_id, task_no, from_status, to_status, source, operator, remark, create_name, update_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [taskId, taskNo, fromStatus ?? null, toStatus, source, operator, cutStr(remark, 255), operator, operator]
  );
}

/** 提车照片数组 → 留痕备注（PICKUP photos 写 status_log.remark） */
function photosToRemark(photos) {
  if (!Array.isArray(photos) || !photos.length) return null;
  return `提车照片：${photos.map((p) => String(p).trim()).filter(Boolean).join('；')}`;
}

/** 出库时间解析：未传用当前时间，格式非法抛 A0001 */
function parseOutboundTime(v) {
  if (v === undefined || v === null || v === '') return null; // NULL 交给 SQL NOW()
  const d = new Date(String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) throw errParam('出库时间 outboundTime 格式不正确');
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * CRM 取消规则（契约 3.1）：
 *   WAIT_DISPATCH 可取消；DISPATCHED 需先在 STP 取消派单；CARRIER_ACCEPTED 需承运商取消接单；
 *   OUTBOUND 及之后车辆已出库发运不可取消；CANCELLED 已取消（幂等）。
 * @returns {{cancellable:boolean, message:string, done:boolean}} done=已处于终态可直接返回
 */
function cancelRule(status) {
  switch (status) {
    case 'WAIT_DISPATCH':
      return { cancellable: true, message: '当前为待派单状态，可以取消', done: false };
    case 'DISPATCHED':
      return { cancellable: false, message: '当前为已派单状态，请先在 STP 取消派单后再同步取消', done: false };
    case 'CARRIER_ACCEPTED':
      return { cancellable: false, message: '承运商已接单，需联系承运商取消接单后再同步取消', done: false };
    case 'CANCELLED':
      return { cancellable: false, message: '该任务已取消，无需重复操作', done: true };
    default: // OUTBOUND / PICKED / IN_TRANSIT / ARRIVED / FINISHED（已出库发运及之后）
      return { cancellable: false, message: '车辆已出库发运，不可取消', done: false };
  }
}

/* ======================= ① CRM：发运申请任务接收 ======================= */
// POST /api/external/shipping-tasks/receive
router.post('/shipping-tasks/receive', wrap(async (req, res) => {
  const b = req.body || {};

  // ---- 参数校验（camelCase）----
  const applyNo = String(b.applyNo ?? '').trim();
  if (!applyNo) throw errParam('发运申请号 applyNo 必填');
  const customerName = String(b.customerName ?? '').trim();
  if (!customerName) throw errParam('客户名称 customerName 必填');
  const deliveryAddress = String(b.deliveryAddress ?? '').trim();
  if (!deliveryAddress) throw errParam('交付地址 deliveryAddress 必填');
  if (!Array.isArray(b.vehicles) || !b.vehicles.length) throw errParam('车辆明细 vehicles 必填（至少一台车）');
  b.vehicles.forEach((v, i) => {
    const vin = String(v?.vin ?? '').trim();
    if (!vin) throw errParam(`第 ${i + 1} 台车的 VIN 必填`);
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) throw errParam(`第 ${i + 1} 台车的 VIN 格式不正确，应为 17 位`);
  });
  if (b.remark && String(b.remark).length > 500) throw errParam('备注 remark 不能超过 500 字');

  const salesPhone = assertPhone(b.salesPhone, { label: '销售人员电话 salesPhone', required: false });
  const receiverPhone = assertPhone(b.receiverPhone, { label: '接车人电话 receiverPhone', required: false });
  // 计划提车日期由 CRM 随发运申请直接下发，必填（既有需求：承运商接单后仅可调整）
  if (!b.planPickupDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.planPickupDate).trim())) {
    throw errParam('计划提车日期 planPickupDate 必填，格式 YYYY-MM-DD');
  }
  // 生产工厂/存放地点/发运地点由 CRM 随发运申请下发，必填（PRD 基础信息 + 车辆明细字段）
  const factory = String(b.factory ?? '').trim();
  if (!factory) throw errParam('生产工厂 factory 必填');
  const storageLocation = String(b.storageLocation ?? '').trim();
  if (!storageLocation) throw errParam('存放地点 storageLocation 必填');
  const headShipLocation = String(b.shipLocation ?? '').trim();
  b.vehicles.forEach((v, i) => {
    if (!String(v?.shipLocation ?? '').trim() && !headShipLocation) {
      throw errParam(`第 ${i + 1} 台车的发运地点 shipLocation 必填（或顶层 shipLocation 统一提供）`);
    }
  });

  // ---- applyNo 幂等：重复下发 → C0001（既有需求 1：任务单号 STP 自动生成，CRM 不传）----
  const dup = await query('SELECT id, task_no FROM shipping_task WHERE apply_no = ? AND deleted = 0', [applyNo]);
  if (dup.length) throw errDup(`发运申请号 ${applyNo} 已下发过，任务单号 ${dup[0].task_no}，请勿重复下发`);

  // 计划运费：head.plan_freight = 各车 planFreight 之和；全部未传时兼容顶层 planFreight（技术方案 3.1 示例）
  const vehicleFreights = b.vehicles.map((v) => (v?.planFreight === undefined || v?.planFreight === null || v?.planFreight === ''
    ? null : assertAmount(v.planFreight, { label: '车辆计划运费 planFreight' })));
  const hasVehicleFreight = vehicleFreights.some((f) => f !== null);
  const planFreight = hasVehicleFreight
    ? Number(vehicleFreights.reduce((s, f) => s + (f || 0), 0).toFixed(2))
    : (b.planFreight === undefined || b.planFreight === null || b.planFreight === ''
      ? null
      : assertAmount(b.planFreight, { label: '计划运费 planFreight' }));

  const taskNo = await withTransaction(async (conn) => {
    const no = await nextSeq('FY', conn); // 任务单号 FY+yyyyMMdd+4 位（系统自动生成）
    const [r] = await conn.query(
      `INSERT INTO shipping_task
        (task_no, apply_no, customer_name, region, sales_person, sales_phone, delivery_area, delivery_address,
         receiver_phone, factory, storage_location, ship_method, ship_location, plan_pickup_date,
         plan_freight, status, remark, create_name, update_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAIT_DISPATCH', ?, 'CRM 系统', 'CRM 系统')`,
      [no, applyNo, cutStr(customerName, 128),
       cutStr(String(b.region ?? '').trim(), 64) || null,
       cutStr(String(b.salesPerson ?? '').trim(), 64) || null,
       salesPhone,
       cutStr(String(b.deliveryArea ?? '').trim(), 128) || null,
       cutStr(deliveryAddress, 255),
       receiverPhone,
       cutStr(factory, 128),
       cutStr(storageLocation, 128),
       cutStr(String(b.shipMethod ?? '送车').trim(), 16) || '送车',
       // head 发运地点：顶层优先，未传取首台车（列表页展示 head 级，保证不为空）
       cutStr(headShipLocation || String(b.vehicles[0]?.shipLocation ?? '').trim(), 128),
       b.planPickupDate ? String(b.planPickupDate).trim() : null,
       planFreight,
       cutStr(String(b.remark ?? '').trim(), 500) || null]
    );
    const taskId = r.insertId;

    // 车辆明细批量写入（一任务多车，VIN 下沉明细表）
    const rows = b.vehicles.map((v, i) => [
      taskId, no, String(v.vin).trim().toUpperCase(),
      v.orderNo ? cutStr(String(v.orderNo).trim(), 64) : null,
      v.reportNo ? cutStr(String(v.reportNo).trim(), 64) : null,
      vehicleFreights[i],
      null,
      v.shipLocation ? cutStr(String(v.shipLocation).trim(), 128) : (b.shipLocation ? cutStr(String(b.shipLocation).trim(), 128) : null),
      v.vehicleModel ? cutStr(String(v.vehicleModel).trim(), 64) : null,
      v.engineConfig ? cutStr(String(v.engineConfig).trim(), 64) : null,
      v.cabinType ? cutStr(String(v.cabinType).trim(), 32) : null,
      'CRM 系统', 'CRM 系统',
    ]);
    await conn.query(
      `INSERT INTO shipping_task_vehicle
        (task_id, task_no, vin, order_no, report_no, plan_freight, actual_freight, ship_location,
         vehicle_model, engine_config, cabin_type, create_name, update_name)
       VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      rows.flat()
    );

    await writeStatusLog(conn, {
      taskId, taskNo: no, fromStatus: null, toStatus: 'WAIT_DISPATCH',
      source: 'CRM', operator: 'CRM 系统',
      remark: `接收CRM发运申请，生成待派单任务（${b.vehicles.length} 台车）`,
    });
    return no;
  });

  ok(res, { taskNo }, `发运申请接收成功，已生成待派单任务 ${taskNo}`);
}));

/* ======================= ② CRM：物流电子签同步 ======================= */
// POST /api/external/esign/sync  （esignId 幂等；VIN+applyNo 匹配任务，vin 查车辆明细表）
router.post('/esign/sync', wrap(async (req, res) => {
  const b = req.body || {};
  const esignId = String(b.esignId ?? '').trim();
  if (!esignId) throw errParam('电子签 ID esignId 必填');
  const vin = String(b.vin ?? '').trim().toUpperCase();
  const applyNo = String(b.applyNo ?? '').trim();
  if (!vin || !applyNo) throw errParam('VIN 与发运申请号 applyNo 必填（用于匹配任务）');

  const dup = await query('SELECT id FROM esign_record WHERE esign_id = ? AND deleted = 0', [esignId]);
  if (dup.length) throw errDup(`电子签 ID ${esignId} 已同步过，请勿重复推送`);

  await withTransaction(async (conn) => {
    // 按 VIN + 发运申请号匹配任务：vin 查 shipping_task_vehicle 明细表（既有需求 8）
    const [vrows] = await conn.query(
      `SELECT v.task_id, v.task_no FROM shipping_task_vehicle v
        JOIN shipping_task t ON t.id = v.task_id AND t.deleted = 0
       WHERE v.vin = ? AND t.apply_no = ? AND v.deleted = 0
       LIMIT 1`,
      [vin, applyNo]
    );
    if (!vrows.length) throw errNotFound('未匹配到对应任务，请核对 VIN 与发运申请号');
    const { task_id: taskId, task_no: taskNo } = vrows[0];

    await conn.query(
      `INSERT INTO esign_record
        (esign_id, task_id, task_no, vin, apply_no, sign_type, trigger_node, sign_party, initiate_time, sign_status, create_name, update_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'WAIT_SIGN', 'CRM 系统', 'CRM 系统')`,
      [esignId, taskId, taskNo, vin, applyNo,
       cutStr(String(b.signType ?? '物流电子签').trim(), 32) || '物流电子签',
       cutStr(String(b.triggerNode ?? '').trim(), 64) || null,
       cutStr(String(b.signParty ?? '').trim(), 128) || null]
    );
  });

  ok(res, {}, `电子签 ${esignId} 已同步，状态：待签署`);
}));

/* ======================= ③ CRM：取消前状态查询 ======================= */
// GET /api/external/shipping-tasks/cancel-check?applyNo=
router.get('/shipping-tasks/cancel-check', wrap(async (req, res) => {
  const task = await resolveTask({ applyNo: req.query.applyNo, taskNo: req.query.taskNo });
  const rule = cancelRule(task.status);
  ok(res, { taskNo: task.task_no, status: task.status, cancellable: rule.cancellable, message: rule.message });
}));

/* ======================= ④ 狮桥：电子签签收回执确认（幂等） ======================= */
// POST /api/external/esign/receipt-sync
router.post('/esign/receipt-sync', wrap(async (req, res) => {
  const esignId = String((req.body || {}).esignId ?? '').trim();
  if (!esignId) throw errParam('电子签 ID esignId 必填');
  const [rec] = await query('SELECT * FROM esign_record WHERE esign_id = ? AND deleted = 0', [esignId]);
  if (!rec) throw errNotFound(`电子签 ${esignId} 不存在`);
  // 回执确认：不改变签署状态，重复回执返回当前状态（幂等）
  ok(res, { esignId: rec.esign_id, signStatus: rec.sign_status }, '电子签回执确认成功');
}));

/* ======================= ⑥ CRM：送车发运申请取消 ======================= */
// POST /api/external/shipping-tasks/cancel （按取消规则；关联待签署电子签置 CANCELLED）
router.post('/shipping-tasks/cancel', wrap(async (req, res) => {
  const b = req.body || {};
  const result = await withTransaction(async (conn) => {
    const task = await lockTaskByRef(conn, { applyNo: b.applyNo, taskNo: b.taskNo });
    const rule = cancelRule(task.status);

    // 幂等：已取消的任务重复取消直接成功返回
    if (rule.done) {
      return { taskNo: task.task_no, status: 'CANCELLED', cancelledEsigens: 0, idempotent: true };
    }
    // 不可取消：D0001 按规则拦截（契约 3.1 取消规则）
    if (!rule.cancellable) throw errState(rule.message);

    const cancelReason = cutStr(String(b.cancelReason ?? '').trim() || 'CRM 发起取消（发运转自提）', 255);
    await conn.query(
      `UPDATE shipping_task SET status = 'CANCELLED', cancel_reason = ?, cancel_time = NOW(),
              version = version + 1, update_name = 'CRM 系统'
        WHERE id = ? AND version = ?`,
      [cancelReason, task.id, task.version]
    );
    // 关联待签署电子签同步置为已取消
    const [ec] = await conn.query(
      "UPDATE esign_record SET sign_status = 'CANCELLED', update_name = 'CRM 系统' WHERE task_id = ? AND sign_status = 'WAIT_SIGN' AND deleted = 0",
      [task.id]
    );
    await writeStatusLog(conn, {
      taskId: task.id, taskNo: task.task_no, fromStatus: task.status, toStatus: 'CANCELLED',
      source: 'CRM', operator: 'CRM 系统',
      remark: `CRM同步取消：${cancelReason}，${ec.affectedRows} 条待签署电子签置为已取消`,
    });
    return { taskNo: task.task_no, status: 'CANCELLED', cancelledEsigens: ec.affectedRows, idempotent: false };
  });

  ok(res, result, result.idempotent ? '该任务已取消，幂等处理直接返回' : '任务已取消，关联待签署电子签已置为已取消');
}));

/* ======================= ⑧ WMS：出库状态同步 ======================= */
// POST /api/external/wms/outbound-status
//   CARRIER_ACCEPTED→OUTBOUND（WMS 出库在前，司机确认提车在后）；回填 outbound_date；
//   重复回传（OUTBOUND/PICKED/IN_TRANSIT/ARRIVED/FINISHED）仅补记日志，幂等不回退。
router.post('/wms/outbound-status', wrap(async (req, res) => {
  const b = req.body || {};
  const outboundTime = parseOutboundTime(b.outboundTime);

  const result = await withTransaction(async (conn) => {
    const task = await lockTaskByRef(conn, { applyNo: b.applyNo, taskNo: b.taskNo });

    // 正常链：承运商已接单 → 已出库，回填出库日期；司机确认提车（#12 PICKUP）须在出库之后
    if (task.status === 'CARRIER_ACCEPTED') {
      await conn.query(
        `UPDATE shipping_task SET status = 'OUTBOUND', outbound_date = COALESCE(?, NOW()), version = version + 1, update_name = 'WMS 系统'
          WHERE id = ? AND version = ?`,
        [outboundTime, task.id, task.version]
      );
      await writeStatusLog(conn, {
        taskId: task.id, taskNo: task.task_no, fromStatus: 'CARRIER_ACCEPTED', toStatus: 'OUTBOUND',
        source: 'WMS', operator: 'WMS 系统', remark: 'WMS出库回传，车辆已出库；待司机确认提车（发运）',
      });
      return { taskNo: task.task_no, status: 'OUTBOUND', message: '出库回传成功，任务状态：已出库，待司机确认提车' };
    }

    // 幂等：出库重复回传/晚到回传（已出库及之后）仅补记日志，不回退状态
    if (['OUTBOUND', 'PICKED', 'IN_TRANSIT', 'ARRIVED', 'FINISHED'].includes(task.status)) {
      if (!task.outbound_date && outboundTime) {
        await conn.query('UPDATE shipping_task SET outbound_date = ?, update_name = ? WHERE id = ?', [outboundTime, 'WMS 系统', task.id]);
      }
      await writeStatusLog(conn, {
        taskId: task.id, taskNo: task.task_no, fromStatus: task.status, toStatus: task.status,
        source: 'WMS', operator: 'WMS 系统', remark: 'WMS出库状态重复回传，幂等处理仅补记日志',
      });
      return { taskNo: task.task_no, status: task.status, message: '出库状态重复回传，幂等处理仅补记日志' };
    }

    // WAIT_DISPATCH / DISPATCHED / CANCELLED：WMS 不应回传出库（任务未派发/未接单或已取消）
    throw errState(`当前任务状态不允许出库回传（${task.status}），需承运商接单后方可出库`);
  });

  ok(res, result, result.message);
}));

/* ======================= ⑩ 狮桥：司机信息同步（身份证号 UPSERT） ======================= */
// POST /api/external/drivers/sync （source=2 狮桥同步；维护 carrier_driver 多对多关联）
router.post('/drivers/sync', wrap(async (req, res) => {
  const b = req.body || {};
  const driverName = String(b.driverName ?? '').trim();
  if (!driverName) throw errParam('司机姓名 driverName 必填');
  const phone = assertPhone(b.phone, { label: '手机号 phone', mobileOnly: true });
  const idCard = assertIdCard(b.idCard, { label: '身份证号 idCard' });
  const licenseNo = b.licenseNo ? cutStr(String(b.licenseNo).trim(), 32) : null;
  const licenseType = b.licenseType ? cutStr(String(b.licenseType).trim(), 8) : null;
  const validFrom = b.licenseValidFrom ? String(b.licenseValidFrom).trim() : null;
  const validTo = b.licenseValidTo ? String(b.licenseValidTo).trim() : null;

  const result = await withTransaction(async (conn) => {
    // 按身份证号 UPSERT（新增时驾驶证有效期必填）
    const [rows] = await conn.query('SELECT * FROM driver WHERE id_card = ? AND deleted = 0 FOR UPDATE', [idCard]);
    let driverId;
    let created;
    if (rows.length) {
      // 更新：姓名以狮桥为准，身份证号不变；未传的驾驶证有效期保留原值
      driverId = rows[0].id;
      created = false;
      await conn.query(
        `UPDATE driver SET driver_name = ?, phone = ?, license_no = COALESCE(?, license_no), license_type = COALESCE(?, license_type),
                license_valid_from = COALESCE(?, license_valid_from), license_valid_to = COALESCE(?, license_valid_to),
                source = 2, update_name = '狮桥物流'
          WHERE id = ?`,
        [cutStr(driverName, 64), phone, licenseNo, licenseType, validFrom, validTo, driverId]
      );
    } else {
      if (!validFrom) throw errParam('新增司机时驾驶证有效期自 licenseValidFrom 必填');
      if (!validTo) throw errParam('新增司机时驾驶证有效期至 licenseValidTo 必填');
      if (validFrom > validTo) throw errParam('驾驶证有效期起不能晚于有效期至');
      const [r] = await conn.query(
        `INSERT INTO driver (driver_name, phone, id_card, license_no, license_type, license_valid_from, license_valid_to, source, status, create_name, update_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, 2, 1, '狮桥物流', '狮桥物流')`,
        [cutStr(driverName, 64), phone, idCard, licenseNo, licenseType, validFrom, validTo]
      );
      driverId = r.insertId;
      created = true;
    }

    // 维护司机-承运商关联（多对多；carrierId 可选）
    let carrierBound = null;
    const carrierId = b.carrierId === undefined || b.carrierId === null || b.carrierId === '' ? null : Number(b.carrierId);
    if (carrierId !== null) {
      const [crows] = await conn.query('SELECT id, carrier_name FROM carrier WHERE id = ? AND deleted = 0', [carrierId]);
      if (!crows.length) throw errNotFound(`承运商不存在（ID: ${carrierId}）`);
      await conn.query(
        `INSERT INTO carrier_driver (carrier_id, driver_id, create_name, update_name)
         VALUES (?, ?, '狮桥物流', '狮桥物流')
         ON DUPLICATE KEY UPDATE deleted = 0, update_name = VALUES(update_name)`,
        [carrierId, driverId]
      );
      carrierBound = crows[0].carrier_name;
    }
    return { driverId, idCard, created, carrierBound };
  });

  ok(res, {
    driverId: result.driverId,
    idCard: result.idCard,
    created: result.created,
    carrierBound: result.carrierBound,
  }, result.created ? '司机同步成功，已新增' : '司机同步成功，已更新（身份证号 UPSERT）');
}));

/* ======================= ⑫ 承运商通用：任务状态回传（状态机校验推进） ======================= */
// POST /api/external/shipping-tasks/status-sync
//   通用运单状态回传接口：狮桥物流及其他承运商/三方物流供应商均可调用。
//   可选 carrierName 标识回传承运商（须与任务当前承运商一致，防串单）；
//   不传按狮桥物流留痕（兼容既有对接）。
//   action=ACCEPT  承运商接单并指派司机：DISPATCHED→CARRIER_ACCEPTED，回填 driver_id；
//                  planPickupDate 主来源为 CRM（#1 必填），接单可选调整（传则覆盖，不传保持）
//   action=PICKUP  司机确认提车（=发运，含车辆照片 photos 写 status_log.remark）：
//                  OUTBOUND→PICKED 回填 ship_time（发运时间）；可选 actualPickupDate 实际提车日期
//                  （允许早于计划提车日期，但不得早于出库时间）；CARRIER_ACCEPTED（未出库）拒绝；
//                  之后重复回传仅补记日志（幂等不回退）
//   action=ARRIVE  司机到达：→ARRIVED 回填 actual_freight/mileage/arrive_time，生成 YF 运费单（FOR UPDATE 幂等）
//   action=FINISH  司机完结：ARRIVED→FINISHED 回填 finish_time，同步运费单 finish_time
router.post('/shipping-tasks/status-sync', wrap(async (req, res) => {
  const b = req.body || {};
  const action = String(b.action ?? '').trim().toUpperCase();
  if (!action) throw errParam('动作 action 必填（ACCEPT/PICKUP/ARRIVE/FINISH）');
  if (!['ACCEPT', 'PICKUP', 'ARRIVE', 'FINISH'].includes(action)) {
    throw errParam('动作 action 仅支持 ACCEPT/PICKUP/ARRIVE/FINISH');
  }

  const result = await withTransaction(async (conn) => {
    const task = await lockTaskByRef(conn, { applyNo: b.applyNo, taskNo: b.taskNo });

    // ---- 回传方身份（通用接口：任意承运商/三方物流可调；carrierName 传时须与任务承运商一致）----
    let operatorName = '狮桥物流'; // 未传身份按狮桥留痕（兼容既有对接）
    let logSource = 'SQ';
    const carrierNameParam = String(b.carrierName ?? '').trim();
    if (carrierNameParam) {
      const [crows] = await conn.query('SELECT * FROM carrier WHERE carrier_name = ? AND deleted = 0', [carrierNameParam]);
      if (!crows.length) throw errNotFound(`承运商不存在：${carrierNameParam}`);
      if (Number(crows[0].status) !== 1) throw errBiz(`该承运商已停用，不可回传：${carrierNameParam}`);
      if (task.carrier_id && Number(task.carrier_id) !== Number(crows[0].id)) {
        throw errBiz(`回传方（${carrierNameParam}）与任务当前承运商不一致，不可回传`);
      }
      operatorName = crows[0].carrier_name;
      logSource = 'CARRIER';
    }

    /* ---- 承运商接单并分配司机 ---- */
    if (action === 'ACCEPT') {
      const driverId = b.driverId === undefined || b.driverId === null || b.driverId === '' ? null : Number(b.driverId);
      if (!driverId) throw errParam('接单必须分配司机 driverId');
      // 计划提车日期主来源为 CRM 随申请下发（#1 必填）；接单时可选调整（传则校验格式并覆盖）
      if (b.planPickupDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.planPickupDate).trim())) {
        throw errParam('计划提车日期 planPickupDate 格式不正确，应为 YYYY-MM-DD');
      }
      const planPickupDate = b.planPickupDate ? String(b.planPickupDate).trim() : null;
      // 司机校验：存在、启用（停用拦截新分派，既有需求 10）、属于任务承运商（carrier_driver 多对多）
      const [drows] = await conn.query('SELECT * FROM driver WHERE id = ? AND deleted = 0', [driverId]);
      if (!drows.length) throw errNotFound(`司机不存在（ID: ${driverId}）`);
      const driver = drows[0];
      if (Number(driver.status) !== 1) throw errBiz('该司机已停用，不可分派任务');
      if (task.carrier_id) {
        const [cdrows] = await conn.query(
          'SELECT id FROM carrier_driver WHERE driver_id = ? AND carrier_id = ? AND deleted = 0',
          [driverId, task.carrier_id]
        );
        if (!cdrows.length) throw errBiz('该司机不属于任务当前承运商，不可接单');
      }

      if (task.status === 'DISPATCHED') {
        await conn.query(
          `UPDATE shipping_task SET status = 'CARRIER_ACCEPTED', driver_id = ?,
                  plan_pickup_date = COALESCE(?, plan_pickup_date), version = version + 1, update_name = ?
            WHERE id = ? AND version = ?`,
          [driverId, planPickupDate, operatorName, task.id, task.version]
        );
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: 'DISPATCHED', toStatus: 'CARRIER_ACCEPTED',
          source: logSource, operator: operatorName,
          remark: `承运商确认接单，分配司机：${driver.driver_name}${planPickupDate ? `，计划提车调整为 ${planPickupDate}` : ''}`,
        });
        return { taskNo: task.task_no, status: 'CARRIER_ACCEPTED', message: `接单成功，已分配司机：${driver.driver_name}` };
      }
      // 幂等：已接单及之后重复回传，仅补记日志（可补填司机）
      if (['CARRIER_ACCEPTED', 'PICKED', 'OUTBOUND', 'IN_TRANSIT', 'ARRIVED', 'FINISHED'].includes(task.status)) {
        if (!task.driver_id) {
          await conn.query('UPDATE shipping_task SET driver_id = ?, update_name = ? WHERE id = ?', [driverId, operatorName, task.id]);
        }
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: task.status, toStatus: task.status,
          source: logSource, operator: operatorName, remark: `接单状态重复回传，幂等处理仅补记日志（司机：${driver.driver_name}）`,
        });
        return { taskNo: task.task_no, status: task.status, message: '接单状态重复回传，幂等处理仅补记日志' };
      }
      throw errState(`当前任务状态不允许接单（${task.status}），仅「已派单」可接单`);
    }

    /* ---- 司机确认提车（=发运，回填 ship_time 发运时间；photos 写 status_log.remark） ---- */
    if (action === 'PICKUP') {
      const photos = Array.isArray(b.photos) ? b.photos : null;
      const photoRemark = photosToRemark(photos);
      // 实际提车日期 = 发运时间：选填 YYYY-MM-DD，允许早于计划提车日期（提前提车），
      // 但不得早于出库时间（WMS 出库后方可提车），缺省取当前时间
      if (b.actualPickupDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.actualPickupDate).trim())) {
        throw errParam('实际提车日期 actualPickupDate 格式不正确，应为 YYYY-MM-DD');
      }
      const shipTime = b.actualPickupDate ? String(b.actualPickupDate).trim() : null;
      const photoNote = photos ? `，${photos.length} 张提车照片已同步` : '';

      // 出库未完成：车辆尚未出库，司机不可确认提车
      if (task.status === 'CARRIER_ACCEPTED') {
        throw errState('车辆尚未出库，WMS 出库回传后方可确认提车');
      }

      // 正常链：已出库 → 已提车（司机确认提车/发运，车辆照片留痕）
      if (task.status === 'OUTBOUND') {
        if (shipTime && task.outbound_date) {
          const outboundDay = String(task.outbound_date).slice(0, 10);
          if (shipTime < outboundDay) {
            throw errBiz(`发运时间（实际提车日期 ${shipTime}）不能早于出库时间（${outboundDay}），WMS 出库后方可提车`);
          }
        }
        await conn.query(
          `UPDATE shipping_task SET status = 'PICKED', ship_time = COALESCE(?, NOW()), version = version + 1, update_name = ?
            WHERE id = ? AND version = ?`,
          [shipTime, operatorName, task.id, task.version]
        );
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: 'OUTBOUND', toStatus: 'PICKED',
          source: logSource, operator: operatorName,
          remark: cutStr(`司机确认提车（发运）${shipTime ? `，发运时间 ${shipTime}（可早于计划提车日期）` : ''}${photoNote}${photoRemark ? `；${photoRemark}` : ''}`, 255),
        });
        return { taskNo: task.task_no, status: 'PICKED', message: '提车确认成功，任务状态：已提车，照片已留痕' };
      }

      // 幂等：已提车/在途/已到达/已完结重复回传，仅补记日志 + 补 ship_time，不回退状态
      if (['PICKED', 'IN_TRANSIT', 'ARRIVED', 'FINISHED'].includes(task.status)) {
        if (!task.ship_time) {
          await conn.query('UPDATE shipping_task SET ship_time = COALESCE(?, NOW()), update_name = ? WHERE id = ?', [shipTime, operatorName, task.id]);
        }
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: task.status, toStatus: task.status,
          source: logSource, operator: operatorName,
          remark: cutStr(`提车状态重复回传，幂等处理仅补记日志、不回退状态${photoRemark ? `；${photoRemark}` : ''}`, 255),
        });
        return { taskNo: task.task_no, status: task.status, message: '提车状态重复回传，幂等处理仅补记日志' };
      }
      throw errState(`当前任务状态不允许提车确认（${task.status}），需「已出库」后方可确认提车`);
    }

    /* ---- 司机到达（回填运费/里程，生成 YF 运费单 FOR UPDATE 幂等） ---- */
    if (action === 'ARRIVE') {
      if (!['PICKED', 'IN_TRANSIT', 'ARRIVED', 'FINISHED'].includes(task.status)) {
        throw errState(`当前任务状态不允许到达（${task.status}），车辆尚未提车发运`);
      }
      const actualFreight = (b.actualFreight === undefined || b.actualFreight === null || b.actualFreight === '')
        ? null
        : assertAmount(b.actualFreight, { label: '实际运费 actualFreight' });
      const mileage = (b.mileage === undefined || b.mileage === null || b.mileage === '')
        ? null
        : assertAmount(b.mileage, { label: '里程 mileage' });
      const finalFreight = actualFreight ?? Number(task.plan_freight) ?? 0; // 未传用计划运费

      let freightNo = null;
      let billCreated = false;
      if (task.status !== 'ARRIVED' && task.status !== 'FINISHED') {
        await conn.query(
          `UPDATE shipping_task SET status = 'ARRIVED', arrive_time = NOW(), actual_freight = ?,
                  version = version + 1, update_name = ?
            WHERE id = ? AND version = ?`,
          [finalFreight, operatorName, task.id, task.version]
        );
        // 同步回填车辆明细实际运费（多车任务按台数均分至单台展示口径）
        const [vc] = await conn.query('SELECT COUNT(*) AS n FROM shipping_task_vehicle WHERE task_id = ? AND deleted = 0', [task.id]);
        const vehicleCount = Number(vc[0].n);
        if (vehicleCount > 0) {
          await conn.query(
            'UPDATE shipping_task_vehicle SET actual_freight = ?, update_name = ? WHERE task_id = ? AND deleted = 0',
            [Number((finalFreight / vehicleCount).toFixed(2)), operatorName, task.id]
          );
        }
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: task.status, toStatus: 'ARRIVED',
          source: logSource, operator: operatorName,
          remark: `司机确认到达，实际运费 ${finalFreight.toFixed(2)} 元${mileage ? `，里程 ${mileage} 公里` : ''}`,
        });
      } else {
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: task.status, toStatus: task.status,
          source: logSource, operator: operatorName, remark: '到达状态重复回传，幂等处理仅补记日志',
        });
      }

      // 生成运费结算单（FOR UPDATE 幂等：已存在则不重复生成）
      const [bills] = await conn.query('SELECT * FROM freight_bill WHERE task_id = ? AND deleted = 0 FOR UPDATE', [task.id]);
      if (bills.length) {
        freightNo = bills[0].freight_no;
      } else {
        freightNo = await nextSeq('YF', conn); // 运费单号 YF+yyyyMMdd+4 位
        await conn.query(
          `INSERT INTO freight_bill
            (freight_no, task_id, task_no, carrier_id, driver_id, start_location, end_location, mileage,
             plan_freight, actual_freight, reconcile_status, create_name, update_name)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [freightNo, task.id, task.task_no, task.carrier_id, task.driver_id,
           task.ship_location, task.delivery_address || task.delivery_area,
           mileage, task.plan_freight, finalFreight, operatorName, operatorName]
        );
        billCreated = true;
      }
      return {
        taskNo: task.task_no, status: task.status === 'ARRIVED' || task.status === 'FINISHED' ? task.status : 'ARRIVED',
        actualFreight: finalFreight, mileage, freightNo, billCreated,
        message: `到达确认成功${billCreated ? `，已生成运费结算单 ${freightNo}（待对账）` : `，运费单 ${freightNo} 已存在（幂等）`}`,
      };
    }

    /* ---- 司机完结（同步运费单 finish_time） ---- */
    if (action === 'FINISH') {
      if (task.status === 'ARRIVED') {
        await conn.query(
          `UPDATE shipping_task SET status = 'FINISHED', finish_time = NOW(), version = version + 1, update_name = ?
            WHERE id = ? AND version = ?`,
          [operatorName, task.id, task.version]
        );
        await conn.query('UPDATE freight_bill SET finish_time = NOW(), update_name = ? WHERE task_id = ? AND deleted = 0', [operatorName, task.id]);
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: 'ARRIVED', toStatus: 'FINISHED',
          source: logSource, operator: operatorName, remark: '司机与客户完成交接，运单完结，已同步运费单完结时间',
        });
        return { taskNo: task.task_no, status: 'FINISHED', message: '任务已完结，运费单完结时间已同步' };
      }
      if (task.status === 'FINISHED') {
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: 'FINISHED', toStatus: 'FINISHED',
          source: logSource, operator: operatorName, remark: '完结状态重复回传，幂等处理仅补记日志',
        });
        return { taskNo: task.task_no, status: 'FINISHED', message: '完结状态重复回传，幂等处理仅补记日志' };
      }
      throw errState(`当前任务状态不允许完结（${task.status}），仅「已到达」可完结`);
    }
  });

  ok(res, result, result.message);
}));

/* ======================= ⑭ 狮桥：电子签签署状态同步 ======================= */
// POST /api/external/esign/sign-status  （WAIT_SIGN→SIGNED 回填 sign_time / CANCELLED）
router.post('/esign/sign-status', wrap(async (req, res) => {
  const b = req.body || {};
  const esignId = String(b.esignId ?? '').trim();
  const signStatus = String(b.signStatus ?? '').trim().toUpperCase();
  if (!esignId) throw errParam('电子签 ID esignId 必填');
  if (!['SIGNED', 'CANCELLED'].includes(signStatus)) throw errParam('签署状态 signStatus 仅支持 SIGNED / CANCELLED');

  const result = await withTransaction(async (conn) => {
    const [rows] = await conn.query('SELECT * FROM esign_record WHERE esign_id = ? AND deleted = 0 FOR UPDATE', [esignId]);
    if (!rows.length) throw errNotFound(`电子签 ${esignId} 不存在`);
    const rec = rows[0];

    // 幂等：已是目标状态直接返回
    if (rec.sign_status === signStatus) {
      return { esignId, signStatus, signTime: rec.sign_time, idempotent: true };
    }
    if (rec.sign_status !== 'WAIT_SIGN') {
      throw errState(`该电子签当前状态为 ${rec.sign_status}，不可变更为 ${signStatus}（仅「待签署」可流转）`);
    }

    await conn.query(
      `UPDATE esign_record SET sign_status = ?, sign_time = IF(? = 'SIGNED', NOW(), NULL), update_name = '狮桥物流' WHERE id = ?`,
      [signStatus, signStatus, rec.id]
    );
    const [after] = await conn.query('SELECT sign_time FROM esign_record WHERE id = ?', [rec.id]);
    return { esignId, signStatus, signTime: after[0].sign_time, idempotent: false };
  });

  ok(res, { esignId: result.esignId, signStatus: result.signStatus, signTime: result.signTime },
    result.idempotent ? '签署状态与当前一致，幂等处理直接返回' : (result.signStatus === 'SIGNED' ? '签署完成' : '电子签已取消'));
}));

/* ======================= 辅助：统一定位 + 行锁 ======================= */
/** 统一定位并锁定任务（FOR UPDATE）：applyNo 优先 taskNo 兼容 */
async function lockTaskByRef(conn, { applyNo, taskNo }) {
  const apply = String(applyNo ?? '').trim();
  const no = String(taskNo ?? '').trim();
  if (!apply && !no) throw errParam('请提供发运申请号 applyNo（推荐）或任务单号 taskNo');
  const [rows] = await conn.query(
    `SELECT * FROM shipping_task WHERE ${apply ? 'apply_no = ?' : 'task_no = ?'} AND deleted = 0 FOR UPDATE`,
    [apply || no]
  );
  if (!rows.length) {
    throw errNotFound(apply ? `发运申请号 ${apply} 对应的任务不存在` : `任务单号 ${no} 对应的任务不存在`);
  }
  return rows[0];
}

module.exports = router;
