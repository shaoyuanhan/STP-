/**
 * 通用辅助：统一响应信封 / 错误码 / 异步包装 / 分页 / 电话校验
 * STP 智能运输管理平台
 *
 * 统一响应契约（契约第 2 节）：
 *   成功: { "code": "00000", "message": "success", "data": {...} }
 *   失败: { "code": "A0001", "message": "中文错误信息", "data": null }
 *
 * 错误码与 HTTP 映射：
 *   00000 成功           200
 *   A0001 参数校验失败    400
 *   A0002 业务校验失败    400（重名、VIN 不匹配、状态不合法的业务规则等）
 *   B0001 系统内部异常    500
 *   C0001 重复请求        409（幂等拦截）
 *   D0001 状态不允许该操作/版本冲突 409
 *   D0002 数据不存在      404
 */
class ApiError extends Error {
  /** @param {string} code 错误码 @param {string} message 中文错误信息 */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** 错误码 -> HTTP 状态码映射 */
const CODE_HTTP = {
  '00000': 200,
  A0001: 400,
  A0002: 400,
  B0001: 500,
  C0001: 409,
  D0001: 409,
  D0002: 404,
};

/* ---------------- 常用错误构造器 ---------------- */
const errParam = (message) => new ApiError('A0001', message);   // 参数校验失败
const errBiz = (message) => new ApiError('A0002', message);      // 业务校验失败
const errDup = (message) => new ApiError('C0001', message);      // 重复请求（幂等拦截）
const errState = (message) => new ApiError('D0001', message);    // 状态不允许该操作/版本冲突
const errNotFound = (message) => new ApiError('D0002', message); // 数据不存在

/** 统一成功响应信封 */
function ok(res, data = null, message = 'success') {
  return res.json({ code: '00000', message, data });
}

/** 异步路由包装：Promise 异常统一交给 errorHandler */
const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** 统一错误处理：业务错误按错误码映射 HTTP，其余按系统内部异常 */
function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(CODE_HTTP[err.code] || 500).json({ code: err.code, message: err.message, data: null });
  }
  // 请求体 JSON 解析失败属于参数校验失败
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ code: 'A0001', message: '请求体不是合法的 JSON 格式', data: null });
  }
  console.error('[STP 系统异常]', err);
  res.status(500).json({ code: 'B0001', message: '系统内部异常，请稍后重试', data: null });
}

/** 从查询参数读取分页：兼容 size 与 OpenAPI pageSize，上限 100 */
function pageOf(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(query.size ?? query.pageSize, 10) || 10));
  return { page, size, offset: (page - 1) * size };
}

/** 分页数据结构 */
function pageData(list, total, page, size, extra = {}) {
  return { list, total, page, size, ...extra };
}

/** GET 读取 query，POST 读取 body，并补充 OpenAPI 驼峰字段到现有筛选字段的映射 */
function queryOf(req, aliases = {}) {
  const source = req.method === 'GET' ? req.query : (req.body || {});
  const result = { ...source };
  for (const [camelName, snakeName] of Object.entries(aliases)) {
    if (result[snakeName] === undefined && source[camelName] !== undefined) {
      result[snakeName] = source[camelName];
    }
  }
  return result;
}

const { parsePhoneNumberFromString: parsePhone } = require('libphonenumber-js/max');

/** 本地日期串 YYYY-MM-DD（toISOString 为 UTC，东八区 0-8 点生成的单号/日期会错一天） */
function localDateStr(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

/**
 * 电话校验与归一化（基于 Google libphonenumber，保留自旧版实现）。
 * 存储统一 E.164（如 +8613812345678）；无 + 前缀按中国号码解析。
 * mobileOnly=true 时要求号码类型为手机。
 * 校验失败抛 A0001 参数校验失败（中文报错）。
 */
function assertPhone(value, { label = '联系电话', mobileOnly = false, required = true } = {}) {
  const v = String(value ?? '').trim();
  if (!v) {
    if (required) throw errParam(`${label}必填`);
    return null;
  }
  if (v.length > 25) throw errParam(`${label}长度不正确`);
  const p = v.startsWith('+') ? parsePhone(v) : parsePhone(v, 'CN');
  if (!p || !p.isValid()) {
    throw errParam(`${label}格式不正确：国内支持手机号（11 位）、座机（区号+8 位号码，如 0551-63612345）、400/800 号码（10 位）；国外号码需带国家区号（如 +1 202-555-0123）`);
  }
  if (mobileOnly) {
    const t = p.getType();
    if (t !== 'MOBILE' && t !== 'FIXED_LINE_OR_MOBILE') {
      throw errParam('座机/热线号码不可用，请填写手机号');
    }
  }
  return p.number;
}

/** 身份证号格式校验（18 位，末位允许 X） */
function assertIdCard(value, { label = '身份证号', required = true } = {}) {
  const v = String(value ?? '').trim();
  if (!v) {
    if (required) throw errParam(`${label}必填`);
    return null;
  }
  if (!/^\d{17}[\dXx]$/.test(v)) throw errParam(`${label}格式不正确，应为 18 位（末位可为 X）`);
  return v.toUpperCase();
}

/** 金额校验：非负数字，返回 Number */
function assertAmount(value, { label = '金额', required = true, min = 0 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw errParam(`${label}必填`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) throw errParam(`${label}无效，不能小于 ${min}`);
  return n;
}

/** 字符串截断保护（防止超出数据库字段长度） */
function cutStr(v, max) {
  const s = String(v ?? '');
  return s.length > max ? s.slice(0, max) : s;
}

module.exports = {
  ApiError,
  errParam,
  errBiz,
  errDup,
  errState,
  errNotFound,
  ok,
  wrap,
  errorHandler,
  pageOf,
  pageData,
  queryOf,
  localDateStr,
  assertPhone,
  assertIdCard,
  assertAmount,
  cutStr,
};
