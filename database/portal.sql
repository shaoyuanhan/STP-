-- =====================================================================
-- 承运商端 / 司机端 增量表结构
-- 执行: mysql -u root -p tms_vehicle < database/portal.sql
-- 说明: 账号、附件、消息、短信验证码、小程序绑定；不改动既有业务表
-- =====================================================================
USE tms_vehicle;

CREATE TABLE IF NOT EXISTS `sys_account` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `account_type` VARCHAR(24) NOT NULL COMMENT '账号类型:ADMIN-平台管理员,CARRIER_ADMIN-承运商管理员,CARRIER_DISPATCHER-承运商调度,DRIVER-司机',
  `username` VARCHAR(64) DEFAULT NULL COMMENT '登录账号,可与手机号二选一',
  `phone` VARCHAR(25) NOT NULL COMMENT '登录手机号,E.164（如 +8613800000001）',
  `password_hash` VARCHAR(255) DEFAULT NULL COMMENT '密码哈希,scrypt;司机短信登录可为空',
  `display_name` VARCHAR(64) NOT NULL COMMENT '显示名称',
  `carrier_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '承运商账号所属承运商',
  `driver_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '司机账号对应司机',
  `role` VARCHAR(32) NOT NULL DEFAULT 'CARRIER_ADMIN' COMMENT '角色标识',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态:1-启用,0-停用',
  `last_login_time` DATETIME DEFAULT NULL COMMENT '最近登录时间',
  `create_id` BIGINT UNSIGNED DEFAULT NULL,
  `create_name` VARCHAR(64) DEFAULT NULL,
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `update_id` BIGINT UNSIGNED DEFAULT NULL,
  `update_name` VARCHAR(64) DEFAULT NULL,
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted` TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_type_phone` (`account_type`,`phone`),
  UNIQUE KEY `uk_username` (`username`),
  KEY `idx_carrier_id` (`carrier_id`),
  KEY `idx_driver_id` (`driver_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='门户账号表(承运商员工/司机)';

CREATE TABLE IF NOT EXISTS `task_file` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `task_id` BIGINT UNSIGNED NOT NULL COMMENT '发运任务ID',
  `task_no` VARCHAR(32) NOT NULL COMMENT '任务单号,冗余',
  `biz_type` VARCHAR(16) NOT NULL COMMENT '业务类型:PICKUP-提车,ARRIVE-到达,FINISH-结单,EXCEPTION-异常',
  `file_url` VARCHAR(512) NOT NULL COMMENT '文件URL',
  `file_type` VARCHAR(16) NOT NULL DEFAULT 'IMAGE' COMMENT '文件类型',
  `uploader_type` VARCHAR(16) NOT NULL COMMENT '上传方:CARRIER/DRIVER',
  `uploader_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '上传方账号ID',
  `uploader_name` VARCHAR(64) DEFAULT NULL COMMENT '上传方名称',
  `longitude` DECIMAL(10,6) DEFAULT NULL COMMENT '经度',
  `latitude` DECIMAL(10,6) DEFAULT NULL COMMENT '纬度',
  `address` VARCHAR(255) DEFAULT NULL COMMENT '地址描述',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted` TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_task_biz` (`task_id`,`biz_type`),
  KEY `idx_task_no` (`task_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务业务附件表(照片等)';

CREATE TABLE IF NOT EXISTS `notification` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `receiver_type` VARCHAR(16) NOT NULL COMMENT '接收方:CARRIER/DRIVER',
  `receiver_id` BIGINT UNSIGNED NOT NULL COMMENT '接收方ID(承运商ID/司机ID)',
  `channel` VARCHAR(16) NOT NULL COMMENT '渠道:INBOX/SMS/WECHAT',
  `title` VARCHAR(128) NOT NULL COMMENT '标题',
  `content` VARCHAR(512) NOT NULL COMMENT '内容',
  `biz_type` VARCHAR(24) DEFAULT NULL COMMENT '业务类型:ASSIGN/PICKUP/ARRIVE/FINISH/LOGIN_CODE',
  `biz_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '业务ID(任务ID等)',
  `send_status` VARCHAR(16) NOT NULL DEFAULT 'SENT' COMMENT '发送状态:SENT/MOCK/SKIPPED/FAILED',
  `provider_msg` VARCHAR(255) DEFAULT NULL COMMENT '通道返回信息',
  `read_status` TINYINT NOT NULL DEFAULT 0 COMMENT '读取状态:0-未读,1-已读',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted` TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_receiver` (`receiver_type`,`receiver_id`,`read_status`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='消息通知表(站内信/短信/微信)';

CREATE TABLE IF NOT EXISTS `sms_code` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `phone` VARCHAR(25) NOT NULL COMMENT '手机号',
  `code` VARCHAR(8) NOT NULL COMMENT '验证码',
  `scene` VARCHAR(24) NOT NULL DEFAULT 'LOGIN' COMMENT '场景',
  `expire_time` DATETIME NOT NULL COMMENT '过期时间',
  `used` TINYINT NOT NULL DEFAULT 0 COMMENT '是否已使用',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_phone_scene` (`phone`,`scene`,`used`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='短信验证码表';

CREATE TABLE IF NOT EXISTS `driver_wx_binding` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `driver_id` BIGINT UNSIGNED NOT NULL,
  `openid` VARCHAR(64) NOT NULL COMMENT '微信 openid',
  `unionid` VARCHAR(64) DEFAULT NULL,
  `bind_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted` TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_driver` (`driver_id`),
  UNIQUE KEY `uk_openid` (`openid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='司机微信绑定表(小程序预留)';
