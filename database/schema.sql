-- =====================================================================
-- STP 智能运输管理平台 · 数据库表结构（MySQL 5.7+ / 8.0 兼容）
-- 依据《STP 智能运输管理平台 后端技术方案》2.4 节 + 《重构统一契约 v2》第 4 节
-- 执行方式: mysql -u root -p < schema.sql
-- 说明:
--   1. 库名 tms_vehicle，共 11 张业务表 + 3 张支撑表 + 1 张单据序列号表 sys_sequences
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
DROP TABLE IF EXISTS driver;
DROP TABLE IF EXISTS carrier;
DROP TABLE IF EXISTS sys_file_meta;
DROP TABLE IF EXISTS sys_operation_log;
DROP TABLE IF EXISTS sys_area;
DROP TABLE IF EXISTS sys_sequences;

-- ---------------------------------------------------------------------
-- 1. carrier 承运商表
-- ---------------------------------------------------------------------
CREATE TABLE `carrier` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `carrier_code` VARCHAR(32) NOT NULL COMMENT '承运商编码,规则CAR-三位序列号,全局递增',
  `external_carrier_id` VARCHAR(64) DEFAULT NULL COMMENT '第三方承运商ID,外部系统主键,派单/回传可用其定位',
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
  UNIQUE KEY `uk_external_carrier_id` (`external_carrier_id`),
  UNIQUE KEY `uk_carrier_name` (`carrier_name`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='承运商表';

-- ---------------------------------------------------------------------
-- 2. driver 司机表
-- ---------------------------------------------------------------------
CREATE TABLE `driver` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `driver_name` VARCHAR(64) NOT NULL COMMENT '司机姓名,必填,不可修改',
  `external_driver_id` VARCHAR(64) DEFAULT NULL COMMENT '第三方司机ID,外部系统主键,接单/同步可用其定位',
  `phone` VARCHAR(20) NOT NULL COMMENT '手机号',
  `id_card` VARCHAR(18) NOT NULL COMMENT '身份证号,必填,承运商内唯一,不可修改',
  `carrier_id` BIGINT UNSIGNED NOT NULL COMMENT '所属承运商ID,司机档案按承运商隔离',
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
  UNIQUE KEY `uk_carrier_id_card` (`carrier_id`, `id_card`),
  UNIQUE KEY `uk_carrier_external` (`carrier_id`, `external_driver_id`),
  KEY `idx_carrier_id` (`carrier_id`),
  KEY `idx_phone` (`phone`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='司机表';

-- ---------------------------------------------------------------------
-- 3. shipping_task 发运任务主表（head）
--    契约增补: delivery_address 交付地址（PRD 要求）；version 乐观锁版本号
-- ---------------------------------------------------------------------
CREATE TABLE `shipping_task` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `task_no` VARCHAR(32) NOT NULL COMMENT '任务单号,规则FY+yyyyMMdd+4位序列,唯一',
  `apply_no` VARCHAR(64) NOT NULL COMMENT 'CRM发运申请号,一个申请可包含多个订单',
  `order_no` VARCHAR(64) NOT NULL COMMENT '订单号,全局唯一,每个订单一个任务一台车',
  `transport_no` VARCHAR(64) DEFAULT NULL COMMENT '承运商接单返回的第三方承运单号',
  `customer_name` VARCHAR(128) NOT NULL COMMENT '客户名称',
  `region` VARCHAR(64) DEFAULT NULL COMMENT '大区',
  `sales_person` VARCHAR(64) DEFAULT NULL COMMENT '销售人员姓名',
  `sales_phone` VARCHAR(20) DEFAULT NULL COMMENT '销售人员联系方式',
  `delivery_area` VARCHAR(128) DEFAULT NULL COMMENT '交付地区',
  `delivery_address` VARCHAR(255) DEFAULT NULL COMMENT '交付地址,契约增补(PRD要求),CRM下发必填',
  `receiver_name` VARCHAR(64) DEFAULT NULL COMMENT '接车联系人',
  `receiver_phone` VARCHAR(20) DEFAULT NULL COMMENT '接车人联系电话',
  `factory` VARCHAR(128) DEFAULT NULL COMMENT '生产工厂',
  `storage_location` VARCHAR(128) DEFAULT NULL COMMENT '存放地点',
  `ship_method` VARCHAR(16) NOT NULL DEFAULT '送车' COMMENT '发运方式:送车',
  `ship_location` VARCHAR(128) DEFAULT NULL COMMENT '发运地点,取自CRM发运申请',
  `start_longitude` DECIMAL(10,6) DEFAULT NULL COMMENT '发运起点经度',
  `start_latitude` DECIMAL(10,6) DEFAULT NULL COMMENT '发运起点纬度',
  `end_longitude` DECIMAL(10,6) DEFAULT NULL COMMENT '交付终点经度',
  `end_latitude` DECIMAL(10,6) DEFAULT NULL COMMENT '交付终点纬度',
  `plan_pickup_date` DATE DEFAULT NULL COMMENT '计划提车日期,由承运商接单提供',
  `estimated_arrive_time` DATETIME DEFAULT NULL COMMENT '承运商接单返回的预计到达时间',
  `outbound_date` DATETIME DEFAULT NULL COMMENT '出库日期,WMS出库回传',
  `ship_time` DATETIME DEFAULT NULL COMMENT '发运时间,司机提车发运时间',
  `arrive_time` DATETIME DEFAULT NULL COMMENT '到达时间,司机操作到达',
  `finish_time` DATETIME DEFAULT NULL COMMENT '完结时间,司机点击完结',
  `carrier_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '承运商ID,派单后回填',
  `driver_id` BIGINT UNSIGNED DEFAULT NULL COMMENT '司机ID,承运商分配后回填',
  `plan_freight` DECIMAL(12,2) DEFAULT NULL COMMENT '计划运费,线路参考价,CRM同步不可修改,一车一单即单车计划运费',
  `mileage` DECIMAL(10,2) DEFAULT NULL COMMENT '里程km,CRM发运申请下发,结算运费单继承',
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
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_apply_order` (`apply_no`,`order_no`),
  KEY `idx_status_created` (`status`,`create_time`),
  KEY `idx_carrier_id` (`carrier_id`),
  KEY `idx_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='发运任务主表';

-- ---------------------------------------------------------------------
-- 5. shipping_task_vehicle 发运任务车辆明细表（一车一单：每个任务仅 1 台车）
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
  `source` VARCHAR(16) NOT NULL COMMENT '来源:STP/CRM/SQ(狮桥)/CARRIER(承运商通用回传)/WMS',
  `operator` VARCHAR(64) DEFAULT NULL COMMENT '操作人,系统触发记系统名',
  `remark` VARCHAR(255) DEFAULT NULL COMMENT '备注,如提车照片URL等',
  `photos` TEXT DEFAULT NULL COMMENT '提车照片URL JSON数组',
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
  `receipt_time` DATETIME DEFAULT NULL COMMENT '签收回执确认时间',
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
-- 12. sys_file_meta 文件元数据表
-- ---------------------------------------------------------------------
CREATE TABLE `sys_file_meta` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `file_name` VARCHAR(255) NOT NULL COMMENT '原始文件名',
  `custom_path` VARCHAR(384) DEFAULT NULL COMMENT '自定义存储目录',
  `etag` VARCHAR(64) DEFAULT NULL COMMENT '文件ETag',
  `url` VARCHAR(1024) NOT NULL COMMENT '文件访问URL',
  `object_key` VARCHAR(512) NOT NULL COMMENT '文件对象键',
  `size` BIGINT UNSIGNED NOT NULL COMMENT '文件大小，字节',
  `md5` VARCHAR(32) DEFAULT NULL COMMENT '文件MD5',
  `content_type` VARCHAR(255) DEFAULT NULL COMMENT '文件MIME类型',
  `create_name` VARCHAR(64) DEFAULT NULL COMMENT '创建人',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_name` VARCHAR(64) DEFAULT NULL COMMENT '更新人',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除：0-未删除，1-已删除',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_object_key` (`object_key`),
  KEY `idx_file_create_time` (`create_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='文件元数据表';

-- ---------------------------------------------------------------------
-- 13. sys_operation_log 操作日志表
-- ---------------------------------------------------------------------
CREATE TABLE `sys_operation_log` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `trace_id` VARCHAR(64) DEFAULT NULL COMMENT '链路追踪ID',
  `operation_type` VARCHAR(64) DEFAULT NULL COMMENT '操作类型：INSERT/UPDATE/DELETE/QUERY/OTHER',
  `business_type` VARCHAR(64) DEFAULT NULL COMMENT '业务类型',
  `business_id` VARCHAR(64) DEFAULT NULL COMMENT '业务数据主键ID',
  `operation_desc` VARCHAR(1000) DEFAULT NULL COMMENT '操作描述',
  `operator_id` BIGINT DEFAULT NULL COMMENT '操作人ID',
  `operator_name` VARCHAR(128) DEFAULT NULL COMMENT '操作人姓名',
  `operator_ip` VARCHAR(64) DEFAULT NULL COMMENT '操作人IP',
  `operator_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作时间',
  `before_data` LONGTEXT DEFAULT NULL COMMENT '操作前数据快照',
  `after_data` LONGTEXT DEFAULT NULL COMMENT '操作后数据快照',
  `changed_fields` LONGTEXT DEFAULT NULL COMMENT '变更字段',
  `request_url` VARCHAR(1024) DEFAULT NULL COMMENT '请求URL',
  `request_method` VARCHAR(16) DEFAULT NULL COMMENT '请求方法',
  `request_params` LONGTEXT DEFAULT NULL COMMENT '请求参数',
  `result_status` VARCHAR(32) DEFAULT 'SUCCESS' COMMENT '操作结果：SUCCESS/FAIL',
  `error_message` TEXT DEFAULT NULL COMMENT '错误信息',
  `duration` BIGINT DEFAULT NULL COMMENT '执行耗时，毫秒',
  `extra` LONGTEXT DEFAULT NULL COMMENT '扩展数据',
  `remark` VARCHAR(512) DEFAULT NULL COMMENT '备注',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除：0-未删除，1-已删除',
  PRIMARY KEY (`id`),
  KEY `idx_operation_trace` (`trace_id`),
  KEY `idx_operation_business` (`business_type`,`business_id`),
  KEY `idx_operation_operator` (`operator_id`),
  KEY `idx_operation_time` (`operator_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='操作日志表';

-- ---------------------------------------------------------------------
-- 14. sys_area 城市地区字典表
-- ---------------------------------------------------------------------
CREATE TABLE `sys_area` (
  `id` VARCHAR(32) NOT NULL COMMENT '地区ID',
  `pid` VARCHAR(32) DEFAULT '0' COMMENT '父级地区ID',
  `type` VARCHAR(16) NOT NULL DEFAULT 'CITY' COMMENT '地区类型',
  `name` VARCHAR(64) NOT NULL COMMENT '地区名称',
  `region` VARCHAR(64) DEFAULT NULL COMMENT '所属大区',
  `longitude` DECIMAL(10,6) DEFAULT NULL COMMENT '经度',
  `latitude` DECIMAL(10,6) DEFAULT NULL COMMENT '纬度',
  `create_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `deleted` TINYINT NOT NULL DEFAULT 0 COMMENT '是否删除：0-未删除，1-已删除',
  PRIMARY KEY (`id`),
  KEY `idx_area_parent` (`pid`,`type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='城市地区字典表';

INSERT INTO `sys_area` (`id`, `pid`, `type`, `name`) VALUES
('CITY0001','0','CITY','北京'),('CITY0002','0','CITY','天津'),('CITY0003','0','CITY','上海'),('CITY0004','0','CITY','重庆'),
('CITY0005','0','CITY','合肥'),('CITY0006','0','CITY','六安'),('CITY0007','0','CITY','巢湖'),('CITY0008','0','CITY','淮南'),
('CITY0009','0','CITY','蚌埠'),('CITY0010','0','CITY','宿州'),('CITY0011','0','CITY','芜湖'),('CITY0012','0','CITY','马鞍山'),
('CITY0013','0','CITY','安庆'),('CITY0014','0','CITY','阜阳'),('CITY0015','0','CITY','滁州'),('CITY0016','0','CITY','淮北'),
('CITY0017','0','CITY','铜陵'),('CITY0018','0','CITY','宣城'),('CITY0019','0','CITY','池州'),('CITY0020','0','CITY','黄山'),
('CITY0021','0','CITY','亳州'),('CITY0022','0','CITY','南京'),('CITY0023','0','CITY','常州'),('CITY0024','0','CITY','苏州'),
('CITY0025','0','CITY','徐州'),('CITY0026','0','CITY','无锡'),('CITY0027','0','CITY','南通'),('CITY0028','0','CITY','镇江'),
('CITY0029','0','CITY','扬州'),('CITY0030','0','CITY','泰州'),('CITY0031','0','CITY','盐城'),('CITY0032','0','CITY','连云港'),
('CITY0033','0','CITY','淮安'),('CITY0034','0','CITY','宿迁'),('CITY0035','0','CITY','杭州'),('CITY0036','0','CITY','宁波'),
('CITY0037','0','CITY','温州'),('CITY0038','0','CITY','嘉兴'),('CITY0039','0','CITY','绍兴'),('CITY0040','0','CITY','金华'),
('CITY0041','0','CITY','台州'),('CITY0042','0','CITY','郑州'),('CITY0043','0','CITY','洛阳'),('CITY0044','0','CITY','开封'),
('CITY0045','0','CITY','长沙'),('CITY0046','0','CITY','株洲'),('CITY0047','0','CITY','武汉'),('CITY0048','0','CITY','宜昌'),
('CITY0049','0','CITY','襄阳'),('CITY0050','0','CITY','济南'),('CITY0051','0','CITY','青岛'),('CITY0052','0','CITY','烟台'),
('CITY0053','0','CITY','临沂'),('CITY0054','0','CITY','济宁'),('CITY0055','0','CITY','淄博'),('CITY0056','0','CITY','太原'),
('CITY0057','0','CITY','石家庄'),('CITY0058','0','CITY','唐山'),('CITY0059','0','CITY','保定'),('CITY0060','0','CITY','南昌'),
('CITY0061','0','CITY','九江'),('CITY0062','0','CITY','广州'),('CITY0063','0','CITY','深圳'),('CITY0064','0','CITY','东莞'),
('CITY0065','0','CITY','佛山'),('CITY0066','0','CITY','成都'),('CITY0067','0','CITY','西安'),('CITY0068','0','CITY','福州'),
('CITY0069','0','CITY','厦门'),('CITY0070','0','CITY','昆明'),('CITY0071','0','CITY','贵阳'),('CITY0072','0','CITY','南宁'),
('CITY0073','0','CITY','兰州'),('CITY0074','0','CITY','西宁'),('CITY0075','0','CITY','银川'),('CITY0076','0','CITY','拉萨'),
('CITY0077','0','CITY','海口'),('CITY0078','0','CITY','三亚'),('CITY0079','0','CITY','哈尔滨'),('CITY0080','0','CITY','长春'),
('CITY0081','0','CITY','沈阳'),('CITY0082','0','CITY','大连'),('CITY0083','0','CITY','呼和浩特'),('CITY0084','0','CITY','包头'),
('CITY0085','0','CITY','乌鲁木齐'),('CITY0086','0','CITY','吐鲁番'),('CITY0087','0','CITY','喀什'),('CITY0088','0','CITY','台北'),
('CITY0089','0','CITY','香港'),('CITY0090','0','CITY','澳门');

-- ---------------------------------------------------------------------
-- 15. sys_sequences 单据序列号表
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
