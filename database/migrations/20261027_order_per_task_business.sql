-- CRM 申请 1-N 订单，每个订单一个任务一台车；计划提车日期由承运商接单提供。
-- 在已选择目标数据库后执行；不会清空或重建现有业务表。

ALTER TABLE `shipping_task`
  ADD COLUMN `transport_no` VARCHAR(64) DEFAULT NULL COMMENT '承运商接单返回的第三方承运单号' AFTER `order_no`,
  ADD COLUMN `estimated_arrive_time` DATETIME DEFAULT NULL COMMENT '承运商接单返回的预计到达时间' AFTER `plan_pickup_date`,
  ADD COLUMN `start_longitude` DECIMAL(10,6) DEFAULT NULL COMMENT '发运起点经度' AFTER `ship_location`,
  ADD COLUMN `start_latitude` DECIMAL(10,6) DEFAULT NULL COMMENT '发运起点纬度' AFTER `start_longitude`,
  ADD COLUMN `end_longitude` DECIMAL(10,6) DEFAULT NULL COMMENT '交付终点经度' AFTER `start_latitude`,
  ADD COLUMN `end_latitude` DECIMAL(10,6) DEFAULT NULL COMMENT '交付终点纬度' AFTER `end_longitude`,
  ADD KEY `idx_apply_order` (`apply_no`, `order_no`);

ALTER TABLE `esign_record`
  ADD COLUMN `receipt_time` DATETIME DEFAULT NULL COMMENT '签收回执确认时间' AFTER `sign_time`;
