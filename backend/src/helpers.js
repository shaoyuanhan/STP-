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

/** 本地日期串 YYYY-MM-DD（toISOString 为 UTC，东八区 0-8 点生成的单号/日期会错一天） */
function localDateStr(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

/** 大陆手机号：1[3-9] 开头共 11 位 */
const MOBILE_RE = /^1[3-9]\d{9}$/;
/** 联系电话：手机号11位 / 座机含区号 / 座机不含区号7-8位 / 400/800 热线 */
const PHONE_RE = /^(1[3-9]\d{9}|0\d{2,3}-?\d{7,8}(-\d{1,4})?|[48]00-?\d{3,4}-?\d{3,4}|\d{7,8})$/;
/** 国际号码：+区号(1-3位) + 号码（数字/空格/连字符/括号，4-18位） */
const INTL_RE = /^\+\d{1,3}\s[0-9\-() ]{4,18}$/;

/**
 * 校验并返回清洗后的电话；不合法抛 BizError。
 * 存储约定：国内号码存裸号（如 13800138000），国外号码带区号前缀（如 +1 202-555-0123）。
 * mobileOnly=true 时仅国内要求 11 位手机号，国际号码按通用规则校验。
 */
function assertPhone(value, { label = '联系电话', mobileOnly = false, required = true } = {}) {
  const v = String(value ?? '').trim();
  if (!v) {
    if (required) throw new BizError(`${label}必填`);
    return null;
  }
  if (v.length > 24) throw new BizError(`${label}长度不能超过 24 位`);
  if (v.startsWith('+')) {
    if (!INTL_RE.test(v)) {
      throw new BizError(`${label}国际号码格式不正确，应为「+区号 号码」，如 +1 202-555-0123`);
    }
    return v;
  }
  const ok = mobileOnly ? MOBILE_RE.test(v) : PHONE_RE.test(v);
  if (!ok) {
    throw new BizError(mobileOnly
      ? `${label}格式不正确，请输入 11 位大陆手机号（1[3-9] 开头）；国外号码请加区号前缀，如 +1 202-555-0123`
      : `${label}格式不正确，国内支持 11 位手机号、座机（含区号如 0551-1234567 或 7-8 位直拨号）或 400/800 号码；国外号码请加区号前缀，如 +1 202-555-0123`);
  }
  return v;
}

module.exports = { BizError, wrap, errorHandler, pageOf, localDateStr, assertPhone, MOBILE_RE, PHONE_RE };
