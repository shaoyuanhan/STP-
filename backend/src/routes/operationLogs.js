/**
 * 系统操作日志：分页查询、详情及业务日志写入。
 * recordOperation 内部捕获全部异常，避免日志失败影响主业务流程。
 */
const { Router } = require('express');
const { query } = require('../db');
const { ok, wrap, errParam, errNotFound, pageOf, pageData, cutStr } = require('../helpers');

const router = Router();
const JSON_FIELDS = ['before_data', 'after_data', 'changed_fields', 'request_params', 'extra'];

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

function operationLogWhere(q) {
  const where = ['deleted = 0'];
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

  if (hasValue(q.business_id)) {
    where.push('business_id LIKE ?');
    params.push(`%${String(q.business_id).trim()}%`);
  }
  if (hasValue(q.operator_name)) {
    where.push('operator_name LIKE ?');
    params.push(`%${String(q.operator_name).trim()}%`);
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

async function listOperationLogs(req, res) {
  const input = operationLogInput(req);
  const { page, size, offset } = pageOf(input);
  const { whereSql, params } = operationLogWhere(input);
  const totalRows = await query(`SELECT COUNT(*) AS n FROM sys_operation_log ${whereSql}`, params);
  const list = await query(
    `SELECT * FROM sys_operation_log
     ${whereSql}
     ORDER BY operator_time DESC, id DESC
     LIMIT ? OFFSET ?`,
    [...params, size, offset]
  );
  ok(res, pageData(list.map(withCamelKeys), Number(totalRows[0].n), page, size));
}

router.get('/', wrap(listOperationLogs));
router.post('/queryPage', wrap(listOperationLogs));

router.get('/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw errParam('日志 ID 不正确');
  const [row] = await query('SELECT * FROM sys_operation_log WHERE id = ? AND deleted = 0', [id]);
  if (!row) throw errNotFound('操作日志不存在');
  ok(res, withCamelKeys(row));
}));

function nullableCut(value, max) {
  if (value === undefined || value === null) return null;
  return cutStr(value, max);
}

function jsonValue(value) {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/**
 * 写入操作日志。调用方可 await，也可在业务完成后调用；任何失败均只记录服务端错误。
 * JSON 字段可直接传对象/数组，也可传已序列化字符串。
 */
async function recordOperation(data = {}) {
  try {
    const json = {};
    JSON_FIELDS.forEach((field) => { json[field] = jsonValue(data[field]); });
    const duration = data.duration === undefined || data.duration === null || data.duration === ''
      ? null
      : Number(data.duration);

    const result = await query(
      `INSERT INTO sys_operation_log
       (trace_id, operation_type, business_type, business_id, operation_desc,
        operator_id, operator_name, operator_ip, operator_time, before_data,
        after_data, changed_fields, request_url, request_method, request_params,
        result_status, error_message, duration, extra, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nullableCut(data.trace_id, 64),
        nullableCut(data.operation_type || 'OTHER', 64),
        nullableCut(data.business_type, 64),
        nullableCut(data.business_id, 64),
        nullableCut(data.operation_desc, 1000),
        nullableCut(data.operator_id, 64),
        nullableCut(data.operator_name, 128),
        nullableCut(data.operator_ip, 64),
        data.operator_time || new Date(),
        json.before_data,
        json.after_data,
        json.changed_fields,
        nullableCut(data.request_url, 1024),
        nullableCut(data.request_method, 16),
        json.request_params,
        nullableCut(data.result_status || 'SUCCESS', 32),
        nullableCut(data.error_message, 2000),
        Number.isFinite(duration) ? Math.trunc(duration) : null,
        json.extra,
        nullableCut(data.remark, 512),
      ]
    );
    return result.insertId;
  } catch (error) {
    console.error('[STP 操作日志写入失败]', error);
    return null;
  }
}

module.exports = router;
module.exports.recordOperation = recordOperation;
