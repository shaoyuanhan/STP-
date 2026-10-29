INSERT INTO sys_operation_log (
  trace_id, operation_type, business_type, business_id, operation_desc,
  operator_id, operator_name, operator_time, after_data, changed_fields,
  result_status, extra, remark
)
SELECT
  CONCAT('TASK-STATUS-', l.id),
  CASE
    WHEN l.from_status IS NULL THEN 'RECEIVE'
    WHEN l.remark LIKE '批量派单%' THEN 'BATCH_DISPATCH'
    WHEN l.to_status = 'DISPATCHED' AND l.from_status = 'WAIT_DISPATCH' THEN 'DISPATCH'
    WHEN l.to_status = 'WAIT_DISPATCH' AND l.from_status = 'DISPATCHED' THEN 'CANCEL_DISPATCH'
    WHEN l.to_status = 'CARRIER_ACCEPTED' THEN 'ACCEPT'
    WHEN l.to_status = 'WAIT_DISPATCH' AND l.from_status = 'CARRIER_ACCEPTED' THEN 'CANCEL_ACCEPT'
    WHEN l.to_status = 'PICKED' THEN 'PICKUP'
    WHEN l.to_status = 'OUTBOUND' THEN 'SYNC'
    WHEN l.to_status = 'IN_TRANSIT' THEN 'TRACKING'
    WHEN l.to_status = 'ARRIVED' THEN 'ARRIVE'
    WHEN l.to_status = 'FINISHED' THEN 'FINISH'
    WHEN l.to_status = 'CANCELLED' THEN 'CANCEL'
    ELSE 'STATUS'
  END,
  'SHIPPING_TASK',
  CAST(l.task_id AS CHAR),
  CASE
    WHEN l.from_status IS NULL THEN '发运任务接收'
    WHEN l.remark LIKE '批量派单%' THEN '发运任务批量派单'
    WHEN l.to_status = 'DISPATCHED' AND l.from_status = 'WAIT_DISPATCH' THEN '发运任务派单'
    WHEN l.to_status = 'WAIT_DISPATCH' AND l.from_status = 'DISPATCHED' THEN '发运任务取消派单'
    WHEN l.to_status = 'CARRIER_ACCEPTED' THEN '发运任务接单'
    WHEN l.to_status = 'WAIT_DISPATCH' AND l.from_status = 'CARRIER_ACCEPTED' THEN '发运任务取消接单'
    WHEN l.to_status = 'PICKED' THEN '发运任务确认提车'
    WHEN l.to_status = 'OUTBOUND' THEN '发运任务出库'
    WHEN l.to_status = 'IN_TRANSIT' THEN '发运任务开始在途'
    WHEN l.to_status = 'ARRIVED' THEN '发运任务确认到达'
    WHEN l.to_status = 'FINISHED' THEN '发运任务结单'
    WHEN l.to_status = 'CANCELLED' THEN '发运任务取消'
    ELSE '发运任务状态变更'
  END,
  l.create_id,
  COALESCE(l.operator, l.create_name, l.source),
  l.create_time,
  JSON_OBJECT('from_status', l.from_status, 'to_status', l.to_status, 'source', l.source),
  JSON_ARRAY('status'),
  'SUCCESS',
  JSON_OBJECT('business_no', l.task_no, 'backfill', 'task_status_log', 'source_id', l.id),
  l.remark
FROM task_status_log l
WHERE l.deleted = 0
  AND NOT EXISTS (
    SELECT 1 FROM sys_operation_log o
    WHERE o.trace_id = CONCAT('TASK-STATUS-', l.id)
  )
  AND NOT EXISTS (
    SELECT 1 FROM sys_operation_log o
    WHERE o.deleted = 0
      AND o.business_type = 'SHIPPING_TASK'
      AND o.business_id = CAST(l.task_id AS CHAR) COLLATE utf8mb4_0900_ai_ci
      AND o.trace_id NOT LIKE 'TASK-STATUS-%'
      AND ABS(TIMESTAMPDIFF(SECOND, o.operator_time, l.create_time)) <= 2
      AND o.result_status = 'SUCCESS'
  );

DELETE backfill FROM sys_operation_log backfill
INNER JOIN sys_operation_log actual
  ON actual.business_type = backfill.business_type
  AND actual.business_id = backfill.business_id
  AND actual.operation_type = backfill.operation_type
  AND ABS(TIMESTAMPDIFF(SECOND, actual.operator_time, backfill.operator_time)) <= 2
WHERE backfill.trace_id LIKE 'TASK-STATUS-%'
  AND actual.trace_id NOT LIKE 'TASK-STATUS-%'
  AND actual.deleted = 0;
