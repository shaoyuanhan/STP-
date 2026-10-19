/**
 * 数据库连接与单据序列号引擎
 * 智能运输管理平台 (STP)
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { localDateStr } = require('./helpers');

// ---- 轻量 .env 加载（无需额外依赖）----
try {
  const envFile = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  envFile.split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  });
} catch (e) { /* 无 .env 时使用默认值 */ }

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'tms_vehicle',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true, // 日期以字符串返回，避免时区偏移
});

/** 执行查询（带参数） */
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/** 事务包装：fn(conn) 内的多次写操作要么全部提交，要么全部回滚 */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* 连接已断开 */ }
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * 单据序列号（编码规则引擎）
 * CAR -> CAR-001         承运商编码：CAR-三位序列号（全局递增）
 * FY  -> FY202610160001  任务单号：FY+年月日+四位序列号（按日重置）
 * YF  -> YF202610160001  运费单号：YF+年月日+四位序列号（按日重置）
 *
 * 原子性：UPDATE ... SET seq_val = LAST_INSERT_ID(seq_val + 1) 后，
 * 同一连接内 SELECT LAST_INSERT_ID() 可取到自增后的值（MySQL 官方机制）。
 */
async function nextSeq(kind, conn) {
  const today = localDateStr().replace(/-/g, '');
  const key = kind === 'CAR' ? 'CAR' : `${kind}:${today}`;
  const width = kind === 'CAR' ? 3 : 4;
  const code = (v) => (kind === 'CAR' ? `CAR-${String(v).padStart(3, '0')}` : `${kind}${today}${String(v).padStart(width, '0')}`);

  const c = conn || (await pool.getConnection());
  const mustRelease = !conn;
  try {
    const [upd] = await c.query(
      'UPDATE sys_sequences SET seq_val = LAST_INSERT_ID(seq_val + 1) WHERE seq_key = ?',
      [key]
    );
    if (upd.affectedRows > 0) {
      const [rows] = await c.query('SELECT LAST_INSERT_ID() AS v');
      return code(rows[0].v);
    }
    // 首次使用该键：插入初始值 1（幂等保护防并发重复插入报错）
    const [ins] = await c.query(
      'INSERT INTO sys_sequences (seq_key, seq_val) VALUES (?, 1) ON DUPLICATE KEY UPDATE seq_val = seq_val',
      [key]
    );
    if (ins.insertId > 0 || ins.affectedRows === 1) return code(1);
    // 并发下已被他人插入：重试一次 UPDATE
    const [upd2] = await c.query(
      'UPDATE sys_sequences SET seq_val = LAST_INSERT_ID(seq_val + 1) WHERE seq_key = ?',
      [key]
    );
    if (upd2.affectedRows > 0) {
      const [rows] = await c.query('SELECT LAST_INSERT_ID() AS v');
      return code(rows[0].v);
    }
    throw new Error('序列号生成失败');
  } finally {
    if (mustRelease) c.release();
  }
}

module.exports = { pool, query, withTransaction, nextSeq };
