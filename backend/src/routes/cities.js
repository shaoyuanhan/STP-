/** 城市/区域数据：读取未删除的 sys_area 记录。 */
const { Router } = require('express');
const { query } = require('../db');
const { ok, wrap } = require('../helpers');

const router = Router();

router.get(['/', '/allCities'], wrap(async (_req, res) => {
  const list = await query(
    `SELECT id, pid, type, name, region, longitude, latitude
     FROM sys_area
     WHERE deleted = 0
     ORDER BY pid, id`
  );
  ok(res, list);
}));

module.exports = router;
