/**
 * 门户任务流转服务：承运商接单指派、司机提车/到达/结单
 * 与 external.js 的状态机保持一致：
 *   DISPATCHED → CARRIER_ACCEPTED → PICKED → (WMS) OUTBOUND → IN_TRANSIT → ARRIVED → FINISHED
 * 所有写操作带乐观锁 version，重复提交返回状态错误；附件统一落 task_file
 */
const { query, withTransaction, nextSeq } = require('../db');
const {
  errParam, errBiz, errState, errNotFound,
  localDateStr, assertAmount, cutStr,
} = require('../helpers');
const { notify } = require('./notify');

const PICKUP_PHOTO_MIN = Number(process.env.PICKUP_PHOTO_MIN) || 1;

function pad(n) { return n < 10 ? `0${n}` : String(n); }

function localDateTime(d = new Date()) {
  return `${localDateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function normalizePhotos(photos) {
  if (!Array.isArray(photos)) return [];
  return [...new Set(
    photos
      .map((p) => String(p ?? '').trim())
      .filter((p) => p.startsWith('/static/') || /^https?:\/\//i.test(p))
  )];
}

function assertVersion(task, version) {
  if (version === undefined || version === null || version === '') throw errParam('请携带任务版本号 version');
  if (Number(task.version) !== Number(version)) throw errState('任务状态已变化，请刷新后重试');
}

async function lockTask(conn, taskId) {
  const [rows] = await conn.query(
    'SELECT * FROM shipping_task WHERE id = ? AND deleted = 0 FOR UPDATE',
    [Number(taskId)]
  );
  if (!rows.length) throw errNotFound('任务不存在');
  return rows[0];
}

async function writeStatusLog(conn, { taskId, taskNo, fromStatus, toStatus, source, operator, remark, photos }) {
  await conn.query(
    `INSERT INTO task_status_log
      (task_id, task_no, from_status, to_status, source, operator, remark, photos, create_name, update_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      taskId, taskNo, fromStatus ?? null, toStatus, source, operator,
      cutStr(remark, 255), photos && photos.length ? JSON.stringify(photos) : null,
      operator, operator,
    ]
  );
}

async function saveFiles(conn, { task, bizType, photos, uploaderType, uploaderId, uploaderName }) {
  for (const url of photos) {
    await conn.query(
      `INSERT INTO task_file
        (task_id, task_no, biz_type, file_url, file_type, uploader_type, uploader_id, uploader_name)
       VALUES (?, ?, ?, ?, 'IMAGE', ?, ?, ?)`,
      [task.id, task.task_no, bizType, url, uploaderType, uploaderId ?? null, uploaderName ?? null]
    );
  }
}

/** 承运商接单并指派司机 */
async function assignDriver({ taskId, carrierId, carrierName, driverId, version, operator, operatorName }) {
  const result = await withTransaction(async (conn) => {
    const task = await lockTask(conn, taskId);
    assertVersion(task, version);
    if (Number(task.carrier_id) !== Number(carrierId)) throw errBiz('该任务不属于当前承运商');
    if (task.status !== 'DISPATCHED') throw errState('仅「已派单」任务可以接单指派司机');

    const [drivers] = await conn.query('SELECT * FROM driver WHERE id = ? AND deleted = 0', [Number(driverId)]);
    if (!drivers.length) throw errNotFound('司机不存在');
    const driver = drivers[0];
    if (Number(driver.status) !== 1) throw errBiz('该司机已停用，不可分派任务');
    if (driver.license_valid_to && String(driver.license_valid_to) < localDateStr()) {
      throw errBiz(`司机「${driver.driver_name}」驾驶证已过期，不可分派`);
    }
    const [links] = await conn.query(
      'SELECT id FROM carrier_driver WHERE driver_id = ? AND carrier_id = ? AND deleted = 0',
      [driver.id, carrierId]
    );
    if (!links.length) throw errBiz('该司机未关联当前承运商，请先在司机管理中新增');

    await conn.query(
      `UPDATE shipping_task
         SET status = 'CARRIER_ACCEPTED', driver_id = ?, version = version + 1, update_name = ?
       WHERE id = ? AND version = ?`,
      [driver.id, operatorName, task.id, task.version]
    );
    await conn.query(
      `INSERT INTO dispatch_record
        (task_id, task_no, action, carrier_id, driver_id, dispatch_person, dispatch_time, remark, create_name, update_name)
       VALUES (?, ?, 'ASSIGN', ?, ?, ?, NOW(), ?, ?, ?)`,
      [
        task.id, task.task_no, carrierId, driver.id, operatorName,
        `承运商接单并指派司机：${driver.driver_name}`, operatorName, operatorName,
      ]
    );
    await writeStatusLog(conn, {
      taskId: task.id, taskNo: task.task_no,
      fromStatus: 'DISPATCHED', toStatus: 'CARRIER_ACCEPTED',
      source: 'CARRIER', operator: operatorName,
      remark: `承运商确认接单，指派司机：${driver.driver_name}（${driver.phone}）`,
    });

    return { task, driver, version: Number(task.version) + 1 };
  });

  await notify({
    receiverType: 'DRIVER', receiverId: result.driver.id, phone: result.driver.phone,
    driverId: result.driver.id,
    title: '新任务指派',
    content: `任务 ${result.task.task_no} 已指派给您，请前往 ${result.task.ship_location || '发运地点'} 提车。`,
    bizType: 'ASSIGN', bizId: result.task.id,
    channels: ['INBOX', 'SMS', 'WECHAT'],
  });

  return {
    task_id: result.task.id,
    task_no: result.task.task_no,
    status: 'CARRIER_ACCEPTED',
    version: result.version,
    driver_id: result.driver.id,
    driver_name: result.driver.driver_name,
  };
}

/** 司机确认提车（照片强制） */
async function pickupTask({ taskId, driverId, version, photos, pickupDate, operator }) {
  const list = normalizePhotos(photos);
  if (list.length < PICKUP_PHOTO_MIN) {
    throw errParam(`提车照片为必传项，至少上传 ${PICKUP_PHOTO_MIN} 张`);
  }
  if (pickupDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(pickupDate))) {
    throw errParam('实际提车日期格式不正确，应为 YYYY-MM-DD');
  }
  if (pickupDate && String(pickupDate) > localDateStr()) {
    throw errParam('实际提车日期不能晚于今天');
  }
  const shipTime = pickupDate ? `${pickupDate} 09:00:00` : null;

  const result = await withTransaction(async (conn) => {
    const task = await lockTask(conn, taskId);
    assertVersion(task, version);
    if (Number(task.driver_id) !== Number(driverId)) throw errBiz('该任务未指派给您');
    if (task.status !== 'CARRIER_ACCEPTED') {
      throw errState(`当前状态（${task.status}）不允许确认提车`);
    }

    await conn.query(
      `UPDATE shipping_task
         SET status = 'PICKED', ship_time = COALESCE(?, NOW()), version = version + 1, update_name = ?
       WHERE id = ? AND version = ?`,
      [shipTime, operator, task.id, task.version]
    );
    await saveFiles(conn, {
      task, bizType: 'PICKUP', photos: list, uploaderType: 'DRIVER', uploaderId: driverId, uploaderName: operator,
    });
    await writeStatusLog(conn, {
      taskId: task.id, taskNo: task.task_no,
      fromStatus: 'CARRIER_ACCEPTED', toStatus: 'PICKED',
      source: 'DRIVER', operator,
      remark: `司机确认提车，上传 ${list.length} 张照片${pickupDate ? `，实际提车日期 ${pickupDate}` : ''}`,
      photos: list,
    });
    return { task, version: Number(task.version) + 1 };
  });

  await notify({
    receiverType: 'CARRIER', receiverId: result.task.carrier_id,
    title: '司机已提车',
    content: `任务 ${result.task.task_no} 司机 ${operator} 已确认提车，等待仓库出库。`,
    bizType: 'PICKUP', bizId: result.task.id, channels: ['INBOX'],
  });

  return { task_id: result.task.id, task_no: result.task.task_no, status: 'PICKED', version: result.version };
}

/** 司机确认到达（必须已出库进入在途；实际运费必填） */
async function arriveTask({ taskId, driverId, version, photos, actualFreight, mileage, arriveTime, operator }) {
  const freight = assertAmount(actualFreight, { label: '实际运费' });
  const mileageNum = (mileage === undefined || mileage === null || mileage === '')
    ? null
    : assertAmount(mileage, { label: '里程' });
  const list = normalizePhotos(photos);

  let dateTime = null;
  if (arriveTime) {
    const normalized = String(arriveTime).trim().replace(' ', 'T');
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) throw errParam('到达时间格式不正确');
    dateTime = localDateTime(d);
    if (dateTime > localDateTime()) throw errParam('到达时间不能晚于当前时间');
  }

  const result = await withTransaction(async (conn) => {
    const task = await lockTask(conn, taskId);
    assertVersion(task, version);
    if (Number(task.driver_id) !== Number(driverId)) throw errBiz('该任务未指派给您');
    if (task.status !== 'IN_TRANSIT') {
      throw errState('仅「在途」状态可以确认到达，请等待仓库出库');
    }
    if (dateTime && task.ship_time && dateTime < String(task.ship_time)) {
      throw errBiz(`到达时间不能早于提车时间（${task.ship_time}）`);
    }

    const [vehicles] = await conn.query(
      'SELECT id, vin FROM shipping_task_vehicle WHERE task_id = ? AND deleted = 0',
      [task.id]
    );
    if (vehicles.length !== 1) throw errBiz('任务车辆明细异常（一车一单应为 1 台车），请联系管理员');

    const finalMileage = mileageNum !== null ? mileageNum : (task.mileage === null ? null : Number(task.mileage));

    await conn.query(
      `UPDATE shipping_task
         SET status = 'ARRIVED', arrive_time = COALESCE(?, NOW()), actual_freight = ?,
             mileage = COALESCE(?, mileage), version = version + 1, update_name = ?
       WHERE id = ? AND version = ?`,
      [dateTime, freight, mileageNum, operator, task.id, task.version]
    );
    await conn.query(
      'UPDATE shipping_task_vehicle SET actual_freight = ?, update_name = ? WHERE id = ?',
      [freight, operator, vehicles[0].id]
    );
    await saveFiles(conn, {
      task, bizType: 'ARRIVE', photos: list, uploaderType: 'DRIVER', uploaderId: driverId, uploaderName: operator,
    });
    await writeStatusLog(conn, {
      taskId: task.id, taskNo: task.task_no,
      fromStatus: 'IN_TRANSIT', toStatus: 'ARRIVED',
      source: 'DRIVER', operator,
      remark: `司机确认到达，实际运费 ${freight}${finalMileage !== null ? `，里程 ${finalMileage} km` : ''}${dateTime ? `，到达时间 ${dateTime}` : ''}`,
      photos: list,
    });

    const [bills] = await conn.query(
      'SELECT * FROM freight_bill WHERE task_id = ? AND deleted = 0 FOR UPDATE',
      [task.id]
    );
    let freightNo = bills[0]?.freight_no ?? null;
    if (!bills.length) {
      freightNo = await nextSeq('YF', conn);
      await conn.query(
        `INSERT INTO freight_bill
          (freight_no, task_id, task_no, carrier_id, driver_id, start_location, end_location, mileage,
           plan_freight, actual_freight, reconcile_status, create_name, update_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          freightNo, task.id, task.task_no, task.carrier_id, task.driver_id,
          task.ship_location, task.delivery_address || task.delivery_area,
          finalMileage, task.plan_freight, freight, operator, operator,
        ]
      );
    }
    return { task, version: Number(task.version) + 1, freightNo };
  });

  await notify({
    receiverType: 'CARRIER', receiverId: result.task.carrier_id,
    title: '司机已到达',
    content: `任务 ${result.task.task_no} 司机 ${operator} 已确认到达，运费单 ${result.freightNo} 待对账。`,
    bizType: 'ARRIVE', bizId: result.task.id, channels: ['INBOX'],
  });

  return {
    task_id: result.task.id,
    task_no: result.task.task_no,
    status: 'ARRIVED',
    version: result.version,
    freight_no: result.freightNo,
  };
}

/** 司机结单 */
async function finishTask({ taskId, driverId, version, photos, receiver, remark, operator }) {
  const list = normalizePhotos(photos);
  const result = await withTransaction(async (conn) => {
    const task = await lockTask(conn, taskId);
    assertVersion(task, version);
    if (Number(task.driver_id) !== Number(driverId)) throw errBiz('该任务未指派给您');
    if (task.status !== 'ARRIVED') throw errState('仅「已到达」任务可以结单');

    await conn.query(
      `UPDATE shipping_task
         SET status = 'FINISHED', finish_time = NOW(), version = version + 1, update_name = ?
       WHERE id = ? AND version = ?`,
      [operator, task.id, task.version]
    );
    await conn.query(
      'UPDATE freight_bill SET finish_time = NOW(), update_name = ? WHERE task_id = ? AND deleted = 0',
      [operator, task.id]
    );
    await saveFiles(conn, {
      task, bizType: 'FINISH', photos: list, uploaderType: 'DRIVER', uploaderId: driverId, uploaderName: operator,
    });
    await writeStatusLog(conn, {
      taskId: task.id, taskNo: task.task_no,
      fromStatus: 'ARRIVED', toStatus: 'FINISHED',
      source: 'DRIVER', operator,
      remark: `司机完成客户交接并结单${receiver ? `，接车人：${receiver}` : ''}${remark ? `，备注：${remark}` : ''}`,
      photos: list,
    });
    return { task, version: Number(task.version) + 1 };
  });

  await notify({
    receiverType: 'CARRIER', receiverId: result.task.carrier_id,
    title: '任务已结单',
    content: `任务 ${result.task.task_no} 司机 ${operator} 已完成交接并结单。`,
    bizType: 'FINISH', bizId: result.task.id, channels: ['INBOX'],
  });

  return { task_id: result.task.id, task_no: result.task.task_no, status: 'FINISHED', version: result.version };
}

/** 演示用：模拟 WMS 出库（PICKED → OUTBOUND → IN_TRANSIT） */
async function devWmsOutbound({ taskId }) {
  return withTransaction(async (conn) => {
    const task = await lockTask(conn, taskId);
    if (task.status !== 'PICKED') {
      throw errState(`仅「已提车」任务可模拟出库，当前状态 ${task.status}`);
    }
    await conn.query(
      `UPDATE shipping_task
         SET status = 'IN_TRANSIT', outbound_date = NOW(), version = version + 1, update_name = 'WMS 系统'
       WHERE id = ? AND version = ?`,
      [task.id, task.version]
    );
    await writeStatusLog(conn, {
      taskId: task.id, taskNo: task.task_no, fromStatus: 'PICKED', toStatus: 'OUTBOUND',
      source: 'WMS', operator: 'WMS 系统', remark: 'WMS出库回传，车辆已出库（演示）',
    });
    await writeStatusLog(conn, {
      taskId: task.id, taskNo: task.task_no, fromStatus: 'OUTBOUND', toStatus: 'IN_TRANSIT',
      source: 'WMS', operator: 'WMS 系统', remark: '出库完成，车辆已进入在途运输（演示）',
    });
    return { task_id: task.id, task_no: task.task_no, status: 'IN_TRANSIT', version: Number(task.version) + 1 };
  });
}

module.exports = {
  PICKUP_PHOTO_MIN,
  assignDriver,
  pickupTask,
  arriveTask,
  finishTask,
  devWmsOutbound,
};
