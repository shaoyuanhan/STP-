-- =====================================================================
-- 司机档案按承运商隔离
-- 执行: mysql -u root -p tms_vehicle < database/migrations/20261023_driver_per_carrier.sql
-- 前置: 已备份（db-backup/tms_vehicle_before_driver_split_*.sql）
--
-- 变更要点:
--   1. driver 增加 carrier_id，司机档案归属唯一承运商
--   2. 原多对多关联中的数据拆分：一个司机挂 N 家承运商 → N 份独立档案
--   3. 历史任务 driver_id 重指到对应承运商的档案
--   4. 唯一约束从「全局身份证唯一」收敛为「承运商内身份证唯一」
--   5. 司机账号唯一键加入承运商维度，同手机号可在不同承运商各自建档
--   6. carrier_driver 关联表退役
-- =====================================================================
USE tms_vehicle;

-- ---------------------------------------------------------------------
-- 1. 司机表增加所属承运商
-- ---------------------------------------------------------------------
ALTER TABLE `driver`
  ADD COLUMN `carrier_id` BIGINT UNSIGNED NULL COMMENT '所属承运商ID，司机档案按承运商隔离' AFTER `id_card`;

-- ---------------------------------------------------------------------
-- 2. 主档案归位：每个司机先落到关联的第一家承运商（按 carrier_id 升序）
-- ---------------------------------------------------------------------
UPDATE `driver` d
JOIN (
  SELECT driver_id, MIN(carrier_id) AS carrier_id
  FROM `carrier_driver`
  WHERE deleted = 0
  GROUP BY driver_id
) t ON t.driver_id = d.id
SET d.carrier_id = t.carrier_id;

-- ---------------------------------------------------------------------
-- 3. 唯一约束先切到承运商维度（必须在复制档案之前，否则旧的全库身份证唯一键会拦下副本）
-- ---------------------------------------------------------------------
ALTER TABLE `driver`
  ADD UNIQUE KEY `uk_carrier_id_card` (`carrier_id`, `id_card`),
  ADD UNIQUE KEY `uk_carrier_external` (`carrier_id`, `external_driver_id`),
  ADD KEY `idx_carrier_id` (`carrier_id`);

ALTER TABLE `driver`
  DROP INDEX `uk_id_card`,
  DROP INDEX `uk_external_driver_id`;

-- ---------------------------------------------------------------------
-- 4. 一家一份档案：其余承运商各复制一条，第三方司机ID 只保留在主档案
-- ---------------------------------------------------------------------
INSERT INTO `driver`
  (driver_name, external_driver_id, phone, id_card, carrier_id, license_no, license_type,
   license_valid_from, license_valid_to, source, status, remark,
   create_id, create_name, create_time, update_id, update_name, deleted)
SELECT d.driver_name, NULL, d.phone, d.id_card, cd.carrier_id, d.license_no, d.license_type,
       d.license_valid_from, d.license_valid_to, d.source, d.status, d.remark,
       d.create_id, d.create_name, d.create_time, d.update_id, d.update_name, d.deleted
FROM `driver` d
JOIN `carrier_driver` cd ON cd.driver_id = d.id AND cd.deleted = 0
WHERE cd.carrier_id <> d.carrier_id
  AND d.deleted = 0;

-- ---------------------------------------------------------------------
-- 5. 历史任务重指：按任务的承运商指向该承运商下的档案
-- ---------------------------------------------------------------------
UPDATE `shipping_task` t
JOIN `driver` od ON od.id = t.driver_id
JOIN `driver` nd ON nd.id_card = od.id_card AND nd.carrier_id = t.carrier_id AND nd.deleted = 0
SET t.driver_id = nd.id
WHERE od.carrier_id <> t.carrier_id;

-- 拆分完成后 carrier_id 必填
ALTER TABLE `driver`
  MODIFY COLUMN `carrier_id` BIGINT UNSIGNED NOT NULL COMMENT '所属承运商ID，司机档案按承运商隔离';

-- ---------------------------------------------------------------------
-- 6. 司机账号补承运商维度，同手机号可在不同承运商并存
-- ---------------------------------------------------------------------
UPDATE `sys_account` a
JOIN `driver` d ON d.id = a.driver_id
SET a.carrier_id = d.carrier_id
WHERE a.account_type = 'DRIVER'
  AND a.carrier_id IS NULL;

ALTER TABLE `sys_account`
  ADD COLUMN `carrier_scope` BIGINT UNSIGNED
    AS (IFNULL(`carrier_id`, 0)) STORED COMMENT '承运商维度，用于并存账号的唯一约束';

ALTER TABLE `sys_account` DROP INDEX `uk_type_phone`;
ALTER TABLE `sys_account`
  ADD UNIQUE KEY `uk_type_phone_carrier` (`account_type`, `phone`, `carrier_scope`);

-- ---------------------------------------------------------------------
-- 7. 关联表退役（数据已迁入 driver.carrier_id）
-- ---------------------------------------------------------------------
DROP TABLE `carrier_driver`;
