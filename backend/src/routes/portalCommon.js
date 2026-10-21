/**
 * 门户公共能力：图片上传、演示工具、环境信息
 * 前缀 /api/portal
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Router } = require('express');
const { query } = require('../db');
const { wrap, ok, errParam, errBiz, errNotFound } = require('../helpers');
const { requireAuth } = require('../services/security');
const { devWmsOutbound, PICKUP_PHOTO_MIN } = require('../services/taskFlow');

const router = Router();

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'public', 'uploads');

/** 公开环境信息（登录页使用） */
router.get('/meta', wrap(async (_req, res) => {
  ok(res, {
    sms_provider: process.env.SMS_PROVIDER || 'mock',
    wx_provider: process.env.WX_PROVIDER || 'mock',
    pickup_photo_min: PICKUP_PHOTO_MIN,
    dev_tools: (process.env.PORTAL_DEV_TOOLS || '1') === '1',
  });
}));

/** 图片上传：base64 data URL -> /static/uploads/YYYYMMDD/xxx.jpg */
router.post('/files/upload', requireAuth(), wrap(async (req, res) => {
  const raw = String(req.body.data_url ?? '');
  const m = /^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(raw);
  if (!m) throw errParam('仅支持 PNG/JPG/WEBP 图片');
  const buffer = Buffer.from(m[3].replace(/\s/g, ''), 'base64');
  if (buffer.length > 8 * 1024 * 1024) throw errParam('单张图片不能超过 8MB');

  const ext = m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dir = path.join(UPLOAD_ROOT, day);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), buffer);

  const url = `/static/uploads/${day}/${filename}`;
  ok(res, { url, size: buffer.length });
}));

/** 演示工具：模拟 WMS 出库（仅本地/测试环境开启） */
router.post('/dev/tasks/:id/wms-outbound', requireAuth(['DRIVER', 'CARRIER']), wrap(async (req, res) => {
  if ((process.env.PORTAL_DEV_TOOLS || '1') !== '1') throw errBiz('演示工具未开启');
  const id = Number(req.params.id);
  const [task] = await query('SELECT * FROM shipping_task WHERE id = ? AND deleted = 0', [id]);
  if (!task) throw errNotFound('任务不存在');
  if (req.auth.type === 'DRIVER' && Number(task.driver_id) !== Number(req.auth.driverId)) {
    throw errBiz('该任务未指派给您');
  }
  if (req.auth.type === 'CARRIER' && Number(task.carrier_id) !== Number(req.auth.carrierId)) {
    throw errBiz('该任务不属于当前承运商');
  }
  const result = await devWmsOutbound({ taskId: id });
  ok(res, result, '已模拟 WMS 出库，任务进入在途');
}));

module.exports = router;
