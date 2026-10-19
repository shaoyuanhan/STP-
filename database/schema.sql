-- =====================================================================
-- 智能运输管理平台 (STP) · 数据库表结构 (MySQL 5.7+ / 8.0 兼容)
-- 执行方式: mysql -u root -p < schema.sql
-- =====================================================================
CREATE DATABASE IF NOT EXISTS tms_vehicle DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE tms_vehicle;

SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. 承运商表
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS carriers;
CREATE TABLE carriers (
  id            BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  carrier_code  VARCHAR(20)  NOT NULL COMMENT '承运商编码 CAR-三位序列号',
  carrier_name  VARCHAR(100) NOT NULL COMMENT '承运商名称(去重校验)',
  contact_person VARCHAR(50) NOT NULL COMMENT '联系人',
  contact_phone VARCHAR(20)  NOT NULL COMMENT '联系电话',
  coop_routes   VARCHAR(200) DEFAULT NULL COMMENT '合作路线',
  status        VARCHAR(20)  NOT NULL DEFAULT 'COOPERATING' COMMENT '状态: COOPERATING合作中 DISABLED已停用',
  remark        VARCHAR(500) DEFAULT NULL COMMENT '备注',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建日期',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_carrier_code (carrier_code),
  UNIQUE KEY uk_carrier_name (carrier_name)
) ENGINE=InnoDB COMMENT='承运商';

-- ---------------------------------------------------------------------
-- 2. 司机表
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS drivers;
CREATE TABLE drivers (
  id            BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  name          VARCHAR(50)  NOT NULL COMMENT '司机姓名(不可修改)',
  phone         VARCHAR(20)  NOT NULL COMMENT '手机号',
  id_card       VARCHAR(18)  NOT NULL COMMENT '身份证号(不可修改)',
  license_no    VARCHAR(30)  DEFAULT NULL COMMENT '驾驶证号',
  vehicle_type  VARCHAR(20)  DEFAULT NULL COMMENT '准驾车型',
  license_valid_from DATE     NOT NULL COMMENT '驾驶证有效期自',
  license_valid_to   DATE    NOT NULL COMMENT '驾驶证有效期至',
  carrier_id    BIGINT       DEFAULT NULL COMMENT '所属承运商(散单司机可为空)',
  status        VARCHAR(20)  NOT NULL DEFAULT 'ENABLED' COMMENT '状态: ENABLED启用 DISABLED停用',
  remark        VARCHAR(500) DEFAULT NULL COMMENT '备注',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_driver_idcard (id_card),
  KEY idx_driver_carrier (carrier_id),
  CONSTRAINT fk_driver_carrier FOREIGN KEY (carrier_id) REFERENCES carriers (id)
) ENGINE=InnoDB COMMENT='司机';

-- ---------------------------------------------------------------------
-- 3. 发运任务表
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS ship_tasks;
CREATE TABLE ship_tasks (
  id            BIGINT       NOT NULL AUTO_INCREMENT COMMENT '主键',
  task_no       VARCHAR(20)  NOT NULL COMMENT '任务单号 FY+年月日+四位序列号',
  apply_no      VARCHAR(30)  NOT NULL COMMENT '发运申请号(CRM同步)',
  customer_name VARCHAR(100) NOT NULL COMMENT '客户名称',
  region        VARCHAR(50)  DEFAULT NULL COMMENT '大区',
  sales_name    VARCHAR(50)  DEFAULT NULL COMMENT '销售人员姓名',
  sales_phone   VARCHAR(20)  DEFAULT NULL COMMENT '销售人员联系方式',
  vin           VARCHAR(20)  NOT NULL COMMENT 'VIN',
  vehicle_model VARCHAR(50)  DEFAULT NULL COMMENT '车型',
  engine_config VARCHAR(50)  DEFAULT NULL COMMENT '发动机配置',
  cab_type      VARCHAR(50)  DEFAULT NULL COMMENT '驾驶室类型',
  order_no      VARCHAR(30)  DEFAULT NULL COMMENT '订单号',
  report_no     VARCHAR(30)  DEFAULT NULL COMMENT '报单号',
  factory       VARCHAR(100) DEFAULT NULL COMMENT '生产工厂',
  storage_location VARCHAR(100) DEFAULT NULL COMMENT '存放地点',
  origin        VARCHAR(100) NOT NULL COMMENT '发运地点',
  dest_region   VARCHAR(100) DEFAULT NULL COMMENT '交付地区',
  dest_address  VARCHAR(200) NOT NULL COMMENT '交付地址',
  receiver_phone VARCHAR(20)  DEFAULT NULL COMMENT '接车人联系电话',
  ship_mode     VARCHAR(20)  NOT NULL DEFAULT '送车' COMMENT '发运方式',
  plan_freight  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '计划运费(线路参考价,单台)',
  actual_freight DECIMAL(12,2) DEFAULT NULL COMMENT '实际运费(司机到达后回写)',
  mileage       DECIMAL(10,1) DEFAULT NULL COMMENT '运输里程(公里)',
  carrier_id    BIGINT       DEFAULT NULL COMMENT '承运商(派单后)',
  driver_id     BIGINT       DEFAULT NULL COMMENT '司机(承运商接单后返回)',
  status        VARCHAR(20)  NOT NULL DEFAULT 'PENDING' COMMENT '任务状态',
  plan_pickup_date DATE      DEFAULT NULL COMMENT '计划提车日期(接单后返回)',
  out_bound_at  DATETIME     DEFAULT NULL COMMENT '出库日期(WMS出库回传)',
  ship_at       DATETIME     DEFAULT NULL COMMENT '发运时间(司机提车)',
  arrive_at     DATETIME     DEFAULT NULL COMMENT '到达时间(司机操作到达)',
  finish_at     DATETIME     DEFAULT NULL COMMENT '完结时间(司机点击完结)',
  cancel_reason VARCHAR(200) DEFAULT NULL COMMENT '取消原因',
  remark        VARCHAR(500) DEFAULT NULL COMMENT '备注',
  created_by    VARCHAR(50)  NOT NULL DEFAULT '系统管理员' COMMENT '创建人',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建日期',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_task_no (task_no),
  KEY idx_task_apply (apply_no),
  KEY idx_task_vin (vin),
  KEY idx_task_status (status),
  KEY idx_task_carrier (carrier_id),
  KEY idx_task_driver (driver_id),
  CONSTRAINT fk_task_carrier FOREIGN KEY (carrier_id) REFERENCES carriers (id),
  CONSTRAINT fk_task_driver FOREIGN KEY (driver_id) REFERENCES drivers (id)
) ENGINE=InnoDB COMMENT='发运任务';

-- 任务状态枚举: PENDING待派单 DISPATCHED已派单 ACCEPTED承运商已接单
--              OUT_BOUND已出库 PICKED_UP已提车 IN_TRANSIT在途
--              ARRIVED已到达 FINISHED已完结 CANCELLED已取消

-- ---------------------------------------------------------------------
-- 4. 任务执行节点表(运输执行时间轴)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS task_events;
CREATE TABLE task_events (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  task_id       BIGINT       NOT NULL COMMENT '任务ID',
  node          VARCHAR(30)  NOT NULL COMMENT '节点: APPLY/DISPATCH/ACCEPT/OUT_BOUND/PICKUP/TRANSIT/ARRIVE/FINISH/CANCEL/REASSIGN',
  node_name     VARCHAR(50)  NOT NULL COMMENT '节点名称',
  detail        VARCHAR(500) DEFAULT NULL COMMENT '节点详情(承运商/司机/原因等)',
  operator      VARCHAR(50)  NOT NULL DEFAULT '系统' COMMENT '操作人',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '操作日期',
  PRIMARY KEY (id),
  KEY idx_event_task (task_id),
  CONSTRAINT fk_event_task FOREIGN KEY (task_id) REFERENCES ship_tasks (id)
) ENGINE=InnoDB COMMENT='任务执行节点';

-- ---------------------------------------------------------------------
-- 5. 在途位置记录表(狮桥每小时回传)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS tracking_records;
CREATE TABLE tracking_records (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  task_id       BIGINT       NOT NULL COMMENT '任务ID',
  transport_no  VARCHAR(20)  DEFAULT NULL COMMENT '运输单号(狮桥生成)',
  position_desc VARCHAR(100) DEFAULT NULL COMMENT '当前位置描述',
  lng           DECIMAL(10,6) DEFAULT NULL COMMENT '经度',
  lat           DECIMAL(10,6) DEFAULT NULL COMMENT '纬度',
  speed         DECIMAL(5,1) DEFAULT NULL COMMENT '当前时速 km/h',
  reported_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '上报时间',
  PRIMARY KEY (id),
  KEY idx_track_task (task_id),
  CONSTRAINT fk_track_task FOREIGN KEY (task_id) REFERENCES ship_tasks (id)
) ENGINE=InnoDB COMMENT='在途位置记录';

-- ---------------------------------------------------------------------
-- 6. 运费单表(应付运费/对账)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS freight_orders;
CREATE TABLE freight_orders (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  freight_no    VARCHAR(20)  NOT NULL COMMENT '运费单号 YF+年月日+四位序列号',
  task_id       BIGINT       NOT NULL COMMENT '关联任务',
  task_no       VARCHAR(20)  NOT NULL COMMENT '任务单号(冗余)',
  carrier_id    BIGINT       DEFAULT NULL COMMENT '承运商',
  driver_id     BIGINT       DEFAULT NULL COMMENT '司机',
  origin        VARCHAR(100) DEFAULT NULL COMMENT '起运地',
  dest          VARCHAR(100) DEFAULT NULL COMMENT '目的地',
  mileage       DECIMAL(10,1) DEFAULT NULL COMMENT '里程(公里)',
  plan_freight  DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '计划运费',
  actual_freight DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '实际运费',
  status        VARCHAR(20)  NOT NULL DEFAULT 'PENDING_RECON' COMMENT '对账状态: PENDING_RECON待对账 RECONED已对账',
  finish_at     DATETIME     DEFAULT NULL COMMENT '任务完结时间',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_freight_no (freight_no),
  KEY idx_fo_task (task_id),
  KEY idx_fo_carrier (carrier_id),
  CONSTRAINT fk_fo_task FOREIGN KEY (task_id) REFERENCES ship_tasks (id),
  CONSTRAINT fk_fo_carrier FOREIGN KEY (carrier_id) REFERENCES carriers (id),
  CONSTRAINT fk_fo_driver FOREIGN KEY (driver_id) REFERENCES drivers (id)
) ENGINE=InnoDB COMMENT='运费单';

-- ---------------------------------------------------------------------
-- 7. 运费修改记录表
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS freight_adjustments;
CREATE TABLE freight_adjustments (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  freight_order_id BIGINT     NOT NULL COMMENT '运费单ID',
  before_amount DECIMAL(12,2) NOT NULL COMMENT '修改前运费',
  after_amount  DECIMAL(12,2) NOT NULL COMMENT '修改后运费',
  reason        VARCHAR(200) DEFAULT NULL COMMENT '调整原因',
  operator      VARCHAR(50)  NOT NULL DEFAULT '系统管理员' COMMENT '操作人',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_adj_fo (freight_order_id),
  CONSTRAINT fk_adj_fo FOREIGN KEY (freight_order_id) REFERENCES freight_orders (id)
) ENGINE=InnoDB COMMENT='运费修改记录';

-- ---------------------------------------------------------------------
-- 8. 电子签台账表
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS esign_records;
CREATE TABLE esign_records (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  esign_id      VARCHAR(30)  NOT NULL COMMENT '电子签ID(狮桥同步)',
  task_id       BIGINT       DEFAULT NULL COMMENT '关联任务(VIN+发运申请单号匹配)',
  task_no       VARCHAR(20)  DEFAULT NULL COMMENT '任务单号(冗余)',
  vin           VARCHAR(20)  DEFAULT NULL COMMENT 'VIN',
  apply_no      VARCHAR(30)  DEFAULT NULL COMMENT '发运申请号',
  sign_type     VARCHAR(30)  NOT NULL DEFAULT '物流电子签' COMMENT '签署类型: 物流电子签/客户电子签',
  trigger_node  VARCHAR(50)  DEFAULT NULL COMMENT '触发节点',
  signer        VARCHAR(100) DEFAULT NULL COMMENT '签署方',
  initiated_at  DATETIME     NOT NULL COMMENT '发起时间',
  signed_at     DATETIME     DEFAULT NULL COMMENT '签署完成时间',
  status        VARCHAR(20)  NOT NULL DEFAULT 'PENDING' COMMENT '签署状态: PENDING待签署 SIGNED已签署 CANCELLED已取消',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_esign_id (esign_id),
  KEY idx_esign_task (task_id),
  CONSTRAINT fk_esign_task FOREIGN KEY (task_id) REFERENCES ship_tasks (id)
) ENGINE=InnoDB COMMENT='电子签台账';

-- ---------------------------------------------------------------------
-- 9. 单据序列号表(编码规则引擎)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS sys_sequences;
CREATE TABLE sys_sequences (
  seq_key  VARCHAR(50) NOT NULL COMMENT '序列键: CAR / FY:20261016 / YF:20261016',
  seq_val  INT         NOT NULL DEFAULT 0 COMMENT '当前值',
  updated_at DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (seq_key)
) ENGINE=InnoDB COMMENT='单据序列号';

SET FOREIGN_KEY_CHECKS = 1;
