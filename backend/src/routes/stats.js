/**
 * 工作台统计
 */
const { Router } = require('express');
const { query } = require('../db');
const { wrap } = require('../helpers');

const router = Router();

router.get('/', wrap(async (req, res) => {
  const [statusRows, carrierRow, driverRow, freightRow, monthRow] = await Promise.all([
    query('SELECT status, COUNT(*) AS n FROM ship_tasks GROUP BY status'),
    query("SELECT COUNT(*) AS n FROM carriers WHERE status = 'COOPERATING'"),
    query("SELECT COUNT(*) AS n FROM drivers WHERE status = 'ENABLED'"),
    query("SELECT COUNT(*) AS n, COALESCE(SUM(actual_freight), 0) AS amount FROM freight_orders WHERE status = 'PENDING_RECON'"),
    query("SELECT COUNT(*) AS n, COALESCE(SUM(actual_freight), 0) AS amount FROM freight_orders WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')"),
  ]);

  const byStatus = {};
  statusRows.forEach((r) => { byStatus[r.status] = r.n; });

  res.json({
    task: {
      pending: byStatus.PENDING || 0,
      dispatched: byStatus.DISPATCHED || 0,
      accepted: byStatus.ACCEPTED || 0,
      outBound: byStatus.OUT_BOUND || 0,
      pickedUp: byStatus.PICKED_UP || 0,
      inTransit: byStatus.IN_TRANSIT || 0,
      arrived: byStatus.ARRIVED || 0,
      finished: byStatus.FINISHED || 0,
      cancelled: byStatus.CANCELLED || 0,
      total: statusRows.reduce((s, r) => s + r.n, 0),
    },
    carriers: carrierRow[0].n,
    drivers: driverRow[0].n,
    freightPending: { count: freightRow[0].n, amount: Number(freightRow[0].amount) },
    freightMonth: { count: monthRow[0].n, amount: Number(monthRow[0].amount) },
  });
}));

module.exports = router;
