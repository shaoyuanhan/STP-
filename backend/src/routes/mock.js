/**
 * 外部系统模拟接口（演示用，对应 PRD 系统交互协议）
 * 接口1  POST /api/mock/crm/apply         CRM下发发运申请（自动生成任务）
 * 接口3  GET  /api/mock/crm/cancel-query  CRM取消前查询（返回是否可取消）
 * 接口6  POST /api/mock/crm/cancel        CRM同步取消发运申请
 * 接口2  POST /api/mock/esign/init        CRM同步物流电子签发起
 * 接口14 POST /api/mock/esign/status       狮桥电子签状态回传
 * 接口10 POST /api/mock/driver/sync       司机信息三方同步（按身份证号幂等）
 * 接口12 POST /api/mock/shiqiao/accept    狮桥接单（分配司机+预计提车日期）
 *        POST /api/mock/shiqiao/pickup   司机提车发运
 *        POST /api/mock/shiqiao/arrive    司机到达（回填实际运费/里程，生成运费单）
 *        POST /api/mock/shiqiao/finish    司机完结
 * 接口13 POST /api/mock/wms/outbound      WMS出库回传
 * 接口15 POST /api/mock/shiqiao/track     狮桥位置回传（每小时）
 */
const { Router } = require('express');
const { query, withTransaction, nextSeq } = require('../db');
const { BizError, wrap, localDateStr } = require('../helpers');

const router = Router();

async function getTaskByNo(taskNo) {
  const [task] = await query('SELECT * FROM ship_tasks WHERE task_no = ?', [taskNo]);
  if (!task) throw new BizError(`任务 ${taskNo} 不存在`, 404);
  return task;
}

async function addEvent(taskId, node, nodeName, detail, operator, conn) {
  const sql = 'INSERT INTO task_events (task_id, node, node_name, detail, operator) VALUES (?, ?, ?, ?, ?)';
  const params = [Number(taskId), node, nodeName, detail, operator || '系统'];
  if (conn) await conn.query(sql, params);
  else await query(sql, params);
}

function assertStatus(task, allow, msg) {
  if (!allow.includes(task.status)) {
    throw new BizError(msg || `当前状态【${STATUS_CN[task.status] || task.status}】不允许该操作`);
  }
}

const STATUS_CN = {
  PENDING: '待派单', DISPATCHED: '已派单', ACCEPTED: '承运商已接单', OUT_BOUND: '已出库',
  PICKED_UP: '已提车', IN_TRANSIT: '在途', ARRIVED: '已到达', FINISHED: '已完结', CANCELLED: '已取消',
};

// ============ 接口1: CRM下发发运申请 ============
router.post('/crm/apply', wrap(async (req, res) => {
  const { apply_no, customer_name, region, sales_name, sales_phone, vin, vehicle_model,
    engine_config, cab_type, order_no, report_no, factory, storage_location, origin,
    dest_region, dest_address, receiver_phone, ship_mode = '送车', plan_freight } = req.body;

  if (!apply_no?.trim()) throw new BizError('发运申请号必填');
  if (!customer_name?.trim()) throw new BizError('客户名称必填');
  if (!vin?.trim()) throw new BizError('VIN必填');
  if (!dest_address?.trim()) throw new BizError('交付地址必填');
  if (plan_freight === undefined || Number(plan_freight) < 0) throw new BizError('计划运费必填且不小于0');

  const dup = await query('SELECT id FROM ship_tasks WHERE apply_no = ?', [apply_no.trim()]);
  if (dup.length) throw new BizError(`发运申请号 ${apply_no} 已同步过，请勿重复下发`, 409);

  const task = await withTransaction(async (conn) => {
    const task_no = await nextSeq('FY', conn);
    const [r] = await conn.query(
      `INSERT INTO ship_tasks
        (task_no, apply_no, customer_name, region, sales_name, sales_phone, vin, vehicle_model, engine_config, cab_type,
         order_no, report_no, factory, storage_location, origin, dest_region, dest_address, receiver_phone, ship_mode,
         plan_freight, status, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'PENDING', 'CRM系统')`,
      [task_no, apply_no.trim(), customer_name.trim(), region || null, sales_name || null, sales_phone || null,
        vin.trim(), vehicle_model || null, engine_config || null, cab_type || null, order_no || null, report_no || null,
        factory || null, storage_location || null, origin?.trim() || '合肥市包河区上海路88号', dest_region || null,
        dest_address.trim(), receiver_phone || null, ship_mode, Number(plan_freight)]
    );
    await addEvent(r.insertId, 'APPLY', 'CRM下发发运申请',
      `接收CRM发运申请 ${apply_no}，计划运费 ${Number(plan_freight).toFixed(2)} 元`, 'CRM系统', conn);
    const [[row]] = await conn.query('SELECT * FROM ship_tasks WHERE id = ?', [r.insertId]);
    return row;
  });
  res.status(201).json({ message: '发运申请同步成功，已生成待派单任务', data: task });
}));

// ============ 接口3: CRM取消前查询 ============
router.get('/crm/cancel-query', wrap(async (req, res) => {
  const { apply_no } = req.query;
  if (!apply_no) throw new BizError('请提供发运申请号');
  const [task] = await query('SELECT * FROM ship_tasks WHERE apply_no = ?', [apply_no]);
  if (!task) throw new BizError(`未找到申请号 ${apply_no} 对应的任务`, 404);

  let cancellable = false;
  let message = '';
  if (task.status === 'PENDING') { cancellable = true; message = '当前为待派单状态，可以取消'; }
  else if (task.status === 'DISPATCHED') message = '当前为已派单状态，请先在 STP 取消派单后再同步取消';
  else if (task.status === 'ACCEPTED') message = '司机已接单，需联系承运商取消接单后再同步取消';
  else if (task.status === 'CANCELLED') message = '该任务已取消';
  else message = '车辆已出库发运，不可取消';

  res.json({ task_no: task.task_no, status: task.status, status_cn: STATUS_CN[task.status], cancellable, message });
}));

// ============ 接口6: CRM同步取消 ============
router.post('/crm/cancel', wrap(async (req, res) => {
  const { apply_no, cancel_reason } = req.body;
  if (!apply_no) throw new BizError('请提供发运申请号');
  const [task] = await query('SELECT * FROM ship_tasks WHERE apply_no = ?', [apply_no]);
  if (!task) throw new BizError(`未找到申请号 ${apply_no} 对应的任务`, 404);

  if (task.status === 'DISPATCHED') throw new BizError('当前为已派单状态，请先在 STP 取消派单后再同步取消', 409);
  if (task.status === 'ACCEPTED') throw new BizError('司机已接单，需联系承运商取消接单后再同步取消', 409);
  if (['OUT_BOUND', 'PICKED_UP', 'IN_TRANSIT', 'ARRIVED', 'FINISHED'].includes(task.status)) {
    throw new BizError('车辆已出库发运，不可取消', 409);
  }
  if (task.status === 'CANCELLED') throw new BizError('该任务已取消，请勿重复操作', 409);
  if (task.status !== 'PENDING') throw new BizError('当前状态不可取消', 409);

  const reason = cancel_reason?.trim() || 'CRM发起取消';
  await query("UPDATE ship_tasks SET status = 'CANCELLED', cancel_reason = ? WHERE id = ?", [reason, task.id]);
  await addEvent(task.id, 'CANCEL', '任务取消', `CRM同步取消：${reason}`, 'CRM系统');
  // 关联电子签同步取消
  await query("UPDATE esign_records SET status = 'CANCELLED' WHERE task_id = ? AND status = 'PENDING'", [task.id]);
  res.json({ message: '任务已取消，关联电子签已同步取消' });
}));

// ============ 接口2: CRM同步物流电子签发起 ============
router.post('/esign/init', wrap(async (req, res) => {
  const { esign_id, vin, apply_no, sign_type = '物流电子签', trigger_node = 'CRM发运申请审批通过', signer } = req.body;
  if (!esign_id?.trim()) throw new BizError('电子签ID必填');
  if (!vin?.trim() || !apply_no?.trim()) throw new BizError('VIN与发运申请号必填（用于匹配任务）');

  const dup = await query('SELECT id FROM esign_records WHERE esign_id = ?', [esign_id.trim()]);
  if (dup.length) throw new BizError(`电子签ID ${esign_id} 已存在`, 409);

  const [task] = await query('SELECT * FROM ship_tasks WHERE vin = ? AND apply_no = ?', [vin.trim(), apply_no.trim()]);
  if (!task) throw new BizError('未匹配到对应任务，请核对 VIN 与发运申请号', 404);

  await query(
    `INSERT INTO esign_records (esign_id, task_id, task_no, vin, apply_no, sign_type, trigger_node, signer, initiated_at, status)
     VALUES (?,?,?,?,?,?,?, ?, NOW(), 'PENDING')`,
    [esign_id.trim(), task.id, task.task_no, task.vin, task.apply_no, sign_type, trigger_node,
      signer || '承运商']
  );
  res.status(201).json({ message: '电子签已发起，状态：待签署', esign_id: esign_id.trim() });
}));

// ============ 接口14: 狮桥电子签状态回传 ============
router.post('/esign/status', wrap(async (req, res) => {
  const { esign_id, status } = req.body;
  if (!esign_id) throw new BizError('请提供电子签ID');
  if (!['SIGNED', 'CANCELLED'].includes(status)) throw new BizError('状态仅支持 SIGNED / CANCELLED');

  const [rec] = await query('SELECT * FROM esign_records WHERE esign_id = ?', [esign_id]);
  if (!rec) throw new BizError(`电子签 ${esign_id} 不存在`, 404);
  if (rec.status !== 'PENDING') throw new BizError(`该电子签当前状态为【${rec.status}】，不可变更`);

  await query('UPDATE esign_records SET status = ?, signed_at = IF(? = ?, NOW(), NULL) WHERE id = ?',
    [status, status, 'SIGNED', rec.id]);
  res.json({ message: status === 'SIGNED' ? '签署完成' : '电子签已取消' });
}));

// ============ 电子签按任务签收（演示辅助：签收任务当前待签署的电子签） ============
router.post('/esign/sign-task', wrap(async (req, res) => {
  const { task_no } = req.body;
  const [task] = await query('SELECT * FROM ship_tasks WHERE task_no = ?', [task_no]);
  if (!task) throw new BizError('任务不存在', 404);
  const [rec] = await query(
    "SELECT * FROM esign_records WHERE task_id = ? AND status = 'PENDING' ORDER BY id DESC LIMIT 1",
    [task.id]
  );
  if (!rec) throw new BizError('该任务无待签署的电子签');
  await query("UPDATE esign_records SET status = 'SIGNED', signed_at = NOW() WHERE id = ?", [rec.id]);
  res.json({ message: `电子签 ${rec.esign_id} 签署完成` });
}));

// ============ 接口10: 司机信息三方同步（幂等） ============
router.post('/driver/sync', wrap(async (req, res) => {
  const { name, phone, id_card, license_no, vehicle_type, license_valid_from, license_valid_to, carrier_id } = req.body;
  if (!name || !phone || !id_card) throw new BizError('姓名、手机号、身份证号必填');

  const [exist] = await query('SELECT * FROM drivers WHERE id_card = ?', [id_card]);
  if (exist) {
    await query('UPDATE drivers SET name = ?, phone = ?, license_no = ?, vehicle_type = ?, license_valid_from = ?, license_valid_to = ?, carrier_id = ? WHERE id = ?',
      [name, phone, license_no || null, vehicle_type || null, license_valid_from || exist.license_valid_from,
        license_valid_to || exist.license_valid_to, carrier_id || exist.carrier_id, exist.id]);
    return res.json({ message: '司机信息已更新', id: exist.id });
  }
  const r = await query(
    `INSERT INTO drivers (name, phone, id_card, license_no, vehicle_type, license_valid_from, license_valid_to, carrier_id, status)
     VALUES (?,?,?,?,?,?,?,?, 'ENABLED')`,
    [name, phone, id_card, license_no || null, vehicle_type || null, license_valid_from || null, license_valid_to || null, carrier_id || null]
  );
  res.status(201).json({ message: '司机已同步新增', id: r.insertId });
}));

// ============ 接口12: 狮桥接单（分配司机 + 预计提车日期） ============
router.post('/shiqiao/accept', wrap(async (req, res) => {
  const { task_no, driver_id, plan_pickup_date } = req.body;
  const task = await getTaskByNo(task_no);
  assertStatus(task, ['DISPATCHED'], '仅"已派单"状态可接单，当前状态不可接单');
  if (!driver_id) throw new BizError('请分配司机');

  const [driver] = await query(
    `SELECT d.*, c.carrier_name FROM drivers d LEFT JOIN carriers c ON c.id = d.carrier_id WHERE d.id = ?`,
    [Number(driver_id)]
  );
  if (!driver) throw new BizError('司机不存在', 404);
  if (driver.status !== 'ENABLED') throw new BizError('该司机已停用，不可分派任务');
  if (driver.carrier_id && driver.carrier_id !== task.carrier_id) {
    throw new BizError('该司机不属于当前承运商');
  }

  const pickup = plan_pickup_date || localDateStr(new Date(Date.now() + 86400000));
  await query("UPDATE ship_tasks SET status = 'ACCEPTED', driver_id = ?, plan_pickup_date = ? WHERE id = ?",
    [Number(driver_id), pickup, task.id]);
  await addEvent(task.id, 'ACCEPT', '承运商接单/分配司机',
    `${driver.carrier_name || '承运商'}确认接单，分配司机：${driver.name}，预计提车 ${pickup}`, driver.carrier_name || '狮桥物流');
  res.json({ message: `接单成功，已分配司机：${driver.name}` });
}));

// ============ 接口13: WMS出库回传 ============
router.post('/wms/outbound', wrap(async (req, res) => {
  const { task_no } = req.body;
  const task = await getTaskByNo(task_no);
  assertStatus(task, ['ACCEPTED', 'PICKED_UP'], '当前状态不可出库（需承运商已接单且未在途）');

  await query("UPDATE ship_tasks SET status = 'OUT_BOUND', out_bound_at = NOW() WHERE id = ?", [task.id]);
  await addEvent(task.id, 'OUT_BOUND', 'WMS出库', 'WMS出库回传，车辆已出库', 'WMS系统');
  res.json({ message: '出库回传成功，任务状态：已出库' });
}));

// ============ 接口12: 司机提车发运 ============
router.post('/shiqiao/pickup', wrap(async (req, res) => {
  const { task_no } = req.body;
  const task = await getTaskByNo(task_no);
  assertStatus(task, ['ACCEPTED', 'OUT_BOUND'], '当前状态不可提车（需已接单/已出库）');

  const [driver] = await query('SELECT * FROM drivers WHERE id = ?', [task.driver_id]);
  await query("UPDATE ship_tasks SET status = 'PICKED_UP', ship_at = NOW() WHERE id = ?", [task.id]);
  await addEvent(task.id, 'PICKUP', '司机提车发运',
    `司机${driver ? driver.name : ''}确认提车并发运，同步提车照片`, driver ? driver.name : '司机');
  res.json({ message: '提车成功，任务状态：已提车' });
}));

// ============ 接口15: 狮桥位置回传（首次回传自动置为在途） ============
router.post('/shiqiao/track', wrap(async (req, res) => {
  const { task_no, position_desc, lng, lat, speed } = req.body;
  const task = await getTaskByNo(task_no);
  assertStatus(task, ['OUT_BOUND', 'PICKED_UP', 'IN_TRANSIT'], '当前状态不可回传位置（车辆尚未提车或已到达）');

  const transport_no = `SQ${localDateStr().replace(/-/g, '')}${String(task.id).padStart(4, '0')}`;
  await query(
    'INSERT INTO tracking_records (task_id, transport_no, position_desc, lng, lat, speed, reported_at) VALUES (?,?,?,?,?,?,NOW())',
    [task.id, transport_no, position_desc || '位置更新', lng || null, lat || null, speed || null]
  );
  if (task.status !== 'IN_TRANSIT') {
    await query("UPDATE ship_tasks SET status = 'IN_TRANSIT' WHERE id = ?", [task.id]);
    await addEvent(task.id, 'TRANSIT', '在途运输', `首次位置回传：${position_desc || ''}${speed ? `，时速 ${speed}km/h` : ''}`, '狮桥物流');
  }
  res.json({ message: '位置回传成功', transport_no });
}));

// ============ 司机到达（回填实际运费/里程，生成运费单） ============
router.post('/shiqiao/arrive', wrap(async (req, res) => {
  const { task_no, actual_freight, mileage } = req.body;
  const task = await getTaskByNo(task_no);
  assertStatus(task, ['IN_TRANSIT', 'PICKED_UP', 'OUT_BOUND'], '当前状态不可到达（车辆尚未发运）');

  const amt = actual_freight === undefined || actual_freight === null || actual_freight === ''
    ? Number(task.plan_freight) : Number(actual_freight);
  if (!Number.isFinite(amt) || amt < 0) throw new BizError('实际运费金额无效');

  await withTransaction(async (conn) => {
    const [[driver]] = await conn.query('SELECT * FROM drivers WHERE id = ?', [task.driver_id]);
    await conn.query("UPDATE ship_tasks SET status = 'ARRIVED', arrive_at = NOW(), actual_freight = ?, mileage = ? WHERE id = ?",
      [amt, mileage || null, task.id]);
    await addEvent(task.id, 'ARRIVE', '司机到达',
      `司机${driver ? driver.name : ''}确认到达，实际运费 ${amt.toFixed(2)} 元${mileage ? `，里程 ${mileage} 公里` : ''}`,
      driver ? driver.name : '司机', conn);

    // 生成运费单（幂等：已存在则跳过）
    const [[dupFo]] = await conn.query('SELECT id FROM freight_orders WHERE task_id = ? FOR UPDATE', [task.id]);
    if (!dupFo) {
      const freight_no = await nextSeq('YF', conn);
      await conn.query(
        `INSERT INTO freight_orders (freight_no, task_id, task_no, carrier_id, driver_id, origin, dest, mileage, plan_freight, actual_freight, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?, 'PENDING_RECON', NOW())`,
        [freight_no, task.id, task.task_no, task.carrier_id, task.driver_id, task.origin,
          task.dest_region || task.dest_address, mileage || null, Number(task.plan_freight), amt]
      );
    }
  });
  res.json({ message: '到达确认成功，已生成运费单，等待客户交接完结' });
}));

// ============ 司机完结 ============
router.post('/shiqiao/finish', wrap(async (req, res) => {
  const { task_no } = req.body;
  const task = await getTaskByNo(task_no);
  assertStatus(task, ['ARRIVED'], '仅"已到达"状态可完结');

  await query("UPDATE ship_tasks SET status = 'FINISHED', finish_at = NOW() WHERE id = ?", [task.id]);
  await query('UPDATE freight_orders SET finish_at = NOW() WHERE task_id = ?', [task.id]);
  const [driver] = await query('SELECT * FROM drivers WHERE id = ?', [task.driver_id]);
  await addEvent(task.id, 'FINISH', '任务完成', '司机与客户完成交接，运单完结', driver ? driver.name : '司机');
  res.json({ message: '任务已完结' });
}));

module.exports = router;
