-- 司机多承运商登录：短信验证码通过后的一次性选择凭证
-- 场景：同一手机号在多家承运商各有司机档案，且无法用「在途任务」唯一判定时，
--       先发 ticket，司机选择承运商后再凭 ticket 换 token。
CREATE TABLE IF NOT EXISTS `login_ticket` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `ticket` CHAR(48) NOT NULL COMMENT '一次性凭证',
  `phone` VARCHAR(25) NOT NULL COMMENT '绑定手机号',
  `expire_time` DATETIME NOT NULL COMMENT '过期时间',
  `used` TINYINT NOT NULL DEFAULT 0 COMMENT '是否已使用',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ticket` (`ticket`),
  KEY `idx_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='司机多承运商登录选择凭证';
