-- =====================================================================
-- STP 智能运输管理平台 · 数据库表结构（MySQL 5.7+ / 8.0 兼容）
-- 依据《STP 智能运输管理平台 后端技术方案》2.4 节 + 《重构统一契约 v2》第 4 节
-- 执行方式: mysql -u root -p < schema.sql
-- 说明:
--   1. 库名 tms_vehicle，共 11 张业务表 + 1 张单据序列号表 sys_sequences
--   2. 所有业务表统一审计字段: id/create_id/create_name/create_time/
--      update_id/update_name/update_time/deleted(0 未删除/1 已删除)
--   3. 契约增补: shipping_task 新增 delivery_address(交付地址) 与 version(乐观锁)
--   4. 契约第 9 节要求派单备注/CRM 备注 ≤500 字，故 shipping_task.remark、
--      dispatch_record.remark 由技术方案的 VARCHAR(255) 放宽为 VARCHAR(500)
-- =====================================================================
CREATE DATABASE IF NOT EXISTS tms_vehicle DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE tms_vehicle;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS esign_record;
DROP TABLE IF EXISTS freight_adjust_log;
DROP TABLE IF EXISTS freight_bill;
DROP TABLE IF EXISTS transport_track;
DROP TABLE IF EXISTS task_status_log;
DROP TABLE IF EXISTS dispatch_record;
DROP TABLE IF EXISTS shipping_task_vehicle;
DROP TABLE IF EXISTS shipping_task;
DROP TABLE IF EXISTS carrier_driver;
DROP TABLE IF EXISTS driver;
DROP TABLE IF EXISTS carrier;
DROP TABLE IF EXISTS sys_sequences;

-- ---------------------------------------------------------------------
-- 1. carrier 承运商表
-- ---------------------------------------------------------------------
CREATE TABLE `carrier` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `carrier_code` VARCHAR(32) NOT NULL COMMENT '承运商编码,规则CAR-三位序列号,全局递增',
  `carrier_name` VARCHAR(128) NOT NULL COMMENT '承运商名称,唯一,去重校验',
  `contact_person` VARCHAR(64) NOT NULL COMMENT '联系人',
  `contact_phone` VARCHAR(20) NOT NULL COMMENT '联系电话',
  `cooperation_routes` VARCHAR(512) DEFAULT NULL COMMENT '合作路线',
  `remark` VARCHAR(512) DEFAULT NULL COMMENT '备注',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态:1-合作中,0-已停用,停用后不可被派单,在途不受影响',
  `create_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人ID',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人姓名',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人ID',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人姓名',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除:0-未删除,1-已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_carrier_code` (`carrier_code`),
  UNIQUE KEY `uk_carrier_name` (`carrier_name`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='承运商表';

-- ---------------------------------------------------------------------
-- 2. driver 司机表
-- ---------------------------------------------------------------------
CREATE TABLE `driver` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `driver_name` VARCHAR(64) NOT NULL COMMENT '司机姓名,必填,不可修改',
  `phone` VARCHAR(20) NOT NULL COMMENT '手机号',
  `id_card` VARCHAR(18) NOT NULL COMMENT '身份证号,必填,唯一,不可修改',
  `license_no` VARCHAR(32) DEFAULT NULL COMMENT '驾驶证号',
  `license_type` VARCHAR(8) DEFAULT NULL COMMENT '准驾车型',
  `license_valid_from` DATE NOT NULL COMMENT '驾驶证有效期自',
  `license_valid_to` DATE NOT NULL COMMENT '驾驶证有效期至',
  `source` TINYINT NOT NULL DEFAULT 1 COMMENT '来源:1-自建,2-狮桥同步(按身份证号UPSERT)',
  `status` TINYINT NOT NULL DEFAULT 1 COMMENT '状态:1-启用,0-停用,停用后不可分派任务,不影响在途运单',
  `remark` VARCHAR(512) DEFAULT NULL COMMENT '备注',
  `create_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人ID',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人姓名',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人ID',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人姓名',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除:0-未删除,1-已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_id_card` (`id_card`),
  KEY `idx_phone` (`phone`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='司机表';

-- ---------------------------------------------------------------------
-- 3. carrier_driver 承运商-司机关联表（多对多，司机表不再冗余 carrier_id）
-- ---------------------------------------------------------------------
CREATE TABLE `carrier_driver` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `carrier_id` BIGINT UNSIGNED NOT NULL COMMENT '承运商ID',
  `driver_id` BIGINT UNSIGNED NOT NULL COMMENT '司机ID',
  `create_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人ID',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人姓名',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人ID',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人姓名',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除:0-未删除,1-已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_carrier_driver` (`carrier_id`,`driver_id`),
  KEY `idx_driver_id` (`driver_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='承运商-司机关联表';

-- ---------------------------------------------------------------------
-- 4. shipping_task 发运任务主表（head）
--    契约增补: delivery_address 交付地址（PRD 要求）；version 乐观锁版本号
-- ---------------------------------------------------------------------
CREATE TABLE `shipping_task` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `task_no` VARCHAR(32) NOT NULL COMMENT '任务单号,规则FY+yyyyMMdd+4位序列,唯一',
  `apply_no` VARCHAR(64) NOT NULL COMMENT 'CRM发运申请号,唯一,幂等防重',
  `customer_name` VARCHAR(128) NOT NULL COMMENT '客户名称',
  `region` VARCHAR(64) DEFAULT NULL COMMENT '大区',
  `sales_person` VARCHAR(64) DEFAULT NULL COMMENT '销售人员姓名',
  `sales_phone` VARCHAR(20) DEFAULT NULL COMMENT '销售人员联系方式',
  `delivery_area` VARCHAR(128) DEFAULT NULL COMMENT '交付地区',
  `delivery_address` VARCHAR(255) DEFAULT NULL COMMENT '交付地址,契约增补(PRD要求),CRM下发必填',
  `receiver_phone` VARCHAR(20) DEFAULT NULL COMMENT '接车人联系电话',
  `factory` VARCHAR(128) DEFAULT NULL COMMENT '生产工厂',
  `storage_location` VARCHAR(128) DEFAULT NULL COMMENT '存放地点',
  `ship_method` VARCHAR(16) NOT NULL DEFAULT '送车' COMMENT '发运方式:送车',
  `ship_location` VARCHAR(128) DEFAULT NULL COMMENT '发运地点,取自CRM发运申请',
  `plan_pickup_date` DATE DEFAULT NULL COMMENT '计划提车日期,CRM同步/承运商接单后返回',
  `outbound_date` DATETIME DEFAULT NULL COMMENT '出库日期,WMS出库回传',
  `ship_time` DATETIME DEFAULT NULL COMMENT '发运时间,司机提车发运时间',
  `arrive_time` DATETIME DEFAULT NULL COMMENT '到达时间,司机操作到达',
  `finish_time` DATETIME DEFAULT NULL COMMENT '完结时间,司机点击完结',
  `carrier_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '承运商ID,派单后回填',
  `driver_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '司机ID,承运商分配后回填',
  `plan_freight` DECIMAL(12,2) DEFAULT NULL COMMENT '计划运费,线路参考价,CRM同步不可修改,=各车计划运费之和',
  `actual_freight` DECIMAL(12,2) DEFAULT NULL COMMENT '实际运费,司机到达后回写',
  `status` VARCHAR(16) NOT NULL DEFAULT 'WAIT_DISPATCH' COMMENT '状态:WAIT_DISPATCH-待派单,DISPATCHED-已派单,CARRIER_ACCEPTED-承运商已接单,PICKED-已提车,OUTBOUND-已出库,IN_TRANSIT-在途,ARRIVED-已到达,FINISHED-已完结,CANCELLED-已取消',
  `cancel_reason` VARCHAR(255) DEFAULT NULL COMMENT '取消原因',
  `cancel_time` DATETIME DEFAULT NULL COMMENT '取消时间',
  `remark` VARCHAR(500) DEFAULT NULL COMMENT '备注,CRM同步,≤500字',
  `version` INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本号,每次更新+1,契约增补',
  `create_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人ID',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人姓名,外部系统触发记来源系统',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人ID',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人姓名,外部系统触发记来源系统',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除:0-未删除,1-已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_task_no` (`task_no`),
  UNIQUE KEY `uk_apply_no` (`apply_no`),
  KEY `idx_status_created` (`status`,`create_time`),
  KEY `idx_carrier_id` (`carrier_id`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='发运任务主表';

-- ---------------------------------------------------------------------
-- 5. shipping_task_vehicle 发运任务车辆明细表（一任务多车）
-- ---------------------------------------------------------------------
CREATE TABLE `shipping_task_vehicle` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `task_id` BIGINT UNSIGNED NOT NULL COMMENT '发运任务ID',
  `task_no` VARCHAR(32) NOT NULL COMMENT '任务单号,冗余,便于直查',
  `vin` VARCHAR(17) NOT NULL COMMENT 'VIN码',
  `order_no` VARCHAR(64) DEFAULT NULL COMMENT '订单号',
  `report_no` VARCHAR(64) DEFAULT NULL COMMENT '报单号',
  `plan_freight` DECIMAL(12,2) DEFAULT NULL COMMENT '计划运费,单台',
  `actual_freight` DECIMAL(12,2) DEFAULT NULL COMMENT '实际运费,司机到达后回写',
  `ship_location` VARCHAR(128) DEFAULT NULL COMMENT '发运地点',
  `vehicle_model` VARCHAR(64) DEFAULT NULL COMMENT '车型',
  `engine_config` VARCHAR(64) DEFAULT NULL COMMENT '发动机配置',
  `cabin_type` VARCHAR(32) DEFAULT NULL COMMENT '驾驶室类型',
  `create_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人ID',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人姓名',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人ID',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人姓名',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除:0-未删除,1-已删除',
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_task_no` (`task_no`),
  KEY `idx_vin` (`vin`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='发运任务车辆明细表';

-- ---------------------------------------------------------------------
-- 6. dispatch_record 派单/改派/取消派单记录表
-- ---------------------------------------------------------------------
CREATE TABLE `dispatch_record` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `task_id` BIGINT UNSIGNED NOT NULL COMMENT '发运任务ID',
  `task_no` VARCHAR(32) NOT NULL COMMENT '任务单号,冗余',
  `action` VARCHAR(16) NOT NULL COMMENT '动作:DISPATCH-派单,REASSIGN-改派,CANCEL_DISPATCH-取消派单',
  `carrier_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '承运商ID,本次派入/改入的承运商',
  `driver_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '司机ID,如已分配',
  `batch_no` VARCHAR(32) DEFAULT NULL COMMENT '批量派单批次号,单笔派单为空',
  `dispatch_person` VARCHAR(64) NOT NULL COMMENT '派单人',
  `dispatch_time` DATETIME NOT NULL COMMENT '操作日期',
  `cancel_reason` VARCHAR(32) DEFAULT NULL COMMENT '取消原因:承运商无法履约/调度调整/其他',
  `remark` VARCHAR(500) DEFAULT NULL COMMENT '备注,派单备注≤500字',
  `create_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人ID',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人姓名',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人ID',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人姓名',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除:0-未删除,1-已删除',
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_task_no` (`task_no`),
  KEY `idx_batch_no` (`batch_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='派单/改派/取消派单记录表';

-- ---------------------------------------------------------------------
-- 7. task_status_log 任务状态流转日志表（from_status 初始为 NULL）
-- ---------------------------------------------------------------------
CREATE TABLE `task_status_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `task_id` BIGINT UNSIGNED NOT NULL COMMENT '发运任务ID',
  `task_no` VARCHAR(32) NOT NULL COMMENT '任务单号,冗余',
  `from_status` VARCHAR(16) DEFAULT NULL COMMENT '原状态,初始为NULL',
  `to_status` VARCHAR(16) NOT NULL COMMENT '目标状态,枚举同shipping_task.status',
  `source` VARCHAR(16) NOT NULL COMMENT '来源:STP/CRM/SQ(狮桥)/WMS',
  `operator` VARCHAR(64) DEFAULT NULL COMMENT '操作人,系统触发记系统名',
  `remark` VARCHAR(255) DEFAULT NULL COMMENT '备注,如提车照片URL等',
  `create_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人ID',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人姓名,系统触发记来源系统',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  `update_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人ID',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人姓名',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除:0-未删除,1-已删除',
  PRIMARY KEY (`id`),
  KEY `idx_task_id` (`task_id`),
  KEY `idx_task_no_created` (`task_no`,`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务状态流转日志表';

-- ---------------------------------------------------------------------
-- 8. transport_track 在途轨迹表
-- ---------------------------------------------------------------------
CREATE TABLE `transport_track` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `task_id` BIGINT UNSIGNED NOT NULL COMMENT '发运任务ID',
  `task_no` VARCHAR(32) NOT NULL COMMENT '任务单号',
  `transport_no` VARCHAR(64) DEFAULT NULL COMMENT '狮桥运输单号,规则SQ+yyyyMMdd+任务id补零4位',
  `longitude` DECIMAL(10,6) NOT NULL COMMENT '经度',
  `latitude` DECIMAL(10,6) NOT NULL COMMENT '纬度',
  `location_desc` VARCHAR(255) DEFAULT NULL COMMENT '当前位置描述',
  `speed` DECIMAL(6,2) DEFAULT NULL COMMENT '当前时速km/h,狮桥无法提供则为空',
  `report_time` DATETIME NOT NULL COMMENT '上报时间,默认1小时一次,可配置',
  `create_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人ID,定时任务记JOB',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人姓名,定时任务记JOB',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人ID',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人姓名',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除:0-未删除,1-已删除',
  PRIMARY KEY (`id`),
  KEY `idx_task_no_report_time` (`task_no`,`report_time`),
  KEY `idx_report_time` (`report_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='在途轨迹表';

-- ---------------------------------------------------------------------
-- 9. freight_bill 运费结算单表（到达时生成，待对账）
-- ---------------------------------------------------------------------
CREATE TABLE `freight_bill` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `freight_no` VARCHAR(32) NOT NULL COMMENT '运费单号,规则YF+yyyyMMdd+4位序列,唯一',
  `task_id` BIGINT UNSIGNED NOT NULL COMMENT '发运任务ID',
  `task_no` VARCHAR(32) NOT NULL COMMENT '任务单号',
  `carrier_id` BIGINT UNSIGNED NOT NULL COMMENT '承运商ID',
  `driver_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '司机ID',
  `start_location` VARCHAR(128) DEFAULT NULL COMMENT '起始地',
  `end_location` VARCHAR(128) DEFAULT NULL COMMENT '讫地',
  `mileage` DECIMAL(10,2) DEFAULT NULL COMMENT '里程km',
  `plan_freight` DECIMAL(12,2) DEFAULT NULL COMMENT '计划运费',
  `actual_freight` DECIMAL(12,2) DEFAULT NULL COMMENT '实际运费,司机到达后回填',
  `finish_time` DATETIME DEFAULT NULL COMMENT '完结时间',
  `reconcile_status` TINYINT NOT NULL DEFAULT 0 COMMENT '对账状态:0-待对账,1-已对账',
  `reconcile_time` DATETIME DEFAULT NULL COMMENT '对账时间',
  `reconciler` VARCHAR(64) DEFAULT NULL COMMENT '对账人',
  `create_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人ID',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人姓名',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人ID',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人姓名',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除:0-未删除,1-已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_freight_no` (`freight_no`),
  KEY `idx_task_no` (`task_no`),
  KEY `idx_carrier_id` (`carrier_id`),
  KEY `idx_reconcile_status` (`reconcile_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运费结算单表';

-- ---------------------------------------------------------------------
-- 10. freight_adjust_log 运费调整记录表（每次修改运费一条）
-- ---------------------------------------------------------------------
CREATE TABLE `freight_adjust_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `freight_bill_id` BIGINT UNSIGNED NOT NULL COMMENT '运费结算单ID',
  `freight_no` VARCHAR(32) NOT NULL COMMENT '运费单号,冗余',
  `before_freight` DECIMAL(12,2) NOT NULL COMMENT '调整前运费',
  `after_freight` DECIMAL(12,2) NOT NULL COMMENT '调整后运费',
  `adjust_reason` VARCHAR(255) DEFAULT NULL COMMENT '调整原因',
  `operator` VARCHAR(64) NOT NULL COMMENT '操作人',
  `create_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人ID',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人姓名',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  `update_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人ID',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人姓名',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除:0-未删除,1-已删除',
  PRIMARY KEY (`id`),
  KEY `idx_freight_bill_id` (`freight_bill_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='运费调整记录表';

-- ---------------------------------------------------------------------
-- 11. esign_record 电子签台账表（按 VIN+发运申请号匹配任务）
-- ---------------------------------------------------------------------
CREATE TABLE `esign_record` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `esign_id` VARCHAR(64) NOT NULL COMMENT '电子签ID,CRM同步,唯一',
  `task_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '发运任务ID,VIN+申请单号匹配',
  `task_no` VARCHAR(32) DEFAULT NULL COMMENT '任务单号',
  `vin` VARCHAR(17) DEFAULT NULL COMMENT 'VIN码',
  `apply_no` VARCHAR(64) DEFAULT NULL COMMENT '发运申请单号',
  `sign_type` VARCHAR(32) DEFAULT NULL COMMENT '签署类型,如物流电子签',
  `trigger_node` VARCHAR(64) DEFAULT NULL COMMENT '触发节点,如CRM完成发运申请',
  `sign_party` VARCHAR(128) DEFAULT NULL COMMENT '签署方',
  `initiate_time` DATETIME DEFAULT NULL COMMENT '发起时间,取接收日期',
  `sign_status` VARCHAR(16) NOT NULL DEFAULT 'WAIT_SIGN' COMMENT '签署状态:WAIT_SIGN-待签署,SIGNED-已签署,CANCELLED-已取消',
  `sign_time` DATETIME DEFAULT NULL COMMENT '签署完成时间,狮桥回传',
  `create_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人ID',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人姓名,CRM同步记CRM系统',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人ID',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人姓名,狮桥回传记狮桥物流',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除:0-未删除,1-已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_esign_id` (`esign_id`),
  KEY `idx_task_no` (`task_no`),
  KEY `idx_sign_status` (`sign_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='电子签台账表';

-- ---------------------------------------------------------------------
-- 12. sys_sequences 单据序列号表
--     CAR   -> CAR-001            承运商编码,全局递增
--     FY    -> FY202610190001     任务单号,按日重置
--     YF    -> YF202610190001     运费单号,按日重置
--     PD    -> PD202610190001     批量派单批次号,按日重置
-- ---------------------------------------------------------------------
CREATE TABLE `sys_sequences` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `seq_key` VARCHAR(64) NOT NULL COMMENT '序列键:CAR全局;FY/YF/PD为 前缀:yyyyMMdd 按日重置',
  `seq_val` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '当前序列值',
  `create_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '创建人ID',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人姓名',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '更新人ID',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人姓名',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除:0-未删除,1-已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_seq_key` (`seq_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='单据序列号表';

SET FOREIGN_KEY_CHECKS = 1;
