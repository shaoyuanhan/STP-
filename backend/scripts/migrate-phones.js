/**
 * 存量电话数据迁移：统一为 E.164 格式（如 +8613812345678）
 * 规则：空值跳过；已带 + 前缀跳过；国内裸号补 +86；无法解析的保留原值并报告
 * 用法：node scripts/migrate-phones.js
 */
const { query, pool } = require('../src/db');
const { parsePhoneNumberFromString } = require('libphonenumber-js/max');

const TASKS = [
  { table: 'carriers', col: 'contact_phone', pk: 'id', label: '承运商联系电话' },
  { table: 'drivers', col: 'phone', pk: 'id', label: '司机手机号' },
  { table: 'ship_tasks', col: 'sales_phone', pk: 'id', label: '销售电话' },
  { table: 'ship_tasks', col: 'receiver_phone', pk: 'id', label: '接车人电话' },
];

(async () => {
  let migrated = 0, skipped = 0, failed = [];
  for (const t of TASKS) {
    const rows = await query(`SELECT ${t.pk} AS id, ${t.col} AS val FROM ${t.table} WHERE ${t.col} IS NOT NULL AND ${t.col} != ''`);
    for (const r of rows) {
      const v = String(r.val).trim();
      if (v.startsWith('+')) { skipped++; continue; }
      const p = parsePhoneNumberFromString(v, 'CN');
      if (p && p.isValid()) {
        await query(`UPDATE ${t.table} SET ${t.col} = ? WHERE ${t.pk} = ?`, [p.number, r.id]);
        migrated++;
      } else {
        failed.push(`${t.table}.${t.col} [id=${r.id}] "${v}" 无法解析为有效中国号码，保留原值`);
      }
    }
  }
  console.log(`迁移完成：${migrated} 条已转 E.164，${skipped} 条已带前缀跳过，${failed.length} 条失败`);
  failed.forEach((f) => console.log('  - ' + f));
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
