/**
 * 通知服务：站内信 + 短信 + 微信订阅消息
 * 本地环境默认 mock：内容落 notification 表并打印到后端日志，不真实外发
 * 真实通道通过 SMS_PROVIDER / WX_PROVIDER 切换，未配置时降级为 SKIPPED 并留痕
 */
const { query } = require('../db');

const SMS_PROVIDER = () => process.env.SMS_PROVIDER || 'mock';
const WX_PROVIDER = () => process.env.WX_PROVIDER || 'mock';

async function insertNotification(row) {
  await query(
    `INSERT INTO notification
      (receiver_type, receiver_id, channel, title, content, biz_type, biz_id, send_status, provider_msg, read_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      row.receiverType, row.receiverId, row.channel, row.title, row.content,
      row.bizType ?? null, row.bizId ?? null, row.status, row.providerMsg ?? null,
    ]
  );
}

/**
 * 发送通知
 * @param {object} p receiverType(CARRIER/DRIVER) receiverId phone driverId title content bizType bizId channels
 */
async function notify({
  receiverType, receiverId, phone = null, driverId = null,
  title, content, bizType = null, bizId = null, channels = ['INBOX'],
}) {
  for (const channel of channels) {
    if (channel === 'INBOX') {
      await insertNotification({ receiverType, receiverId, channel, title, content, bizType, bizId, status: 'SENT' });
      continue;
    }
    if (channel === 'SMS') {
      if (SMS_PROVIDER() !== 'mock') {
        // 真实短信通道（阿里云/腾讯云）接入位：配置 SDK 后在此调用
        console.log(`[SMS] 未接入真实通道，降级跳过 -> ${phone || receiverId}: ${title}`);
        await insertNotification({
          receiverType, receiverId, channel, title, content, bizType, bizId,
          status: 'SKIPPED', providerMsg: '未配置真实短信通道',
        });
        continue;
      }
      console.log(`[SMS-MOCK] ${phone || receiverId} | ${title} | ${content}`);
      await insertNotification({
        receiverType, receiverId, channel, title, content, bizType, bizId,
        status: 'MOCK', providerMsg: '本地模拟短信，未真实发送',
      });
      continue;
    }
    if (channel === 'WECHAT') {
      let openid = null;
      if (driverId) {
        const rows = await query(
          'SELECT openid FROM driver_wx_binding WHERE driver_id = ? AND deleted = 0',
          [Number(driverId)]
        );
        openid = rows[0]?.openid ?? null;
      }
      if (!openid) {
        await insertNotification({
          receiverType, receiverId, channel, title, content, bizType, bizId,
          status: 'SKIPPED', providerMsg: '司机未绑定微信，无法发送订阅消息',
        });
        continue;
      }
      if (WX_PROVIDER() !== 'mock') {
        console.log(`[WECHAT] 未接入真实订阅消息通道，降级跳过 -> ${openid}: ${title}`);
        await insertNotification({
          receiverType, receiverId, channel, title, content, bizType, bizId,
          status: 'SKIPPED', providerMsg: '未配置微信订阅消息通道',
        });
        continue;
      }
      console.log(`[WECHAT-MOCK] ${openid} | ${title} | ${content}`);
      await insertNotification({
        receiverType, receiverId, channel, title, content, bizType, bizId,
        status: 'MOCK', providerMsg: '本地模拟订阅消息，未真实发送',
      });
    }
  }
}

/** 发送登录验证码（本地直接打印，接口会回传 dev_code 便于联调） */
async function sendLoginCode(phone, code) {
  console.log(`[SMS-MOCK] 登录验证码 -> ${phone}: ${code}（5 分钟内有效）`);
  await insertNotification({
    receiverType: 'DRIVER', receiverId: 0, channel: 'SMS',
    title: '登录验证码', content: `您的登录验证码为 ${code}，5 分钟内有效。`,
    bizType: 'LOGIN_CODE', status: 'MOCK', providerMsg: '本地模拟短信，未真实发送',
  });
}

module.exports = { notify, sendLoginCode };
