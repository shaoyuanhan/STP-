/**
 * 应用入口
 * STP 智能运输管理平台 (Smart Transport Management Platform, STP) · 后端 API
 * Node.js + Express + MySQL(库名 tms_vehicle)，端口 3000
 */
require('./db'); // 先加载 .env 配置
const path = require('path');
const express = require('express');
const cors = require('cors');

const { errorHandler, wrap, ok } = require('./helpers');
const { query } = require('./db');
const statsRoutes = require('./routes/stats');
const carrierRoutes = require('./routes/carriers');
const driverRoutes = require('./routes/drivers');
const shippingTaskRoutes = require('./routes/shippingTasks');
const trackingRoutes = require('./routes/tracking');
const freightBillRoutes = require('./routes/freightBills');
const esignRoutes = require('./routes/esigns');
const externalRoutes = require('./routes/external');
const portalAuthRoutes = require('./routes/portalAuth');
const accountRoutes = require('./routes/accounts');
const roleRoutes = require('./routes/roles');
const { ensureAccess } = require('./services/access');
const portalCarrierRoutes = require('./routes/portalCarrier');
const portalDriverRoutes = require('./routes/portalDriver');
const portalCommonRoutes = require('./routes/portalCommon');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// 前后端分离：允许跨域访问（开发期前端可双击 file:// 直接打开）
app.use(cors());
// 门户图片以 base64 上传，放宽请求体上限（单张 ≤8MB）
app.use(express.json({ limit: '25mb' }));

// 提车照片等静态资源（演示环境；生产由 OSS 承载）
app.use('/static', express.static(path.join(__dirname, '../public')));

// 健康检查（真实探测数据库，MySQL 未启动时返回 500）
app.get('/api/health', wrap(async (req, res) => {
  await query('SELECT 1 AS ok');
  ok(res, { ok: true, service: 'stp-backend', db: 'up', time: new Date().toISOString() });
}));

// 数据字典（契约 5.1：任务状态/承运商状态/司机状态/司机来源/对账状态/电子签状态/取消派单原因）
app.get('/api/dictionaries', wrap(async (req, res) => {
  ok(res, {
    taskStatus: [
      { value: 'WAIT_DISPATCH', label: '待派单' },
      { value: 'DISPATCHED', label: '已派单' },
      { value: 'CARRIER_ACCEPTED', label: '承运商已接单' },
      { value: 'PICKED', label: '已提车' },
      { value: 'OUTBOUND', label: '已出库' },
      { value: 'IN_TRANSIT', label: '在途' },
      { value: 'ARRIVED', label: '已到达' },
      { value: 'FINISHED', label: '已完结' },
      { value: 'CANCELLED', label: '已取消' },
    ],
    carrierStatus: [
      { value: 1, label: '合作中' },
      { value: 0, label: '已停用' },
    ],
    driverStatus: [
      { value: 1, label: '启用' },
      { value: 0, label: '停用' },
    ],
    driverSource: [
      { value: 1, label: '自建' },
      { value: 2, label: '狮桥同步' },
    ],
    reconcileStatus: [
      { value: 0, label: '待对账' },
      { value: 1, label: '已对账' },
    ],
    esignStatus: [
      { value: 'WAIT_SIGN', label: '待签署' },
      { value: 'SIGNED', label: '已签署' },
      { value: 'CANCELLED', label: '已取消' },
    ],
    cancelReasons: ['承运商无法履约', '调度调整', '其他'],
  });
}));

// 业务路由（契约第 5/6/7 节）
app.use('/api/stats', statsRoutes);
app.use('/api/carriers', carrierRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/shipping-tasks', shippingTaskRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/freight-bills', freightBillRoutes);
app.use('/api/esign-records', esignRoutes);
app.use('/api/external', externalRoutes);

// 承运商端/司机端（JWT 登录态，数据按 token 内的 carrier_id / driver_id 隔离）
app.use('/api/portal/auth', portalAuthRoutes);
app.use('/api/portal/accounts', accountRoutes);
app.use('/api/portal/roles', roleRoutes);
app.use('/api/portal/carrier', portalCarrierRoutes);
app.use('/api/portal/driver', portalDriverRoutes);
app.use('/api/portal', portalCommonRoutes);

// 404：未匹配到任何接口
app.use((req, res) => res.status(404).json({ code: 'D0002', message: '接口不存在', data: null }));

// 统一错误处理（{code, message, data} 信封 + 错误码 HTTP 映射）
app.use(errorHandler);

ensureAccess()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[STP] 智能运输管理平台后端已启动: http://localhost:${PORT}`);
      console.log(`[STP] 数据库: ${process.env.DB_HOST || '127.0.0.1'}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'tms_vehicle'}`);
    });
  })
  .catch((error) => {
    console.error('[STP] 角色权限初始化失败', error);
    process.exit(1);
  });
