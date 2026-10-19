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

module.exports = { BizError, wrap, errorHandler, pageOf };
