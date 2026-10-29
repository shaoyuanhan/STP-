const crypto = require('node:crypto');
const { query } = require('../db');
const { cutStr } = require('../helpers');
const { verifyToken } = require('./security');

const JSON_FIELDS = ['before_data', 'after_data', 'changed_fields', 'request_params', 'extra'];
const SENSITIVE_KEYS = new Set([
  'password', 'old_password', 'new_password', 'confirm_password', 'token', 'authorization',
  'sms_code', 'smsCode', 'auth_code', 'authCode', 'id_card', 'idCard', 'license_no',
]);

function jsonValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 60000 ? `${text.slice(0, 60000)}...[已截断]` : text;
}

function nullableCut(value, max) {
  if (value === undefined || value === null || value === '') return null;
  return cutStr(value, max);
}

async function recordOperation(data = {}) {
  try {
    const json = {};
    JSON_FIELDS.forEach((field) => { json[field] = jsonValue(data[field]); });
    const duration = data.duration === undefined || data.duration === null || data.duration === ''
      ? null
      : Number(data.duration);
    const numericOperatorId = Number(data.operator_id);
    const operatorId = Number.isSafeInteger(numericOperatorId) && numericOperatorId > 0
      ? numericOperatorId
      : null;
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
        operatorId,
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

function sanitize(value, depth = 0) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') return value;
  if (depth >= 6) return '[层级过深]';
  if (Array.isArray(value)) {
    const list = value.slice(0, 100).map((item) => sanitize(item, depth + 1));
    if (value.length > 100) list.push(`[其余 ${value.length - 100} 项已省略]`);
    return list;
  }
  const output = {};
  Object.entries(value).slice(0, 150).forEach(([key, item]) => {
    output[key] = SENSITIVE_KEYS.has(key) ? '******' : sanitize(item, depth + 1);
  });
  return output;
}

function shouldLog(req) {
  const path = req.originalUrl.split('?')[0];
  if (!path.startsWith('/api/') || path.startsWith('/api/operationLog') || path.startsWith('/api/portal/auth/')) return false;
  if (path.includes('/queryPage')) return false;
  if (req.method === 'GET') return /\/(export|import\/template)\/?$/.test(path);
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
}

function businessOf(path) {
  const rules = [
    [/\/portal\/auth\//, 'AUTH', '用户认证'],
    [/\/factories(?:\/|$)/, 'FACTORY', '工厂'],
    [/\/carriers(?:\/|$)/, 'CARRIER', '承运商'],
    [/\/drivers(?:\/|$)/, 'DRIVER', '司机'],
    [/\/accounts(?:\/|$)/, 'ACCOUNT', '账号'],
    [/\/roles(?:\/|$)/, 'ROLE', '角色'],
    [/\/freight(?:\/|$)/, 'FREIGHT_BILL', '运费单'],
    [/\/esigns?(?:\/|$)/, 'ESIGN', '电子签'],
    [/\/files(?:\/|$)/, 'FILE', '文件'],
    [/\/shipping-tasks(?:\/|$)|\/tasks(?:\/|$)|\/tracking(?:\/|$)|\/wms(?:\/|$)/, 'SHIPPING_TASK', '发运任务'],
  ];
  const hit = rules.find(([pattern]) => pattern.test(path));
  return hit ? { type: hit[1], label: hit[2] } : { type: 'SYSTEM', label: '系统' };
}

function actionOf(req) {
  const path = req.originalUrl.split('?')[0];
  const rules = [
    [/\/(staff-login|driver-login|sms-login|login)(\/|$)/, 'LOGIN', '登录'],
    [/\/sms-code\/?$/, 'SEND_CODE', '发送短信验证码'],
    [/\/switch-carrier\/?$/, 'SWITCH_CARRIER', '切换承运商'],
    [/\/import\/template\/?$/, 'EXPORT', '下载导入模板'],
    [/\/import\/?$/, 'IMPORT', '导入'],
    [/\/export\/?$/, 'EXPORT', '导出'],
    [/\/batch-dispatch\/?$/, 'BATCH_DISPATCH', '批量派单'],
    [/\/dispatch\/cancel\/?$/, 'CANCEL_DISPATCH', '取消派单'],
    [/\/dispatch\/reassign\/?$/, 'REASSIGN', '改派'],
    [/\/dispatch\/?$/, 'DISPATCH', '派单'],
    [/\/cancel-accept\/?$/, 'CANCEL_ACCEPT', '取消接单'],
    [/\/cancel\/?$/, 'CANCEL', '取消'],
    [/\/accept\/?$/, 'ACCEPT', '接单'],
    [/\/pickup\/?$/, 'PICKUP', '确认提车'],
    [/\/arrive\/?$/, 'ARRIVE', '确认到达'],
    [/\/finish\/?$/, 'FINISH', '结单'],
    [/\/reconcile\/?$/, 'RECONCILE', '对账'],
    [/\/permissions\/?$/, 'PERMISSION_UPDATE', '配置权限'],
    [/\/data-scope\/?$/, 'DATA_SCOPE_UPDATE', '配置数据权限'],
    [/\/status\/?$/, 'STATUS', '变更状态'],
    [/\/notifications\/\d+\/read\/?$/, 'READ', '标记消息已读'],
    [/\/receipt-sync\/?$/, 'RECEIPT_SYNC', '同步回单'],
    [/\/sign-status\/?$/, 'SIGN_STATUS', '同步签署状态'],
    [/\/sync\/?$/, 'SYNC', '同步'],
    [/\/receive\/?$/, 'RECEIVE', '接收'],
    [/\/(report|pull)\/?$/, 'TRACKING', '同步轨迹'],
    [/\/upload\/?$/, 'UPLOAD', '上传'],
  ];
  const hit = rules.find(([pattern]) => pattern.test(path));
  if (hit) return { type: hit[1], label: hit[2] };
  if (req.method === 'POST' && /\/files\/?$/.test(path)) return { type: 'UPLOAD', label: '上传' };
  const methods = {
    POST: { type: 'INSERT', label: '新增' },
    PUT: { type: 'UPDATE', label: '编辑' },
    PATCH: { type: 'UPDATE', label: '编辑' },
    DELETE: { type: 'DELETE', label: '删除' },
  };
  return methods[req.method] || { type: 'OTHER', label: '操作' };
}

function businessIdOf(req, responseBody) {
  const body = req.body || {};
  const data = responseBody?.data || {};
  const params = req.params || {};
  if (Array.isArray(body.task_ids)) return body.task_ids.join(',');
  const candidates = [
    params.id, body.task_id, body.taskId, body.id,
    body.task_no, body.taskNo, body.apply_no, body.applyNo,
    data.task_id, data.taskId, data.task_no, data.taskNo, data.id,
    data.profile?.account_id, body.factory_code, body.carrier_code, body.driver_id,
  ];
  const hit = candidates.find((value) => value !== undefined && value !== null && value !== '');
  return hit === undefined ? null : String(hit);
}

function firstPresent(candidates) {
  const hit = candidates.find((value) => value !== undefined && value !== null && value !== '');
  return hit === undefined ? null : String(hit);
}

function businessNumberOf(req, responseBody, businessType) {
  const body = req.body || {};
  const data = responseBody?.data || {};
  const common = [
    body.task_no, body.taskNo, data.task_no, data.taskNo,
    body.order_no, body.orderNo, data.order_no, data.orderNo,
    body.apply_no, body.applyNo, data.apply_no, data.applyNo,
  ];
  const specific = {
    FACTORY: [body.factory_code, data.factory_code],
    CARRIER: [body.carrier_code, data.carrier_code],
    DRIVER: [body.driver_phone, body.phone, data.driver_phone, data.phone],
    ACCOUNT: [body.username, data.username],
    ROLE: [body.role_code, data.role_code],
    AUTH: [body.account, body.username, body.phone, data.profile?.username, data.profile?.phone],
    FREIGHT_BILL: [body.freight_no, body.bill_no, data.freight_no, data.bill_no],
    FILE: [body.file_name, data.file_name],
  };
  return firstPresent([...(specific[businessType] || []), ...common]);
}

async function resolveBusinessIdentity(req, responseBody, business) {
  const fallbackId = businessIdOf(req, responseBody);
  let businessNo = businessNumberOf(req, responseBody, business.type);
  if (business.type !== 'SHIPPING_TASK') {
    return { id: fallbackId || businessNo, number: businessNo || fallbackId };
  }
  const body = req.body || {};
  const data = responseBody?.data || {};
  const taskIdValue = firstPresent([
    req.params?.id, body.task_id, body.taskId, data.task_id, data.taskId, data.id,
  ]);
  const taskId = Number(taskIdValue);
  try {
    if (Number.isSafeInteger(taskId) && taskId > 0) {
      const [task] = await query(
        'SELECT id, task_no, apply_no, order_no FROM shipping_task WHERE id = ? AND deleted = 0 LIMIT 1',
        [taskId]
      );
      if (task) {
        businessNo = task.task_no || businessNo || task.apply_no || task.order_no;
        return { id: String(task.id), number: businessNo };
      }
    } else if (businessNo && (body.task_no || body.taskNo || body.order_no || body.orderNo || data.task_no || data.taskNo)) {
      const [task] = await query(
        `SELECT id, task_no, apply_no, order_no FROM shipping_task
         WHERE deleted = 0 AND (task_no = ? OR order_no = ?)
         LIMIT 1`,
        [businessNo, businessNo]
      );
      if (task) {
        return { id: String(task.id), number: task.task_no || businessNo };
      }
    }
  } catch (error) {
    console.error('[STP 日志业务单号解析失败]', error);
  }
  return { id: fallbackId || businessNo, number: businessNo || fallbackId };
}

function operatorOf(req, responseBody, path) {
  const profile = responseBody?.data?.profile;
  if (profile) return { id: profile.account_id, name: profile.name || profile.username };
  let auth = req.auth;
  if (!auth) {
    const header = String(req.headers.authorization || '');
    if (header.startsWith('Bearer ')) auth = verifyToken(header.slice(7).trim());
  }
  if (auth) return { id: auth.sub, name: auth.name || auth.type };
  if (path.startsWith('/api/external/')) return { id: null, name: '外部系统' };
  if (path.startsWith('/api/portal/auth/')) {
    const body = req.body || {};
    return { id: null, name: body.account || body.username || body.accountName || body.phone || '未登录用户' };
  }
  return { id: null, name: '未知用户' };
}

function operationLogMiddleware(req, res, next) {
  if (!shouldLog(req)) return next();
  const startedAt = Date.now();
  const path = req.originalUrl.split('?')[0];
  const traceId = nullableCut(req.headers['x-trace-id'], 64) || crypto.randomUUID();
  let responseBody = null;
  const originalJson = res.json;
  res.json = function jsonWithSnapshot(body) {
    responseBody = body;
    return originalJson.call(this, body);
  };
  res.on('finish', async () => {
    const business = businessOf(path);
    const action = actionOf(req);
    const operator = operatorOf(req, responseBody, path);
    const success = res.statusCode < 400 && (!responseBody?.code || responseBody.code === '00000');
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const identity = await resolveBusinessIdentity(req, responseBody, business);
    await recordOperation({
      trace_id: traceId,
      operation_type: action.type,
      business_type: business.type,
      business_id: identity.id,
      operation_desc: `${business.label}${action.label}`,
      operator_id: operator.id,
      operator_name: operator.name,
      operator_ip: req.ip,
      operator_time: new Date(startedAt),
      after_data: success ? sanitize(responseBody?.data ?? null) : null,
      changed_fields: Object.keys(body).filter((key) => !SENSITIVE_KEYS.has(key)),
      request_url: path,
      request_method: req.method,
      request_params: sanitize({ query: req.query, body }),
      result_status: success ? 'SUCCESS' : 'FAIL',
      error_message: success ? null : responseBody?.message || `HTTP ${res.statusCode}`,
      duration: Date.now() - startedAt,
      extra: { http_status: res.statusCode, business_no: identity.number },
      remark: responseBody?.message || null,
    });
  });
  return next();
}

module.exports = { recordOperation, operationLogMiddleware };
