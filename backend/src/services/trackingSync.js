/**
 * 在途点位定时拉取（STP → 狮桥）
 *
 * 替代狮桥推送模式：STP 按固定周期请求狮桥点位接口，返回数据写入 transport_track，
 * 供运输监控地图与轨迹使用。仅在途任务落库；同一任务同一上报时间幂等。
 * 未配置 LQ_TRACKING_URL 时不启用，不影响服务启动。
 */
const { query } = require('../db');
const { cutStr } = require('../helpers');

const ACTIVE_STATUSES = ['IN_TRANSIT'];

let timer = null;
let running = false;
let lastSyncAt = 0;

const pullUrl = () => String(process.env.LQ_TRACKING_URL || '').trim();
const intervalMs = () => Number(process.env.LQ_TRACKING_INTERVAL_MS) || 5 * 60 * 1000;
const firstWindowMs = () => Number(process.env.LQ_TRACKING_FIRST_WINDOW_MS) || 60 * 60 * 1000;
const overlapMs = () => Number(process.env.LQ_TRACKING_OVERLAP_MS) || 10 * 60 * 1000;

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Date → 'YYYY-MM-DD HH:mm:ss'（本地时区，与 mysql dateStrings 一致） */
function fmtDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 兼容 'YYYY-MM-DD HH:mm:ss' / ISO / 秒或毫秒时间戳 */
function toDateTime(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return fmtDateTime(new Date(value > 1e12 ? value : value * 1000));
  }
  const text = String(value).trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6] || '00'}`;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : fmtDateTime(d);
}

function pick(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function text(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

/** 兼容常见字段命名，便于狮桥侧按自身结构返回 */
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const longitude = Number(pick(raw, ['longitude', 'lng', 'lon']));
  const latitude = Number(pick(raw, ['latitude', 'lat']));
  const speedRaw = pick(raw, ['speed', 'gpsSpeed']);
  const speed = speedRaw === undefined ? null : Number(speedRaw);
  return {
    orderNo: text(pick(raw, ['orderNo', 'order_no', 'orderNumber'])),
    taskNo: text(pick(raw, ['taskNo', 'task_no', 'taskNumber'])),
    vin: text(pick(raw, ['vin', 'VIN', 'vehicleNo'])).toUpperCase(),
    transportNo: text(pick(raw, ['transportNo', 'transport_no', 'transportNumber'])),
    longitude,
    latitude,
    locationDesc: cutStr(text(pick(raw, ['locationDesc', 'location_desc', 'address', 'location', 'position'])) || '位置更新', 255),
    speed: Number.isFinite(speed) ? speed : null,
    reportAt: toDateTime(pick(raw, ['reportTime', 'report_time', 'locateTime', 'gpsTime', 'time'])),
  };
}

/** 从返回体解出点位数组 */
function extractList(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  for (const key of ['data', 'list', 'records', 'rows', 'items']) {
    if (Array.isArray(body[key])) return body[key];
  }
  if (body.data && typeof body.data === 'object') {
    for (const key of ['list', 'records', 'rows', 'items', 'tracks']) {
      if (Array.isArray(body.data[key])) return body.data[key];
    }
  }
  return [];
}

/** 批量定位任务：订单号优先，其次任务单号，最后 VIN */
async function loadTaskIndex(points) {
  const index = new Map();
  const mark = (prefix, key, task) => {
    if (key && !index.has(`${prefix}:${key}`)) index.set(`${prefix}:${key}`, task);
  };
  const uniq = (values) => [...new Set(values.filter(Boolean))];

  const orderNos = uniq(points.map((p) => p.orderNo));
  if (orderNos.length) {
    const rows = await query(
      `SELECT t.* FROM shipping_task t WHERE t.deleted = 0 AND t.order_no IN (${orderNos.map(() => '?').join(',')})`,
      orderNos
    );
    rows.forEach((row) => mark('order', row.order_no, row));
  }

  const taskNos = uniq(points.map((p) => p.taskNo));
  if (taskNos.length) {
    const rows = await query(
      `SELECT t.* FROM shipping_task t WHERE t.deleted = 0 AND t.task_no IN (${taskNos.map(() => '?').join(',')})`,
      taskNos
    );
    rows.forEach((row) => mark('task', row.task_no, row));
  }

  const vins = uniq(points.map((p) => p.vin));
  if (vins.length) {
    const rows = await query(
      `SELECT t.*, v.vin FROM shipping_task t
       INNER JOIN shipping_task_vehicle v ON v.task_id = t.id AND v.deleted = 0
       WHERE t.deleted = 0 AND v.vin IN (${vins.map(() => '?').join(',')})`,
      vins
    );
    rows.forEach((row) => mark('vin', String(row.vin).toUpperCase(), row));
  }

  return index;
}

function resolveTask(index, point) {
  if (point.orderNo && index.has(`order:${point.orderNo}`)) return index.get(`order:${point.orderNo}`);
  if (point.taskNo && index.has(`task:${point.taskNo}`)) return index.get(`task:${point.taskNo}`);
  if (point.vin && index.has(`vin:${point.vin}`)) return index.get(`vin:${point.vin}`);
  return null;
}

async function fetchPoints(url, from, to) {
  const target = new URL(url);
  target.searchParams.set('from', fmtDateTime(from));
  target.searchParams.set('to', fmtDateTime(to));
  const token = String(process.env.LQ_TRACKING_TOKEN || '').trim();
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(target, { headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`狮桥点位接口返回 HTTP ${response.status}`);
  return extractList(await response.json());
}

/**
 * 执行一次拉取。
 * from/to 可传入 'YYYY-MM-DD HH:mm:ss' 或 Date；不传则按周期窗口。
 */
async function pullTrackingOnce({ from, to } = {}) {
  const url = pullUrl();
  if (!url) return { enabled: false, message: '未配置 LQ_TRACKING_URL，在途点位拉取未启用' };
  if (running) return { enabled: true, skipped: true, message: '上一次拉取尚未结束，本次跳过' };

  running = true;
  const toDate = to ? new Date(to) : new Date();
  const endTime = Number.isNaN(toDate.getTime()) ? new Date() : toDate;
  const fromDate = from
    ? new Date(from)
    : new Date((lastSyncAt ? lastSyncAt - overlapMs() : endTime.getTime() - firstWindowMs()));

  try {
    const rawList = await fetchPoints(url, fromDate, endTime);
    const points = rawList.map(normalize).filter((p) => p && Number.isFinite(p.longitude) && Number.isFinite(p.latitude));
    const index = await loadTaskIndex(points);
    const now = fmtDateTime(new Date());

    let matched = 0;
    let inserted = 0;
    let skipped = 0;
    const errors = [];

    for (const point of points) {
      const task = resolveTask(index, point);
      if (!task) { skipped += 1; continue; }
      matched += 1;
      if (!ACTIVE_STATUSES.includes(task.status)) { skipped += 1; continue; }
      const reportAt = point.reportAt || now;
      if (reportAt > now) { skipped += 1; continue; }

      try {
        const transportNo = point.transportNo || `SQ${now.slice(0, 10).replace(/-/g, '')}${String(task.id).padStart(4, '0')}`;
        const result = await query(
          `INSERT INTO transport_track
             (task_id, task_no, transport_no, longitude, latitude, location_desc, speed, report_time, create_id, create_name, update_name)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'JOB', 'JOB' FROM DUAL
           WHERE NOT EXISTS (
             SELECT 1 FROM transport_track WHERE task_id = ? AND report_time = ? AND deleted = 0
           )`,
          [task.id, task.task_no, transportNo, point.longitude, point.latitude,
            point.locationDesc, point.speed, reportAt, task.id, reportAt]
        );
        if (result.affectedRows > 0) inserted += 1;
        else skipped += 1;
      } catch (error) {
        errors.push({ taskNo: task.task_no, message: error.message });
      }
    }

    lastSyncAt = endTime.getTime();
    return {
      enabled: true,
      from: fmtDateTime(fromDate),
      to: fmtDateTime(endTime),
      fetched: points.length,
      matched,
      inserted,
      skipped,
      errors,
      message: `拉取完成：获取 ${points.length} 条，匹配 ${matched} 条，新增 ${inserted} 条`,
    };
  } finally {
    running = false;
  }
}

/** 启动定时拉取（服务启动时调用） */
function startTrackingSync() {
  if (!pullUrl()) {
    console.log('[STP] 在途点位拉取未启用（未配置 LQ_TRACKING_URL）');
    return;
  }
  if (timer) return;

  const run = () => {
    pullTrackingOnce()
      .then((result) => {
        if (result.enabled && !result.skipped) console.log(`[STP] ${result.message}`);
      })
      .catch((error) => console.error('[STP] 在途点位拉取失败', error.message));
  };

  timer = setInterval(run, intervalMs());
  timer.unref();
  setTimeout(run, 5000).unref();
  console.log(`[STP] 在途点位拉取已启用：每 ${Math.round(intervalMs() / 60000)} 分钟拉取一次`);
}

module.exports = { startTrackingSync, pullTrackingOnce };
