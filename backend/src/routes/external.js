/**
 * 外部系统接口（契约第 6 节，前缀 /api/external，camelCase，均幂等，不走登录态）
 *
 * 调用方与接口清单：
 *   CRM  ① POST /shipping-tasks/receive        发运申请任务接收（applyNo 幂等 C0001，taskNo 自动生成）
 *   CRM  ② POST /esign/sync                     物流电子签同步（esignId 幂等，VIN+applyNo 匹配，vin 查车辆明细表）
 *   CRM  ③ GET  /shipping-tasks/cancel-check    送车发运申请取消前状态查询
 *   狮桥 ④ POST /esign/receipt-sync             物流电子签签收回执确认（幂等）
 *   CRM  ⑥ POST /shipping-tasks/cancel          送车发运申请取消（按取消规则，关联待签署电子签置 CANCELLED）
 *   WMS  ⑧ POST /wms/outbound-status            WMS 出库状态同步（PICKED→OUTBOUND→IN_TRANSIT，司机提车在前、仓库出库在后）
 *   狮桥 ⑩ POST /drivers/sync                   司机信息同步（支持单条/批量，身份证号 UPSERT，source=2，维护 carrier_driver）
 *   狮桥 ⑪ POST /tracking/report                在途点位上报（写 transport_track，仅记录轨迹不改状态）
 *   狮桥 ⑫ POST /shipping-tasks/accept          承运商接单（DISPATCHED→CARRIER_ACCEPTED，分配司机）
 *   狮桥 ⑫ POST /shipping-tasks/pickup          司机提车（CARRIER_ACCEPTED→PICKED，含提车照片）
 *   狮桥 ⑫ POST /shipping-tasks/arrive          司机到达（IN_TRANSIT→ARRIVED，回填实际运费/里程）
 *   狮桥 ⑫ POST /shipping-tasks/finish          司机完结（ARRIVED→FINISHED）
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
const { hashPassword } = require('../services/security');

const router = Router();

/* ======================= 通用辅助 ======================= */

/**
 * 外部回调统一定位任务（非事务版）：优先 orderNo（一车一单唯一标识），其次 taskNo，兼容 applyNo（须唯一对应单任务）。
 */
async function resolveTask({ orderNo, applyNo, taskNo }) {
  const order = String(orderNo ?? '').trim();
  const apply = String(applyNo ?? '').trim();
  const no = String(taskNo ?? '').trim();
  if (!order && !no && !apply) throw errParam('请提供订单号 orderNo（推荐）、任务单号 taskNo 或发运申请号 applyNo');
  let rows;
  if (order) {
    rows = await query('SELECT * FROM shipping_task WHERE order_no = ? AND deleted = 0', [order]);
    if (!rows.length) throw errNotFound(`订单号 ${order} 对应的任务不存在`);
    return rows[0];
  }
  if (no) {
    rows = await query('SELECT * FROM shipping_task WHERE task_no = ? AND deleted = 0', [no]);
    if (!rows.length) throw errNotFound(`任务单号 ${no} 对应的任务不存在`);
    return rows[0];
  }
  rows = await query('SELECT * FROM shipping_task WHERE apply_no = ? AND deleted = 0 ORDER BY id', [apply]);
  if (!rows.length) throw errNotFound(`发运申请号 ${apply} 对应的任务不存在`);
  if (rows.length > 1) throw errParam(`发运申请号 ${apply} 对应 ${rows.length} 条任务，请改用订单号 orderNo 定位具体车辆`);
  return rows[0];
}

/** 写任务状态流转日志（from_status 初始为 NULL；source: STP/CRM/SQ/WMS） */
async function writeStatusLog(conn, { taskId, taskNo, fromStatus, toStatus, source, operator, remark, photos }) {
  await conn.query(
    `INSERT INTO task_status_log (task_id, task_no, from_status, to_status, source, operator, remark, photos, create_name, update_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [taskId, taskNo, fromStatus ?? null, toStatus, source, operator, cutStr(remark, 255),
      photos && photos.length ? JSON.stringify(photos) : null, operator, operator]
  );
}

/** 提车照片入参规范化：去空、去重、仅接受 http(s) URL */
function normalizePhotos(photos) {
  if (!Array.isArray(photos)) return null;
  const list = [...new Set(photos.map((p) => String(p ?? '').trim()).filter((p) => /^https?:\/\//i.test(p)))];
  return list.length ? list : null;
}

/** 时间入参解析：未传返回 null（交给 SQL 默认值），格式非法抛 A0001 */
function parseDateTime(v, label = '时间') {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(String(v).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) throw errParam(`${label}格式不正确`);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 本地当前时间 YYYY-MM-DD HH:mm:ss（与 parseDateTime 输出同格式，可直接字符串比较） */
function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 节点时间不得晚于当前时间（禁止未来时间回传） */
function assertNotFuture(timeStr, label) {
  if (timeStr && timeStr > nowStr()) throw errParam(`${label} 不能晚于当前时间（${nowStr()}）`);
}

/** 流程时间须向后：当前节点时间不得早于上一节点时间 */
function assertNotBefore(timeStr, prevTime, { label, prevLabel }) {
  if (!timeStr || !prevTime) return;
  const prev = String(prevTime);
  if (timeStr < prev) throw errBiz(`${label}（${timeStr}）不能早于${prevLabel}（${prev}）`);
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
  // 一车一单：一台车 = 一个订单任务；一个发运申请（applyNo）可含多台车，按 VIN 拆成多条任务
  if (b.vehicles.length > 200) throw errParam('单次发运申请车辆数不能超过 200 台');
  const seenVin = new Set();
  const seenOrder = new Set();
  b.vehicles.forEach((v, i) => {
    const vin = String(v?.vin ?? '').trim();
    if (!vin) throw errParam(`第 ${i + 1} 台车的 VIN 必填`);
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) throw errParam(`第 ${i + 1} 台车的 VIN 格式不正确，应为 17 位`);
    const vinUp = vin.toUpperCase();
    if (seenVin.has(vinUp)) throw errParam(`VIN ${vinUp} 在本次申请中重复`);
    seenVin.add(vinUp);
    // 订单号：一车一单的唯一标识，必填且全局唯一
    const orderNo = String(v?.orderNo ?? '').trim();
    if (!orderNo) throw errParam(`第 ${i + 1} 台车的订单号 orderNo 必填（一车一单）`);
    if (seenOrder.has(orderNo)) throw errParam(`订单号 ${orderNo} 在本次申请中重复`);
    seenOrder.add(orderNo);
  });
  if (b.remark && String(b.remark).length > 500) throw errParam('备注 remark 不能超过 500 字');
  // CRM 操作人账号：随申请推送，状态日志「操作人」展示用；缺省记「CRM 系统」
  const operator = cutStr(String(b.operator ?? '').trim(), 64) || 'CRM 系统';

  const salesPhone = assertPhone(b.salesPhone, { label: '销售人员电话 salesPhone', required: false });
  const receiverPhone = assertPhone(b.receiverPhone, { label: '接车人电话 receiverPhone', required: false });
  const receiverName = cutStr(String(b.receiverName ?? '').trim(), 64) || null;
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

  // ---- orderNo 全局唯一校验（一车一单，跨申请也不可重复）----
  const orderNos = b.vehicles.map((v) => String(v.orderNo).trim());
  const dupOrders = await query(
    `SELECT order_no, task_no FROM shipping_task WHERE order_no IN (${orderNos.map(() => '?').join(',')}) AND deleted = 0`,
    orderNos
  );
  if (dupOrders.length) {
    throw errDup(`订单号 ${dupOrders[0].order_no} 已下发过，任务单号 ${dupOrders[0].task_no}，请勿重复下发`);
  }

  // 里程：CRM 发运申请下发（线路里程），到达回传可覆盖
  const mileage = assertAmount(b.mileage, { label: '里程 mileage', required: false });

  // ---- 按 VIN 拆任务：一台车一条任务，applyNo 共享，orderNo 各自唯一 ----
  const results = [];
  for (let i = 0; i < b.vehicles.length; i++) {
    const v = b.vehicles[i];
    const vin = String(v.vin).trim().toUpperCase();
    const orderNo = String(v.orderNo).trim();
    const vehicleFreight = (v.planFreight === undefined || v.planFreight === null || v.planFreight === '')
      ? (b.planFreight === undefined || b.planFreight === null || b.planFreight === '' ? null : assertAmount(b.planFreight, { label: '计划运费 planFreight' }))
      : assertAmount(v.planFreight, { label: `第 ${i + 1} 台车计划运费 planFreight` });

    const taskNo = await withTransaction(async (conn) => {
      const no = await nextSeq('FY', conn); // 任务单号 FY+yyyyMMdd+4 位（系统自动生成）
      const [r] = await conn.query(
        `INSERT INTO shipping_task
          (task_no, apply_no, order_no, customer_name, region, sales_person, sales_phone, delivery_area, delivery_address,
           receiver_name, receiver_phone, factory, storage_location, ship_method, ship_location, plan_pickup_date,
           plan_freight, mileage, status, remark, create_name, update_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAIT_DISPATCH', ?, 'CRM 系统', 'CRM 系统')`,
        [no, applyNo, cutStr(orderNo, 64), cutStr(customerName, 128),
         cutStr(String(b.region ?? '').trim(), 64) || null,
         cutStr(String(b.salesPerson ?? '').trim(), 64) || null,
         salesPhone,
         cutStr(String(b.deliveryArea ?? '').trim(), 128) || null,
         cutStr(deliveryAddress, 255),
         receiverName,
         receiverPhone,
         cutStr(factory, 128),
         cutStr(storageLocation, 128),
         cutStr(String(b.shipMethod ?? '送车').trim(), 16) || '送车',
         cutStr(headShipLocation || String(v?.shipLocation ?? '').trim(), 128),
         b.planPickupDate ? String(b.planPickupDate).trim() : null,
         vehicleFreight,
         mileage,
         cutStr(String(b.remark ?? '').trim(), 500) || null]
      );
      const taskId = r.insertId;

      // 车辆明细：一车一单，仅 1 台车
      await conn.query(
        `INSERT INTO shipping_task_vehicle
          (task_id, task_no, vin, order_no, report_no, plan_freight, actual_freight, ship_location,
           vehicle_model, engine_config, cabin_type, create_name, update_name)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'CRM 系统', 'CRM 系统')`,
        [taskId, no, vin, cutStr(orderNo, 64),
         v.reportNo ? cutStr(String(v.reportNo).trim(), 64) : null,
         vehicleFreight,
         v.shipLocation ? cutStr(String(v.shipLocation).trim(), 128) : (headShipLocation ? cutStr(headShipLocation, 128) : null),
         v.vehicleModel ? cutStr(String(v.vehicleModel).trim(), 64) : null,
         v.engineConfig ? cutStr(String(v.engineConfig).trim(), 64) : null,
         v.cabinType ? cutStr(String(v.cabinType).trim(), 32) : null]
      );

      await writeStatusLog(conn, {
        taskId, taskNo: no, fromStatus: null, toStatus: 'WAIT_DISPATCH',
        source: 'CRM', operator,
        remark: `接收CRM发运申请，生成待派单任务（VIN ${vin}，订单号 ${orderNo}）`,
      });
      return no;
    });
    results.push({ taskNo, orderNo, vin });
  }

  const first = results[0];
  ok(res, {
    applyNo,
    total: results.length,
    taskNo: first.taskNo,
    orderNo: first.orderNo,
    mileage,
    tasks: results,
  }, `发运申请接收成功，已生成 ${results.length} 条待派单任务`);
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
  const task = await resolveTask({ orderNo: req.query.orderNo, applyNo: req.query.applyNo, taskNo: req.query.taskNo });
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
  // CRM 操作人账号：随取消推送，状态日志「操作人」展示用；缺省记「CRM 系统」
  const operator = cutStr(String(b.operator ?? '').trim(), 64) || 'CRM 系统';
  const result = await withTransaction(async (conn) => {
    const task = await lockTaskByRef(conn, { orderNo: b.orderNo, applyNo: b.applyNo, taskNo: b.taskNo });
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
      source: 'CRM', operator,
      remark: `CRM同步取消：${cancelReason}，${ec.affectedRows} 条待签署电子签置为已取消`,
    });
    return { taskNo: task.task_no, status: 'CANCELLED', cancelledEsigens: ec.affectedRows, idempotent: false };
  });

  ok(res, result, result.idempotent ? '该任务已取消，幂等处理直接返回' : '任务已取消，关联待签署电子签已置为已取消');
}));

/* ======================= ⑧ WMS：出库状态同步 ======================= */
// POST /api/external/wms/outbound-status
//   PICKED→OUTBOUND→IN_TRANSIT（司机先办提车、仓库后出库，出库完成后直接进入在途）；回填 outbound_date；
//   未提车不可出库；重复回传（已出库及之后）仅补记日志，幂等不回退。
router.post('/wms/outbound-status', wrap(async (req, res) => {
  const b = req.body || {};
  const outboundTime = parseDateTime(b.outboundTime, '出库时间 outboundTime');
  assertNotFuture(outboundTime, '出库时间 outboundTime');

  const result = await withTransaction(async (conn) => {
    const task = await lockTaskByRef(conn, { orderNo: b.orderNo, applyNo: b.applyNo, taskNo: b.taskNo });

    // 正常链：已提车 → 已出库 → 在途（提车在前、出库在后，出库完成即发车进入在途）
    if (task.status === 'PICKED') {
      assertNotBefore(outboundTime, task.ship_time, { label: '出库时间', prevLabel: '提车发运时间' });
      await conn.query(
        `UPDATE shipping_task SET status = 'IN_TRANSIT', outbound_date = COALESCE(?, NOW()), version = version + 1, update_name = 'WMS 系统'
          WHERE id = ? AND version = ?`,
        [outboundTime, task.id, task.version]
      );
      await writeStatusLog(conn, {
        taskId: task.id, taskNo: task.task_no, fromStatus: 'PICKED', toStatus: 'OUTBOUND',
        source: 'WMS', operator: 'WMS 系统', remark: 'WMS出库回传，车辆已出库',
      });
      await writeStatusLog(conn, {
        taskId: task.id, taskNo: task.task_no, fromStatus: 'OUTBOUND', toStatus: 'IN_TRANSIT',
        source: 'WMS', operator: 'WMS 系统', remark: '出库完成，车辆已进入在途运输',
      });
      return { taskNo: task.task_no, status: 'IN_TRANSIT', message: '出库回传成功，任务状态：在途' };
    }

    // 未办提车：司机须先确认提车（发运），仓库方可出库
    if (task.status === 'CARRIER_ACCEPTED') {
      throw errState('司机尚未办理提车，提车确认后方可出库');
    }

    // 幂等：出库重复回传/晚到回传（已出库及之后）仅补记日志，不回退状态
    if (['OUTBOUND', 'IN_TRANSIT', 'ARRIVED', 'FINISHED'].includes(task.status)) {
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
    throw errState(`当前任务状态不允许出库回传（${task.status}），需司机提车后方可出库`);
  });

  ok(res, result, result.message);
}));

/* ======================= ⑩ 狮桥：司机信息同步（身份证号 UPSERT，支持单条/批量） ======================= */
/**
 * 入参归一化：兼容 camelCase（狮桥标准）与 snake_case（内部管理接口同款）两种命名
 * 同义字段 camelCase 优先，便于既有对接零改动迁移
 */
function normalizeDriverInput(raw) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = raw[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  };
  return {
    externalDriverId: pick('externalDriverId', 'external_driver_id'),
    driverName: pick('driverName', 'driver_name', 'name'),
    phone: pick('phone'),
    idCard: pick('idCard', 'id_card'),
    licenseNo: pick('licenseNo', 'license_no'),
    licenseType: pick('licenseType', 'license_type'),
    licenseValidFrom: pick('licenseValidFrom', 'license_valid_from'),
    licenseValidTo: pick('licenseValidTo', 'license_valid_to'),
    externalCarrierId: pick('externalCarrierId', 'external_carrier_id'),
    carrierId: pick('carrierId', 'carrier_id'),
    carrierIds: pick('carrierIds', 'carrier_ids'),
  };
}

/**
 * 司机登录账号：狮桥同步的司机需能登录小程序，无账号时按默认密码补建；
 * 已存在则同步姓名/手机号（手机号被其他司机账号占用时不动，避免唯一索引冲突）
 */
async function ensureDriverAccount(conn, { driverId, driverName, phone }) {
  const name = cutStr(driverName, 64);
  const [byDriver] = await conn.query(
    "SELECT id FROM sys_account WHERE driver_id = ? AND account_type = 'DRIVER' AND deleted = 0",
    [driverId]
  );
  if (byDriver.length) {
    const accountId = byDriver[0].id;
    const [conflict] = await conn.query(
      "SELECT id FROM sys_account WHERE phone = ? AND account_type = 'DRIVER' AND deleted = 0 AND id <> ?",
      [phone, accountId]
    );
    if (conflict.length) {
      await conn.query(
        'UPDATE sys_account SET display_name = ?, update_name = ? WHERE id = ?',
        [name, '狮桥物流', accountId]
      );
    } else {
      await conn.query(
        'UPDATE sys_account SET display_name = ?, phone = ?, update_name = ? WHERE id = ?',
        [name, phone, '狮桥物流', accountId]
      );
    }
    return accountId;
  }
  // 手机号已有司机账号（如司机档案重建）：直接关联到当前司机
  const [byPhone] = await conn.query(
    "SELECT id FROM sys_account WHERE phone = ? AND account_type = 'DRIVER' AND deleted = 0",
    [phone]
  );
  if (byPhone.length) {
    const accountId = byPhone[0].id;
    await conn.query(
      'UPDATE sys_account SET driver_id = ?, display_name = ?, update_name = ? WHERE id = ?',
      [driverId, name, '狮桥物流', accountId]
    );
    return accountId;
  }
  const [r] = await conn.query(
    `INSERT INTO sys_account
      (account_type, phone, password_hash, display_name, driver_id, role, status, create_name, update_name)
     VALUES ('DRIVER', ?, ?, ?, ?, 'DRIVER001', 1, '狮桥物流', '狮桥物流')`,
    [phone, hashPassword(process.env.DEFAULT_DRIVER_PASSWORD || '123456'), name, driverId]
  );
  return r.insertId;
}

/**
 * 单条司机同步：校验 + UPSERT + 承运商关联，调用方需提供事务连接
 * 匹配优先级：externalDriverId（第三方ID）→ idCard（身份证号）
 */
async function syncOneDriver(conn, raw) {
  const b = normalizeDriverInput(raw);
  const driverName = String(b.driverName ?? '').trim();
  if (!driverName) throw errParam('司机姓名 driverName 必填');
  const phone = assertPhone(b.phone, { label: '手机号 phone', mobileOnly: true });
  const idCard = assertIdCard(b.idCard, { label: '身份证号 idCard' });
  const licenseNo = b.licenseNo ? cutStr(String(b.licenseNo).trim(), 32) : null;
  const licenseType = b.licenseType ? cutStr(String(b.licenseType).trim(), 8) : null;
  const validFrom = b.licenseValidFrom ? String(b.licenseValidFrom).trim() : null;
  const validTo = b.licenseValidTo ? String(b.licenseValidTo).trim() : null;
  // 第三方司机ID（外部系统主键）：UPSERT 优先按它匹配，未传时退回身份证号（兼容既有对接）
  const externalDriverId = b.externalDriverId ? cutStr(String(b.externalDriverId).trim(), 64) : null;

  // 优先按第三方司机ID匹配，其次按身份证号（新增时驾驶证有效期必填）
  let rows = [];
  if (externalDriverId) {
    [rows] = await conn.query('SELECT * FROM driver WHERE external_driver_id = ? AND deleted = 0 FOR UPDATE', [externalDriverId]);
  }
  if (!rows.length) {
    [rows] = await conn.query('SELECT * FROM driver WHERE id_card = ? AND deleted = 0 FOR UPDATE', [idCard]);
  }
  let driverId;
  let created;
  if (rows.length) {
    // 更新：姓名以狮桥为准，身份证号不变；未传的驾驶证有效期保留原值
    driverId = rows[0].id;
    created = false;
    // 第三方ID与其他司机冲突时拦截（唯一索引兜底）
    if (externalDriverId && rows[0].external_driver_id && rows[0].external_driver_id !== externalDriverId) {
      throw errBiz(`第三方司机ID ${externalDriverId} 已被其他司机占用`);
    }
    await conn.query(
      `UPDATE driver SET driver_name = ?, phone = ?, license_no = COALESCE(?, license_no), license_type = COALESCE(?, license_type),
              license_valid_from = COALESCE(?, license_valid_from), license_valid_to = COALESCE(?, license_valid_to),
              external_driver_id = COALESCE(?, external_driver_id), source = 2, update_name = '狮桥物流'
        WHERE id = ?`,
      [cutStr(driverName, 64), phone, licenseNo, licenseType, validFrom, validTo, externalDriverId, driverId]
    );
  } else {
    if (!validFrom) throw errParam('新增司机时驾驶证有效期自 licenseValidFrom 必填');
    if (!validTo) throw errParam('新增司机时驾驶证有效期至 licenseValidTo 必填');
    if (validFrom > validTo) throw errParam('驾驶证有效期起不能晚于有效期至');
    const [r] = await conn.query(
      `INSERT INTO driver (driver_name, external_driver_id, phone, id_card, license_no, license_type, license_valid_from, license_valid_to, source, status, create_name, update_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2, 1, '狮桥物流', '狮桥物流')`,
      [cutStr(driverName, 64), externalDriverId, phone, idCard, licenseNo, licenseType, validFrom, validTo]
    );
    driverId = r.insertId;
    created = true;
  }

  // 维护司机-承运商关联（多对多：carrier_ids 数组 > carrierId > externalCarrierId）
  let carrierBound = null;
  let carrierIds = Array.isArray(b.carrierIds)
    ? b.carrierIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (!carrierIds.length) {
    let carrierId = b.carrierId === undefined || b.carrierId === null || b.carrierId === '' ? null : Number(b.carrierId);
    const externalCarrierId = b.externalCarrierId ? String(b.externalCarrierId).trim() : null;
    if (carrierId === null && externalCarrierId) {
      const [crows] = await conn.query('SELECT id FROM carrier WHERE external_carrier_id = ? AND deleted = 0', [externalCarrierId]);
      if (!crows.length) throw errNotFound(`第三方承运商ID ${externalCarrierId} 对应的承运商不存在`);
      carrierId = Number(crows[0].id);
    }
    if (carrierId !== null) carrierIds = [carrierId];
  }
  if (carrierIds.length) {
    const boundNames = [];
    for (const id of [...new Set(carrierIds)]) {
      const [crows] = await conn.query('SELECT id, carrier_name FROM carrier WHERE id = ? AND deleted = 0', [id]);
      if (!crows.length) throw errNotFound(`承运商不存在（ID: ${id}）`);
      await conn.query(
        `INSERT INTO carrier_driver (carrier_id, driver_id, create_name, update_name)
         VALUES (?, ?, '狮桥物流', '狮桥物流')
         ON DUPLICATE KEY UPDATE deleted = 0, update_name = VALUES(update_name)`,
        [id, driverId]
      );
      boundNames.push(crows[0].carrier_name);
    }
    carrierBound = boundNames.join('、');
  }
  await ensureDriverAccount(conn, { driverId, driverName, phone });
  return { driverId, idCard, externalDriverId, created, carrierBound };
}

const DRIVER_SYNC_BATCH_MAX = 200;

// POST /api/external/drivers/sync
//   单条：body 为司机对象（兼容原结构）
//   批量：body 为数组，或 { drivers: [...] }；逐条独立事务，单条失败不影响其余
router.post('/drivers/sync', wrap(async (req, res) => {
  const b = req.body || {};
  const batch = Array.isArray(b) ? b : (Array.isArray(b.drivers) ? b.drivers : null);

  if (!batch) {
    const result = await withTransaction((conn) => syncOneDriver(conn, b));
    return ok(res, {
      driverId: result.driverId,
      externalDriverId: result.externalDriverId,
      idCard: result.idCard,
      created: result.created,
      carrierBound: result.carrierBound,
    }, result.created ? '司机同步成功，已新增' : '司机同步成功，已更新');
  }

  if (!batch.length) throw errParam('批量同步 drivers 不能为空');
  if (batch.length > DRIVER_SYNC_BATCH_MAX) throw errParam(`单次批量同步最多 ${DRIVER_SYNC_BATCH_MAX} 条`);

  const results = [];
  for (let i = 0; i < batch.length; i += 1) {
    const item = batch[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      results.push({ index: i + 1, success: false, code: 'A0001', message: `第 ${i + 1} 条数据格式不正确，应为司机对象` });
      continue;
    }
    try {
      const r = await withTransaction((conn) => syncOneDriver(conn, item));
      results.push({
        index: i + 1,
        success: true,
        code: '00000',
        message: r.created ? '新增成功' : '更新成功',
        driverId: r.driverId,
        externalDriverId: r.externalDriverId,
        idCard: r.idCard,
        created: r.created,
        carrierBound: r.carrierBound,
      });
    } catch (err) {
      const dup = err.code === 'ER_DUP_ENTRY';
      const bizCode = dup ? 'A0002' : (/^[A-D]\d{4}$/.test(String(err.code ?? '')) ? err.code : 'B0001');
      const msg = dup ? '第三方司机ID或身份证号已存在' : (err.message || '同步失败');
      results.push({
        index: i + 1,
        success: false,
        code: bizCode,
        message: msg,
        externalDriverId: item.externalDriverId ?? null,
        idCard: item.idCard ?? null,
      });
    }
  }

  const success = results.filter((r) => r.success).length;
  const created = results.filter((r) => r.success && r.created).length;
  const failed = results.length - success;
  ok(res, {
    total: results.length,
    success,
    created,
    updated: success - created,
    failed,
    results,
  }, `批量司机同步完成：成功 ${success} 条，失败 ${failed} 条`);
}));

/* ======================= ⑪ 狮桥：在途点位上报 ======================= */
// POST /api/external/tracking/report
// 狮桥按固定频率回传车辆位置：写 transport_track，不推进任务状态（出库完成即进入在途）。
// 仅已提车/已出库/在途任务可上报；上报时间不得晚于当前时间、不得早于上次上报。
// 同一上报时间与坐标重复推送按幂等返回，不重复写轨迹。
router.post('/tracking/report', wrap(async (req, res) => {
  const b = req.body || {};

  const longitude = Number(b.longitude);
  const latitude = Number(b.latitude);
  if (b.longitude === undefined || b.longitude === null || b.longitude === '' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw errParam('经度 longitude 必填，取值 -180 ~ 180');
  }
  if (b.latitude === undefined || b.latitude === null || b.latitude === '' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw errParam('纬度 latitude 必填，取值 -90 ~ 90');
  }
  const locationDesc = cutStr(String(b.locationDesc ?? '').trim(), 255) || '位置更新';
  const speed = assertAmount(b.speed, { label: '时速 speed', required: false });
  const reportTime = parseDateTime(b.reportTime, '上报时间 reportTime');
  assertNotFuture(reportTime, '上报时间 reportTime');

  const result = await withTransaction(async (conn) => {
    const task = await lockTaskByRef(conn, { orderNo: b.orderNo, applyNo: b.applyNo, taskNo: b.taskNo });

    if (['WAIT_DISPATCH', 'DISPATCHED', 'CARRIER_ACCEPTED'].includes(task.status)) {
      throw errState(`当前任务状态不允许上报位置（${task.status}），车辆尚未提车`);
    }
    if (['ARRIVED', 'FINISHED', 'CANCELLED'].includes(task.status)) {
      throw errState(`当前任务状态不允许上报位置（${task.status}），运输已结束`);
    }

    const reportAt = reportTime || nowStr();
    const [lastRows] = await conn.query(
      'SELECT transport_no, longitude, latitude, report_time FROM transport_track WHERE task_id = ? AND deleted = 0 ORDER BY report_time DESC, id DESC LIMIT 1 FOR UPDATE',
      [task.id]
    );
    const last = lastRows[0] || null;
    if (last && reportAt < String(last.report_time)) {
      throw errBiz(`上报时间（${reportAt}）不能早于上次上报时间（${last.report_time}）`);
    }
    if (last && reportAt === String(last.report_time)
      && Number(last.longitude) === longitude && Number(last.latitude) === latitude) {
      return { transportNo: last.transport_no, reportTime: last.report_time, status: task.status, idempotent: true };
    }

    // 运输单号规则：SQ+yyyyMMdd+任务id补零4位
    const transportNo = `SQ${localDateStr().replace(/-/g, '')}${String(task.id).padStart(4, '0')}`;
    await conn.query(
      `INSERT INTO transport_track
        (task_id, task_no, transport_no, longitude, latitude, location_desc, speed, report_time, create_name, update_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '狮桥物流', '狮桥物流')`,
      [task.id, task.task_no, transportNo, longitude, latitude, locationDesc, speed, reportAt]
    );
    return { transportNo, reportTime: reportAt, status: task.status, idempotent: false };
  });

  ok(res, result, result.idempotent ? '重复上报，幂等处理直接返回' : '位置上报成功');
}));

/* ======================= ⑫ 承运商通用：任务状态回传（状态机校验推进） ======================= */
// ⑫ 承运商通用：任务状态回传（按状态拆分为四个接口，均走同一状态机与时间校验）
//   通用运单状态回传接口：狮桥物流及其他承运商/三方物流供应商均可调用。
//   可选 carrierName 标识回传承运商（须与任务当前承运商一致，防串单）；
//   不传按狮桥物流留痕（兼容既有对接）。
//   POST /shipping-tasks/accept  承运商接单并指派司机：DISPATCHED→CARRIER_ACCEPTED，回填 driver_id；
//                                计划提车日期由 CRM 在 ① receive 下发，本接口不接收
//   POST /shipping-tasks/pickup  司机确认提车（=发运，含车辆照片 photos）：
//                                CARRIER_ACCEPTED→PICKED 回填 ship_time（发运时间），待仓库出库；
//                                可选 actualPickupDate 实际提车日期（允许早于计划提车日期，不得晚于今天）；
//                                之后重复回传仅补记日志（幂等不回退）
//   POST /shipping-tasks/arrive  司机到达：IN_TRANSIT→ARRIVED 回填 arrive_time，生成 YF 运费单（FOR UPDATE 幂等）；
//                                可选 actualFreight/mileage/arriveTime，mileage 覆盖 CRM 下发里程，缺省沿用任务里程；
//                                一车一单，vehicles 兼容传入但仅允许 1 台且须一致；缺省按计划运费生成；
//                                时间须晚于提车/出库时间且不得晚于当前时间
//   POST /shipping-tasks/finish  司机完结：ARRIVED→FINISHED 回填 finish_time，同步运费单 finish_time；
//                                当前时间须晚于到达时间
async function runStatusAction(req, action) {
  const b = req.body || {};

  const result = await withTransaction(async (conn) => {
    const task = await lockTaskByRef(conn, { orderNo: b.orderNo, applyNo: b.applyNo, taskNo: b.taskNo });

    // ---- 回传方身份（通用接口：任意承运商/三方物流可调）----
    // 优先 carrierId（STP 内部ID）→ externalCarrierId（第三方ID）→ carrierName（旧字段，仅兼容保留）
    let operatorName = '狮桥物流'; // 未传身份按狮桥留痕（兼容既有对接）
    let logSource = 'SQ';
    const carrierIdParam = b.carrierId === undefined || b.carrierId === null || b.carrierId === '' ? null : Number(b.carrierId);
    const externalCarrierIdParam = b.externalCarrierId ? String(b.externalCarrierId).trim() : null;
    const carrierNameParam = String(b.carrierName ?? '').trim();
    if (carrierIdParam !== null || externalCarrierIdParam || carrierNameParam) {
      let crows = [];
      if (carrierIdParam !== null) {
        [crows] = await conn.query('SELECT * FROM carrier WHERE id = ? AND deleted = 0', [carrierIdParam]);
        if (!crows.length) throw errNotFound(`承运商不存在（ID: ${carrierIdParam}）`);
      } else if (externalCarrierIdParam) {
        [crows] = await conn.query('SELECT * FROM carrier WHERE external_carrier_id = ? AND deleted = 0', [externalCarrierIdParam]);
        if (!crows.length) throw errNotFound(`第三方承运商ID ${externalCarrierIdParam} 对应的承运商不存在`);
      } else {
        [crows] = await conn.query('SELECT * FROM carrier WHERE carrier_name = ? AND deleted = 0', [carrierNameParam]);
        if (!crows.length) throw errNotFound(`承运商不存在：${carrierNameParam}`);
      }
      const carrierRow = crows[0];
      if (Number(carrierRow.status) !== 1) throw errBiz(`该承运商已停用，不可回传：${carrierRow.carrier_name}`);
      if (task.carrier_id && Number(task.carrier_id) !== Number(carrierRow.id)) {
        throw errBiz(`回传方（${carrierRow.carrier_name}）与任务当前承运商不一致，不可回传`);
      }
      operatorName = carrierRow.carrier_name;
      logSource = 'CARRIER';
    }

    /* ---- 承运商接单并分配司机 ---- */
    if (action === 'ACCEPT') {
      // 司机定位：driverId（STP 内部ID）或 externalDriverId（第三方司机ID），二选一
      const driverIdParam = b.driverId === undefined || b.driverId === null || b.driverId === '' ? null : Number(b.driverId);
      const externalDriverIdParam = b.externalDriverId ? String(b.externalDriverId).trim() : null;
      if (!driverIdParam && !externalDriverIdParam) throw errParam('接单必须分配司机 driverId 或 externalDriverId');
      // 计划提车日期由 CRM 在发运申请（#1 receive）下发，接单接口不接收、不修改
      // 司机校验：存在、启用（停用拦截新分派，既有需求 10）、属于任务承运商（carrier_driver 多对多）
      const [drows] = driverIdParam
        ? await conn.query('SELECT * FROM driver WHERE id = ? AND deleted = 0', [driverIdParam])
        : await conn.query('SELECT * FROM driver WHERE external_driver_id = ? AND deleted = 0', [externalDriverIdParam]);
      if (!drows.length) {
        throw errNotFound(driverIdParam ? `司机不存在（ID: ${driverIdParam}）` : `第三方司机ID ${externalDriverIdParam} 对应的司机不存在`);
      }
      const driver = drows[0];
      const driverId = Number(driver.id);
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
          `UPDATE shipping_task SET status = 'CARRIER_ACCEPTED', driver_id = ?, version = version + 1, update_name = ?
            WHERE id = ? AND version = ?`,
          [driverId, operatorName, task.id, task.version]
        );
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: 'DISPATCHED', toStatus: 'CARRIER_ACCEPTED',
          source: logSource, operator: operatorName,
          remark: `承运商确认接单，分配司机：${driver.driver_name}`,
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

    /* ---- 司机确认提车（=发运，回填 ship_time 发运时间；photos 结构化存 status_log.photos） ---- */
    if (action === 'PICKUP') {
      const photos = normalizePhotos(b.photos);
      // 实际提车时间 = 发运时间：选填 YYYY-MM-DD HH:mm:ss（兼容仅日期），允许早于计划提车日期（提前提车），缺省取当前时间
      let shipTime = null;
      if (b.actualPickupDate) {
        const raw = String(b.actualPickupDate).trim().replace('T', ' ');
        if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/.test(raw)) {
          throw errParam('实际提车时间 actualPickupDate 格式不正确，应为 YYYY-MM-DD HH:mm:ss');
        }
        shipTime = raw.length === 10 ? `${raw} 00:00:00` : (raw.length === 16 ? `${raw}:00` : raw);
        if (shipTime > nowStr()) {
          throw errParam(`实际提车时间（${shipTime}）不能晚于当前时间（${nowStr()}）`);
        }
      }
      const photoNote = photos ? `，${photos.length} 张提车照片已同步` : '';

      // 正常链：承运商已接单 → 已提车（司机先办提车，车辆照片留痕；仓库出库回传后进入在途）
      if (task.status === 'CARRIER_ACCEPTED') {
        await conn.query(
          `UPDATE shipping_task SET status = 'PICKED', ship_time = COALESCE(?, NOW()), version = version + 1, update_name = ?
            WHERE id = ? AND version = ?`,
          [shipTime, operatorName, task.id, task.version]
        );
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: 'CARRIER_ACCEPTED', toStatus: 'PICKED',
          source: logSource, operator: operatorName, photos,
          remark: cutStr(`司机确认提车（发运）${shipTime ? `，发运时间 ${shipTime}（可早于计划提车日期）` : ''}${photoNote}`, 255),
        });
        return { taskNo: task.task_no, status: 'PICKED', message: '提车确认成功，任务状态：已提车，待仓库出库' };
      }

      // 幂等：已提车/已出库/在途/已到达/已完结重复回传，仅补记日志 + 补 ship_time，不回退状态
      if (['PICKED', 'OUTBOUND', 'IN_TRANSIT', 'ARRIVED', 'FINISHED'].includes(task.status)) {
        if (!task.ship_time) {
          await conn.query('UPDATE shipping_task SET ship_time = COALESCE(?, NOW()), update_name = ? WHERE id = ?', [shipTime, operatorName, task.id]);
        }
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: task.status, toStatus: task.status,
          source: logSource, operator: operatorName, photos,
          remark: cutStr(`提车状态重复回传，幂等处理仅补记日志、不回退状态${photoNote ? `；${photos.length} 张提车照片已同步` : ''}`, 255),
        });
        return { taskNo: task.task_no, status: task.status, message: '提车状态重复回传，幂等处理仅补记日志' };
      }
      throw errState(`当前任务状态不允许提车确认（${task.status}），仅「承运商已接单」可确认提车`);
    }

    /* ---- 司机到达（回填实际运费/里程/到达时间，生成 YF 运费单 FOR UPDATE 幂等） ---- */
    if (action === 'ARRIVE') {
      if (!['IN_TRANSIT', 'ARRIVED', 'FINISHED'].includes(task.status)) {
        throw errState(`当前任务状态不允许到达（${task.status}），车辆尚未出库进入在途`);
      }

      // 司机到达时填写运费信息（PRD 5）：实际运费/里程/到达时间选填，不传按计划运费与当前时间
      const reportedFreight = assertAmount(b.actualFreight, { label: '实际运费 actualFreight', required: false });
      const reportedMileage = assertAmount(b.mileage, { label: '里程 mileage', required: false });
      const arriveTime = parseDateTime(b.arriveTime, '到达时间 arriveTime');
      assertNotFuture(arriveTime, '到达时间 arriveTime');
      assertNotBefore(arriveTime, task.ship_time, { label: '到达时间', prevLabel: '提车发运时间' });
      assertNotBefore(arriveTime, task.outbound_date, { label: '到达时间', prevLabel: '出库时间' });

      // 一车一单：任务车辆明细固定 1 台车
      const [vehicleRows] = await conn.query(
        'SELECT id, vin FROM shipping_task_vehicle WHERE task_id = ? AND deleted = 0',
        [task.id]
      );
      if (vehicleRows.length !== 1) throw errBiz('任务车辆明细异常（一车一单应为 1 台车），请联系管理员核对');
      const vehicle = vehicleRows[0];

      // 兼容旧调用：vehicles 若传，仅允许 1 台且 VIN 须与该任务车辆一致
      let vehicleFreight = null;
      if (b.vehicles !== undefined && b.vehicles !== null) {
        if (!Array.isArray(b.vehicles) || b.vehicles.length !== 1) {
          throw errParam('一车一单：车辆运费 vehicles 仅允许 1 台车');
        }
        const vin = String(b.vehicles[0]?.vin ?? '').trim().toUpperCase();
        if (!vin) throw errParam('车辆 VIN 必填');
        if (vin !== String(vehicle.vin).toUpperCase()) throw errBiz(`VIN ${vin} 不属于该任务`);
        vehicleFreight = assertAmount(b.vehicles[0]?.actualFreight, { label: '车辆实际运费 actualFreight' });
      }
      if (vehicleFreight !== null && reportedFreight !== null && Math.abs(vehicleFreight - reportedFreight) > 0.005) {
        throw errBiz(`车辆运费 ${vehicleFreight} 与任务实际运费 ${reportedFreight} 不一致`);
      }
      const finalFreight = vehicleFreight ?? reportedFreight ?? (Number(task.plan_freight) || 0);
      // 里程：司机回传优先，未回传沿用 CRM 发运申请下发的里程
      const finalMileage = reportedMileage !== null
        ? reportedMileage
        : (task.mileage === null || task.mileage === undefined ? null : Number(task.mileage));

      let freightNo = null;
      let billCreated = false;
      if (task.status !== 'ARRIVED' && task.status !== 'FINISHED') {
        await conn.query(
          `UPDATE shipping_task SET status = 'ARRIVED', arrive_time = COALESCE(?, NOW()), actual_freight = ?,
                  mileage = COALESCE(?, mileage), version = version + 1, update_name = ?
            WHERE id = ? AND version = ?`,
          [arriveTime, finalFreight, reportedMileage, operatorName, task.id, task.version]
        );
        await conn.query(
          'UPDATE shipping_task_vehicle SET actual_freight = ?, update_name = ? WHERE id = ?',
          [finalFreight, operatorName, vehicle.id]
        );
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: task.status, toStatus: 'ARRIVED',
          source: logSource, operator: operatorName,
          remark: cutStr(`司机确认到达${reportedFreight !== null || vehicleFreight !== null ? `，实际运费 ${finalFreight}` : ''}${finalMileage !== null ? `，里程 ${finalMileage} km` : ''}${arriveTime ? `，到达时间 ${arriveTime}` : ''}`, 255),
        });
      } else {
        await writeStatusLog(conn, {
          taskId: task.id, taskNo: task.task_no, fromStatus: task.status, toStatus: task.status,
          source: logSource, operator: operatorName, remark: '到达状态重复回传，幂等处理仅补记日志',
        });
      }

      // 生成运费结算单（FOR UPDATE 幂等：已存在则不重复生成）；里程继承任务主表
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
           finalMileage, task.plan_freight, finalFreight, operatorName, operatorName]
        );
        billCreated = true;
      }
      return {
        taskNo: task.task_no, status: task.status === 'ARRIVED' || task.status === 'FINISHED' ? task.status : 'ARRIVED',
        freightNo, billCreated, actualFreight: finalFreight, mileage: finalMileage,
        message: `到达确认成功${billCreated ? `，已生成运费结算单 ${freightNo}（待对账）` : `，运费单 ${freightNo} 已存在（幂等）`}`,
      };
    }

    /* ---- 司机完结（同步运费单 finish_time） ---- */
    if (action === 'FINISH') {
      if (task.arrive_time && String(task.arrive_time) > nowStr()) {
        throw errBiz(`当前时间（${nowStr()}）早于到达时间（${task.arrive_time}），须到达时间之后才能完结`);
      }
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

  return result;
}

/* 按状态拆分的四个回传接口（共用状态机、幂等与时间校验） */
router.post('/shipping-tasks/accept', wrap(async (req, res) => {
  const result = await runStatusAction(req, 'ACCEPT');
  ok(res, result, result.message);
}));

router.post('/shipping-tasks/pickup', wrap(async (req, res) => {
  const result = await runStatusAction(req, 'PICKUP');
  ok(res, result, result.message);
}));

router.post('/shipping-tasks/arrive', wrap(async (req, res) => {
  const result = await runStatusAction(req, 'ARRIVE');
  ok(res, result, result.message);
}));

router.post('/shipping-tasks/finish', wrap(async (req, res) => {
  const result = await runStatusAction(req, 'FINISH');
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
/** 统一定位并锁定任务（FOR UPDATE）：orderNo 优先，其次 taskNo，兼容 applyNo（须唯一对应单任务） */
async function lockTaskByRef(conn, { orderNo, applyNo, taskNo }) {
  const order = String(orderNo ?? '').trim();
  const apply = String(applyNo ?? '').trim();
  const no = String(taskNo ?? '').trim();
  if (!order && !no && !apply) throw errParam('请提供订单号 orderNo（推荐）、任务单号 taskNo 或发运申请号 applyNo');
  let rows;
  if (order) {
    [rows] = await conn.query('SELECT * FROM shipping_task WHERE order_no = ? AND deleted = 0 FOR UPDATE', [order]);
    if (!rows.length) throw errNotFound(`订单号 ${order} 对应的任务不存在`);
    return rows[0];
  }
  if (no) {
    [rows] = await conn.query('SELECT * FROM shipping_task WHERE task_no = ? AND deleted = 0 FOR UPDATE', [no]);
    if (!rows.length) throw errNotFound(`任务单号 ${no} 对应的任务不存在`);
    return rows[0];
  }
  [rows] = await conn.query('SELECT * FROM shipping_task WHERE apply_no = ? AND deleted = 0 ORDER BY id FOR UPDATE', [apply]);
  if (!rows.length) throw errNotFound(`发运申请号 ${apply} 对应的任务不存在`);
  if (rows.length > 1) throw errParam(`发运申请号 ${apply} 对应 ${rows.length} 条任务，请改用订单号 orderNo 定位具体车辆`);
  return rows[0];
}

module.exports = router;
