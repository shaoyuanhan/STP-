/**
 * 演示数据时间保鲜
 *
 * 全国态势的异常判定依赖「最后一次上报距今是否超过 1 小时」，而 seed 生成的上报时间
 * 以执行时刻为基准，放置久了正常单也会逐渐变成超时。本脚本把所有在途演示运单的轨迹
 * 整体平移，让最后一条上报重新落在最近 1 小时内，并按 1/9 的比例保留超时单。
 *
 * 执行：node scripts/refresh-overview-demo.js
 */
const { pool, withTransaction } = require('../src/db');

const MARK = 'DEMO_OVERVIEW_SEED';
const TIMEOUT_MIN = 60;

/** 与 seed 脚本一致的异常比例：每 9 单留 1 单超时 */
function targetMinutesAgo(index) {
  return index % 9 === 4 ? 75 + (index % 4) * 20 : 5 + ((index * 7) % 50);
}

async function main() {
  const [tasks] = await pool.query(
    "SELECT id, task_no FROM shipping_task WHERE remark = ? AND status = 'IN_TRANSIT' ORDER BY id",
    [MARK],
  );

  await withTransaction(async (conn) => {
    let shifted = 0;
    for (let i = 0; i < tasks.length; i++) {
      const { id, task_no } = tasks[i];
      const [[last]] = await conn.query(
        'SELECT MAX(report_time) AS t, COUNT(*) AS n FROM transport_track WHERE task_id = ?',
        [id],
      );
      if (!last || !last.t) continue;

      // 目标：让最后一条上报落在 target 分钟前，平移量 = 当前实际间隔 - 目标间隔
      const ageSec = (Date.now() - new Date(String(last.t).replace(' ', 'T')).getTime()) / 1000;
      const deltaSec = ageSec - targetMinutesAgo(i) * 60;
      if (Math.abs(deltaSec) < 60) continue;

      await conn.query(
        'UPDATE transport_track SET report_time = DATE_ADD(report_time, INTERVAL ? SECOND) WHERE task_id = ?',
        [Math.round(deltaSec), id],
      );
      shifted += 1;
    }
    console.log(`[refresh] 在途演示运单 ${tasks.length} 单，平移上报时间 ${shifted} 单`);
  });

  const [[check]] = await pool.query(
    `SELECT SUM(mins <= ?) AS normal, SUM(mins > ?) AS stale FROM (
       SELECT TIMESTAMPDIFF(MINUTE, (SELECT MAX(report_time) FROM transport_track tr WHERE tr.task_id = t.id), NOW()) AS mins
       FROM shipping_task t WHERE t.remark = ? AND t.status = 'IN_TRANSIT'
     ) x`,
    [TIMEOUT_MIN, TIMEOUT_MIN, MARK],
  );
  console.log(`[refresh] 演示单状态：正常 ${check.normal} 单 / 异常 ${check.stale} 单`);
  await pool.end();
}

main().catch(async (e) => {
  console.error('[refresh] 执行失败：', e);
  await pool.end();
  process.exit(1);
});
