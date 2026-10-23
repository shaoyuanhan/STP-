/**
 * 运输调度 - 在途监控（契约 5.5）
 * 列表：scope=transit（默认）仅「在途」任务；scope=history 已完结任务的历史轨迹
 *       含最近一条位置信息与 VIN/车型
 * 详情：task + statusLogs + tracks（时间升序）
 */
const { Router } = require('express');
const { query } = require('../db');
const { wrap, ok, errNotFound, errParam, pageOf, pageData } = require('../helpers');

const router = Router();

/** 子页面范围 → 任务状态（transit 在途监控 / history 历史轨迹） */
const SCOPE_STATUSES = {
  transit: ['IN_TRANSIT'],
  history: ['FINISHED'],
};

/**
 * 每单最近一次位置：按上报时间取最新，同刻多条再取最大 id。
 * 异常线路以「最近一次上报距今是否超过 1 小时」判定，不能只看自增 id。
 */
const LATEST_TRACK_JOIN = `LEFT JOIN (
       SELECT tr.task_id, MAX(tr.id) AS max_id
       FROM transport_track tr
       INNER JOIN (
         SELECT task_id, MAX(report_time) AS report_time
         FROM transport_track
         WHERE deleted = 0
         GROUP BY task_id
       ) latest ON latest.task_id = tr.task_id AND latest.report_time = tr.report_time
       WHERE tr.deleted = 0
       GROUP BY tr.task_id
     ) lm ON lm.task_id = t.id
     LEFT JOIN transport_track tr ON tr.id = lm.max_id`;

/** 列表公共 SELECT 片段（VIN/车型取车辆明细聚合） */
const LIST_FIELDS = `t.id, t.task_no, t.order_no, t.apply_no, t.customer_name, t.status,
            t.ship_location, t.delivery_address, t.plan_freight, t.mileage,
            t.plan_pickup_date, t.ship_time,
            t.outbound_date, t.arrive_time, t.finish_time, t.create_time, t.version,
            (SELECT GROUP_CONCAT(v.vin ORDER BY v.id SEPARATOR '、') FROM shipping_task_vehicle v WHERE v.task_id = t.id AND v.deleted = 0) AS vins,
            (SELECT GROUP_CONCAT(v.vehicle_model ORDER BY v.id SEPARATOR '、') FROM shipping_task_vehicle v WHERE v.task_id = t.id AND v.deleted = 0) AS vehicle_models,
            c.carrier_name, d.driver_name, d.phone AS driver_phone,
            tr.transport_no, tr.location_desc, tr.longitude, tr.latitude, tr.speed, tr.report_time`;

/** 列表行收拢最近一条位置为 latest_track（无回传时为 null） */
function withLatestTrack(row) {
  const { transport_no, location_desc, longitude, latitude, speed, report_time, ...rest } = row;
  return {
    ...rest,
    latest_track: report_time
      ? { transport_no: transport_no ?? null, location_desc, longitude, latitude, speed, report_time }
      : null,
  };
}

/** 在途 / 已完结任务列表（scope 区分） */
router.get('/tasks', wrap(async (req, res) => {
  const { page, size, offset } = pageOf(req.query);
  const { task_no = '', transport_no = '' } = req.query;
  const scope = String(req.query.scope ?? 'transit').trim() || 'transit';
  const statuses = SCOPE_STATUSES[scope];
  if (!statuses) throw errParam('scope 仅支持 transit（在途）或 history（已完结）');

  const where = [`t.deleted = 0`, `t.status IN (${statuses.map(() => '?').join(',')})`];
  const params = [...statuses];
  if (task_no) where.push('t.task_no LIKE ?'), params.push(`%${task_no}%`);
  if (transport_no) {
    where.push('EXISTS (SELECT 1 FROM transport_track tr WHERE tr.task_id = t.id AND tr.deleted = 0 AND tr.transport_no LIKE ?)');
    params.push(`%${transport_no}%`);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const orderSql = scope === 'history'
    ? 'ORDER BY t.finish_time DESC, t.id DESC'
    : 'ORDER BY t.create_time DESC, t.id DESC';

  const totalRows = await query(`SELECT COUNT(*) AS n FROM shipping_task t ${whereSql}`, params);
  const list = await query(
    `SELECT ${LIST_FIELDS}
     FROM shipping_task t
     LEFT JOIN carrier c ON c.id = t.carrier_id
     LEFT JOIN driver d ON d.id = t.driver_id
     ${LATEST_TRACK_JOIN}
     ${whereSql}
     ${orderSql}
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(list.map(withLatestTrack), Number(totalRows[0].n), page, size));
}));

/** 总览轨迹降采样上限：全国视图无需每一条回传点 */
const OVERVIEW_MAX_POINTS = 60;

/** 等距抽取轨迹点，保留首尾 */
function simplifyPoints(list) {
  if (list.length <= OVERVIEW_MAX_POINTS) return list;
  const step = (list.length - 1) / (OVERVIEW_MAX_POINTS - 1);
  const out = [];
  for (let i = 0; i < OVERVIEW_MAX_POINTS; i++) out.push(list[Math.round(i * step)]);
  return out;
}

/**
 * 全国态势总览：一次返回范围内全部运单 + 各自轨迹折线（已降采样）
 * 供「全国态势」页做全国地图、聚合气泡与省份热力，避免前端逐单拉详情
 */
router.get('/overview', wrap(async (req, res) => {
  const scope = String(req.query.scope ?? 'transit').trim() || 'transit';
  const statuses = SCOPE_STATUSES[scope];
  if (!statuses) throw errParam('scope 仅支持 transit（在途）或 history（已完结）');

  const orderSql = scope === 'history'
    ? 'ORDER BY t.finish_time DESC, t.id DESC'
    : 'ORDER BY t.create_time DESC, t.id DESC';

  const rows = await query(
    `SELECT ${LIST_FIELDS}
     FROM shipping_task t
     LEFT JOIN carrier c ON c.id = t.carrier_id
     LEFT JOIN driver d ON d.id = t.driver_id
     ${LATEST_TRACK_JOIN}
     WHERE t.deleted = 0 AND t.status IN (${statuses.map(() => '?').join(',')})
     ${orderSql}
     LIMIT 300`,
    statuses
  );

  if (!rows.length) return ok(res, { scope, tasks: [] });

  const ids = rows.map((row) => row.id);
  const tracks = await query(
    `SELECT task_id, longitude, latitude, location_desc, speed, report_time
     FROM transport_track
     WHERE deleted = 0 AND task_id IN (${ids.map(() => '?').join(',')})
     ORDER BY task_id, report_time, id`,
    ids
  );

  const grouped = new Map();
  for (const track of tracks) {
    if (!grouped.has(track.task_id)) grouped.set(track.task_id, []);
    grouped.get(track.task_id).push(track);
  }

  const tasks = rows.map((row) => {
    const points = simplifyPoints(grouped.get(row.id) || [])
      .filter((t) => Number.isFinite(Number(t.longitude)) && Number.isFinite(Number(t.latitude)))
      .map((t) => [Number(t.longitude), Number(t.latitude)]);
    return { ...withLatestTrack(row), points };
  });

  ok(res, { scope, tasks });
}));

/** 运单详情：运单信息 + 运输节点 + 位置轨迹（时间升序），在途与历史轨迹共用 */
router.get('/tasks/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const [task] = await query(
    `SELECT t.*, c.carrier_name, d.driver_name, d.phone AS driver_phone,
            (SELECT GROUP_CONCAT(v.vin ORDER BY v.id SEPARATOR '、') FROM shipping_task_vehicle v WHERE v.task_id = t.id AND v.deleted = 0) AS vins,
            (SELECT GROUP_CONCAT(v.vehicle_model ORDER BY v.id SEPARATOR '、') FROM shipping_task_vehicle v WHERE v.task_id = t.id AND v.deleted = 0) AS vehicle_models
     FROM shipping_task t
     LEFT JOIN carrier c ON c.id = t.carrier_id
     LEFT JOIN driver d ON d.id = t.driver_id
     WHERE t.id = ? AND t.deleted = 0`,
    [id]
  );
  if (!task) throw errNotFound('运单不存在');

  const [statusLogs, tracks] = await Promise.all([
    query('SELECT * FROM task_status_log WHERE task_id = ? AND deleted = 0 ORDER BY create_time, id', [id]),
    query('SELECT * FROM transport_track WHERE task_id = ? AND deleted = 0 ORDER BY report_time, id', [id]),
  ]);
  ok(res, { task, statusLogs, tracks });
}));

module.exports = router;
