/**
 * 门户鉴权：JWT(HS256) 签发/校验、密码 scrypt 哈希、手机号归一化、鉴权中间件
 * 不引入第三方依赖，Node 内置 crypto 实现
 */
const crypto = require('crypto');
const { errAuth, assertPhone } = require('../helpers');

const SECRET = process.env.JWT_SECRET || 'stp-portal-local-secret';
const TOKEN_TTL = Number(process.env.JWT_EXPIRES_SECONDS) || 7 * 24 * 3600;

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

/** 签发 token，payload: { sub, type, carrierId, driverId, name } */
function signToken(payload) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + TOKEN_TTL };
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const data = `${head}.${b64url(JSON.stringify(body))}`;
  return `${data}.${sign(data)}`;
}

/** 校验 token，失败返回 null */
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = Buffer.from(sign(data));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/** 密码哈希：scrypt$salt$hash */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algo, salt, hash] = String(stored).split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** 手机号归一化：国内 11 位 -> E.164(+86) */
function normalizePhone(value) {
  return assertPhone(value, { label: '手机号', mobileOnly: true });
}

/** 鉴权中间件：types 为空表示任意登录账号 */
function requireAuth(types = []) {
  return (req, _res, next) => {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const payload = verifyToken(token);
    if (!payload) return next(errAuth('登录已失效，请重新登录'));
    if (types.length && !types.includes(payload.type)) return next(errAuth('当前账号无权访问该功能'));
    req.auth = payload;
    return next();
  };
}

module.exports = {
  signToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  normalizePhone,
  requireAuth,
};
