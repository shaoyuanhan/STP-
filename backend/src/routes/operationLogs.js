const { Router } = require('express');
const { query } = require('../db');
const { ok, wrap, errParam, errNotFound, pageOf, pageData } = require('../helpers');
const { recordOperation } = require('../services/operationLogger');

const router = Router();

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function timeValue(value, endOfDay = false) {
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return `${text} ${endOfDay ? '23:59:59' : '00:00:00'}`;
  }
  return text;
}

function operationLogInput(req) {
  const source = req.method === 'POST' ? (req.body || {}) : req.query;
  return {
    ...source,
    size: source.size ?? source.pageSize,
    trace_id: source.trace_id ?? source.traceId,
    operation_type: source.operation_type ?? source.operationType,
    business_type: source.business_type ?? source.businessType,
    business_id: source.business_id ?? source.businessId,
    operator_id: source.operator_id ?? source.operatorId,
    operator_name: source.operator_name ?? source.operatorName,
    start_time: source.start_time ?? source.startTime,
    end_time: source.end_time ?? source.endTime,
    result_status: source.result_status ?? source.resultStatus,
  };
}

async function operationLogWhere(q) {
  const where = ['deleted = 0', "business_type <> 'AUTH'"];
  const params = [];
  const exactFilters = [
    ['trace_id', 'trace_id'],
    ['operation_type', 'operation_type'],
    ['business_type', 'business_type'],
    ['operator_id', 'operator_id'],
    ['result_status', 'result_status'],
  ];
  exactFilters.forEach(([queryKey, column]) => {
    if (hasValue(q[queryKey])) {
      where.push(`${column} = ?`);
      params.push(String(q[queryKey]).trim());
    }
  });
  if (hasValue(q.business_id_exact)) {
    where.push('business_id = ?');
    params.push(String(q.business_id_exact).trim());
  } else if (hasValue(q.business_id)) {
    const businessNo = String(q.business_id).trim();
    const keyword = `%${businessNo}%`;
    const conditions = [
      'business_id LIKE ?',
      "JSON_UNQUOTE(JSON_EXTRACT(extra, '$.business_no')) LIKE ?",
    ];
    params.push(keyword, keyword);
    if (!hasValue(q.business_type) || q.business_type === 'SHIPPING_TASK') {
      const tasks = await query(
        `SELECT id FROM shipping_task
         WHERE deleted = 0 AND (task_no LIKE ? OR apply_no LIKE ? OR order_no LIKE ?)
         LIMIT 500`,
        [keyword, keyword, keyword]
      );
      if (tasks.length) {
        conditions.push(`(business_type = 'SHIPPING_TASK' AND business_id IN (${tasks.map(() => '?').join(',')}))`);
        tasks.forEach((task) => params.push(String(task.id)));
      }
    }
    where.push(`(${conditions.join(' OR ')})`);
  }
  if (hasValue(q.operator_name)) {
    where.push('operator_name LIKE ?');
    params.push(`%${String(q.operator_name).trim()}%`);
  }
  if (hasValue(q.keyword)) {
    where.push('(operation_desc LIKE ? OR request_url LIKE ? OR error_message LIKE ? OR remark LIKE ?)');
    const keyword = `%${String(q.keyword).trim()}%`;
    params.push(keyword, keyword, keyword, keyword);
  }
  if (hasValue(q.start_time)) {
    where.push('operator_time >= ?');
    params.push(timeValue(q.start_time));
  }
  if (hasValue(q.end_time)) {
    where.push('operator_time <= ?');
    params.push(timeValue(q.end_time, true));
  }
  return { whereSql: `WHERE ${where.join(' AND ')}`, params };
}

function withCamelKeys(row) {
  const result = { ...row };
  Object.entries(row).forEach(([key, value]) => {
    result[key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  });
  return result;
}

async function attachBusinessNumbers(rows) {
  const result = rows.map((row) => {
    let businessNo = null;
    try {
      businessNo = row.extra ? JSON.parse(row.extra).business_no : null;
    } catch {
      businessNo = null;
    }
    return { ...row, business_no: businessNo || row.business_id };
  });
  const taskIds = result
    .filter((row) => row.business_type === 'SHIPPING_TASK' && /^\d+$/.test(String(row.business_id || '')))
    .map((row) => Number(row.business_id));
  if (!taskIds.length) return result;
  const uniqueIds = [...new Set(taskIds)];
  const tasks = await query(
    `SELECT id, task_no, apply_no, order_no FROM shipping_task
     WHERE deleted = 0 AND id IN (${uniqueIds.map(() => '?').join(',')})`,
    uniqueIds
  );
  const taskMap = new Map(tasks.map((task) => [String(task.id), task]));
  result.forEach((row) => {
    const task = taskMap.get(String(row.business_id));
    if (task) row.business_no = task.task_no || task.apply_no || task.order_no || row.business_no;
  });
  return result;
}

async function listOperationLogs(req, res) {
  const input = operationLogInput(req);
  const { page, size, offset } = pageOf(input);
  const { whereSql, params } = await operationLogWhere(input);
  const direction = String(input.order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const totalRows = await query(`SELECT COUNT(*) AS n FROM sys_operation_log ${whereSql}`, params);
  const list = await query(
    `SELECT * FROM sys_operation_log
     ${whereSql}
     ORDER BY operator_time ${direction}, id ${direction}
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  const enriched = await attachBusinessNumbers(list);
  ok(res, pageData(enriched.map(withCamelKeys), Number(totalRows[0].n), page, size));
}

router.get('/', wrap(listOperationLogs));
router.post('/queryPage', wrap(listOperationLogs));

router.get('/operators', wrap(async (_req, res) => {
  const rows = await query(
    `SELECT operator_id, operator_name, COUNT(*) AS operation_count, MAX(operator_time) AS last_operation_time
     FROM sys_operation_log
     WHERE deleted = 0 AND business_type <> 'AUTH'
       AND operator_name IS NOT NULL AND operator_name <> ''
     GROUP BY operator_id, operator_name
     ORDER BY last_operation_time DESC
     LIMIT 500`
  );
  ok(res, rows.map(withCamelKeys));
}));

router.get('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw errParam('日志 ID 不正确');
  const [row] = await query('SELECT * FROM sys_operation_log WHERE id = ? AND deleted = 0', [id]);
  if (!row) throw errNotFound('操作日志不存在');
  const [enriched] = await attachBusinessNumbers([row]);
  ok(res, withCamelKeys(enriched));
}));

module.exports = router;
module.exports.recordOperation = recordOperation;
