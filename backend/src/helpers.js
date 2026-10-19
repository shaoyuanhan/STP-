/**
 * 通用辅助：异步包装 / 业务错误 / 分页
 */
class BizError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/** 业务错误 -> 4xx；其余 -> 500 */
function errorHandler(err, req, res, _next) {
  if (err instanceof BizError) {
    return res.status(err.status).json({ message: err.message });
  }
  console.error('[STP ERROR]', err);
  res.status(500).json({ message: '服务器内部错误，请稍后重试' });
}

/** 从 req.query 读取分页参数 */
function pageOf(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(query.size, 10) || 10));
  return { page, size, offset: (page - 1) * size };
}

const { parsePhoneNumberFromString: parsePhone } = require('libphonenumber-js/max');

/** 本地日期串 YYYY-MM-DD（toISOString 为 UTC，东八区 0-8 点生成的单号/日期会错一天） */
function localDateStr(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

/**
 * 电话校验与归一化（基于 Google libphonenumber）。
 * 存储统一 E.164（如 +8613812345678）；无 + 前缀按中国号码解析。
 * mobileOnly=true 时要求号码类型为手机。
 */
function assertPhone(value, { label = '联系电话', mobileOnly = false, required = true } = {}) {
  const v = String(value ?? '').trim();
  if (!v) {
    if (required) throw new BizError(`${label}必填`);
    return null;
  }
  if (v.length > 25) throw new BizError(`${label}长度不正确`);
  const p = v.startsWith('+') ? parsePhone(v) : parsePhone(v, 'CN');
  if (!p || !p.isValid()) {
    throw new BizError(`${label}格式不正确：国内支持手机号（11 位）、座机（区号+8 位号码，如 0551-63612345）、400/800 号码（10 位）；国外号码需带国家区号（如 +1 202-555-0123）`);
  }
  if (mobileOnly) {
    const t = p.getType();
    if (t !== 'MOBILE' && t !== 'FIXED_LINE_OR_MOBILE') {
      throw new BizError('座机/热线号码不可用，请填写手机号');
    }
  }
  return p.number;
}

module.exports = { BizError, wrap, errorHandler, pageOf, localDateStr, assertPhone };
