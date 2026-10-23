-- 司机账号统一口径
-- 1. 旧版狮桥同步写入的 role=DRIVER001 统一为 DRIVER
-- 2. 有司机档案但没有登录账号的，按档案补建（不设密码，走手机号验证码登录）

UPDATE sys_account SET role = 'DRIVER' WHERE account_type = 'DRIVER' AND role <> 'DRIVER' AND deleted = 0;

INSERT INTO sys_account
  (account_type, phone, password_hash, display_name, carrier_id, driver_id, role, status, create_name, update_name)
SELECT 'DRIVER', d.phone, NULL, d.driver_name, d.carrier_id, d.id, 'DRIVER', d.status, '系统初始化', '系统初始化'
FROM driver d
WHERE d.deleted = 0
  AND NOT EXISTS (
    SELECT 1 FROM sys_account a
    WHERE a.account_type = 'DRIVER' AND a.driver_id = d.id AND a.deleted = 0
  )
  AND NOT EXISTS (
    SELECT 1 FROM sys_account a2
    WHERE a2.account_type = 'DRIVER' AND a2.phone = d.phone
      AND a2.carrier_scope = d.carrier_id AND a2.deleted = 0
  );
