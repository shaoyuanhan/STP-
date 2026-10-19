/**
 * 应用入口
 * 智能运输管理平台 (Smart Transport Management Platform, STP) · 后端 API
 */
require('./db'); // 先加载 .env 配置
const express = require('express');
const cors = require('cors');

const { errorHandler, wrap } = require('./helpers');
const { query } = require('./db');
const statsRoutes = require('./routes/stats');
const carrierRoutes = require('./routes/carriers');
const driverRoutes = require('./routes/drivers');
const shipTaskRoutes = require('./routes/shipTasks');
const trackingRoutes = require('./routes/tracking');
const freightRoutes = require('./routes/freight');
const esignRoutes = require('./routes/esigns');
const mockRoutes = require('./routes/mock');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// 前后端分离：允许跨域访问（开发期前端可双击 file:// 直接打开）
app.use(cors());
app.use(express.json());

// 健康检查（真实探测数据库，MySQL 未启动时返回 500）
app.get('/api/health', wrap(async (req, res) => {
  await query('SELECT 1 AS ok');
  res.json({ ok: true, service: 'stp-backend', db: 'up', time: new Date().toISOString() });
}));

// 业务路由
app.use('/api/stats', statsRoutes);
app.use('/api/carriers', carrierRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/ship-tasks', shipTaskRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/freight-orders', freightRoutes);
app.use('/api/esigns', esignRoutes);
app.use('/api/mock', mockRoutes);

// 404
app.use((req, res) => res.status(404).json({ message: '接口不存在' }));

// 统一错误处理
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[STP] 智能运输管理平台后端已启动: http://localhost:${PORT}`);
  console.log(`[STP] 数据库: ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'tms_vehicle'}`);
});
