-- 一申请多订单：每个订单一个任务一台车。
-- 在已选择目标数据库后执行；可重复执行，不会清空或重建现有业务表。
-- V2 存量库可能仍是 uk_apply_no 且 shipping_task 没有 order_no，本脚本先补齐再加接单字段。

DROP PROCEDURE IF EXISTS stp_migrate_20261027_order_per_task;

DELIMITER $$
CREATE PROCEDURE stp_migrate_20261027_order_per_task()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shipping_task' AND COLUMN_NAME = 'order_no'
  ) THEN
    ALTER TABLE `shipping_task`
      ADD COLUMN `order_no` VARCHAR(64) NULL COMMENT '订单号,全局唯一,每个订单一个任务一台车' AFTER `apply_no`;
  END IF;

  UPDATE `shipping_task` t
  JOIN (
    SELECT task_id, SUBSTRING_INDEX(GROUP_CONCAT(order_no ORDER BY id SEPARATOR ','), ',', 1) AS order_no
    FROM `shipping_task_vehicle`
    WHERE deleted = 0 AND order_no IS NOT NULL AND order_no <> ''
    GROUP BY task_id
  ) v ON v.task_id = t.id
  SET t.order_no = v.order_no
  WHERE t.order_no IS NULL OR t.order_no = '';

  UPDATE `shipping_task`
  SET order_no = CONCAT('LEGACY-', id)
  WHERE order_no IS NULL OR order_no = '';

  WHILE EXISTS (
    SELECT 1 FROM (
      SELECT order_no FROM `shipping_task` WHERE deleted = 0 GROUP BY order_no HAVING COUNT(*) > 1
    ) d
  ) DO
    UPDATE `shipping_task` t
    INNER JOIN `shipping_task` t2
      ON t.order_no = t2.order_no AND t.id > t2.id AND t.deleted = 0 AND t2.deleted = 0
    SET t.order_no = CONCAT(LEFT(t.order_no, 48), '-', t.id);
  END WHILE;

  ALTER TABLE `shipping_task`
    MODIFY COLUMN `order_no` VARCHAR(64) NOT NULL COMMENT '订单号,全局唯一,每个订单一个任务一台车';

  IF EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shipping_task' AND INDEX_NAME = 'uk_apply_no'
  ) THEN
    ALTER TABLE `shipping_task` DROP INDEX `uk_apply_no`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shipping_task' AND INDEX_NAME = 'uk_order_no'
  ) THEN
    ALTER TABLE `shipping_task` ADD UNIQUE KEY `uk_order_no` (`order_no`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shipping_task' AND INDEX_NAME = 'idx_apply_order'
  ) THEN
    ALTER TABLE `shipping_task` ADD KEY `idx_apply_order` (`apply_no`, `order_no`);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shipping_task' AND COLUMN_NAME = 'transport_no'
  ) THEN
    ALTER TABLE `shipping_task`
      ADD COLUMN `transport_no` VARCHAR(64) DEFAULT NULL COMMENT '承运商接单返回的第三方承运单号' AFTER `order_no`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shipping_task' AND COLUMN_NAME = 'start_longitude'
  ) THEN
    ALTER TABLE `shipping_task`
      ADD COLUMN `start_longitude` DECIMAL(10,6) DEFAULT NULL COMMENT '发运起点经度' AFTER `ship_location`,
      ADD COLUMN `start_latitude` DECIMAL(10,6) DEFAULT NULL COMMENT '发运起点纬度' AFTER `start_longitude`,
      ADD COLUMN `end_longitude` DECIMAL(10,6) DEFAULT NULL COMMENT '交付终点经度' AFTER `start_latitude`,
      ADD COLUMN `end_latitude` DECIMAL(10,6) DEFAULT NULL COMMENT '交付终点纬度' AFTER `end_longitude`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'shipping_task' AND COLUMN_NAME = 'estimated_arrive_time'
  ) THEN
    ALTER TABLE `shipping_task`
      ADD COLUMN `estimated_arrive_time` DATETIME DEFAULT NULL COMMENT '承运商接单返回的预计到达时间' AFTER `plan_pickup_date`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'task_status_log' AND COLUMN_NAME = 'photos'
  ) THEN
    ALTER TABLE `task_status_log`
      ADD COLUMN `photos` TEXT DEFAULT NULL COMMENT '提车照片URL JSON数组' AFTER `remark`;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'esign_record' AND COLUMN_NAME = 'receipt_time'
  ) THEN
    ALTER TABLE `esign_record`
      ADD COLUMN `receipt_time` DATETIME DEFAULT NULL COMMENT '签收回执确认时间' AFTER `sign_time`;
  END IF;
END$$
DELIMITER ;

CALL stp_migrate_20261027_order_per_task();
DROP PROCEDURE IF EXISTS stp_migrate_20261027_order_per_task;
