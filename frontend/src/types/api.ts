/**
 * STP 智能运输管理平台 · 接口类型定义
 *
 * 依据 docs/api-contract.md（统一契约 v2）：
 *  - 第 2 节：统一响应信封 { code, message, data }，code === '00000' 成功
 *  - 第 4 节：数据库实体（内部接口字段 snake_case）
 *  - 第 5 节：内部管理接口（/api，snake_case）
 *  - 第 6 节：外部接口（/api/external，camelCase）
 *  - 第 7 节：模拟辅助接口（/api/mock）
 *
 * 注意：金额为 DECIMAL(12,2)，mysql2 可能以字符串返回，
 *       展示/计算前请使用 utils/format.ts 的 money() 做 Number() 归一。
 */

// ---------------------------------------------------------------------------
// 统一响应与分页
// ---------------------------------------------------------------------------

/** 统一响应信封（契约第 2 节） */
export interface ApiEnvelope<T> {
  code: string
  message: string
  data: T
}

/** 分页请求参数（?page=1&size=10） */
export interface PageQuery {
  page?: number
  size?: number
}

/** 分页响应 data：{ list, total, page, size } */
export interface PageResult<T> {
  list: T[]
  total: number
  page?: number
  size?: number
}

// ---------------------------------------------------------------------------
// 枚举与常量
// ---------------------------------------------------------------------------

/** 任务状态（契约 3.1 状态机） */
export type TaskStatus =
  | 'WAIT_DISPATCH' // 待派单
  | 'DISPATCHED' // 已派单
  | 'CARRIER_ACCEPTED' // 承运商已接单
  | 'OUTBOUND' // 已出库
  | 'PICKED' // 已提车
  | 'IN_TRANSIT' // 在途
  | 'ARRIVED' // 已到达
  | 'FINISHED' // 已完结
  | 'CANCELLED' // 已取消

/** 任务状态全集（线性主链 + 终态） */
export const TASK_STATUSES: TaskStatus[] = [
  'WAIT_DISPATCH',
  'DISPATCHED',
  'CARRIER_ACCEPTED',
  'PICKED',
  'OUTBOUND',
  'IN_TRANSIT',
  'ARRIVED',
  'FINISHED',
  'CANCELLED',
]

/** 承运商状态（tinyint：1 合作中 / 0 已停用） */
export type CarrierStatus = 1 | 0

/** 司机状态（tinyint：1 启用 / 0 停用） */
export type DriverStatus = 1 | 0

/** 司机来源（tinyint：1 自建 / 2 狮桥同步） */
export type DriverSource = 1 | 2

/** 运费对账状态（tinyint：0 待对账 / 1 已对账） */
export type ReconcileStatus = 0 | 1

/** 电子签状态（契约 4：WAIT_SIGN/SIGNED/CANCELLED） */
export type EsignStatus = 'WAIT_SIGN' | 'SIGNED' | 'CANCELLED'

/** 任务当前允许的操作（后端按状态计算，契约 3.1） */
export type TaskAllowedAction = 'DISPATCH' | 'BATCH_DISPATCH' | 'CANCEL_DISPATCH' | 'REASSIGN'

/** 派单记录动作（dispatch_record.action） */
export type DispatchRecordAction = 'DISPATCH' | 'REASSIGN' | 'CANCEL_DISPATCH'

/** 外部状态回传动作（接口 #12：ACCEPT/PICKUP/ARRIVE/FINISH） */
export type ExternalTaskAction = 'ACCEPT' | 'PICKUP' | 'ARRIVE' | 'FINISH'

/** 状态日志来源（task_status_log.source） */
export type StatusLogSource = 'STP' | 'CRM' | 'SQ' | 'CARRIER' | 'WMS'

/** 取消派单原因（契约 3.1 / 字典 cancelReasons） */
export const CANCEL_DISPATCH_REASONS: string[] = ['承运商无法履约', '调度调整', '其他']

// ---------------------------------------------------------------------------
// 字典
// ---------------------------------------------------------------------------

export interface DictOption {
  value: string | number
  label: string
}

/** GET /api/dictionaries 响应（契约 5.1） */
export interface Dictionaries {
  taskStatus: DictOption[]
  carrierStatus: DictOption[]
  driverStatus: DictOption[]
  driverSource: DictOption[]
  reconcileStatus: DictOption[]
  esignStatus: DictOption[]
  cancelReasons: string[]
}

// ---------------------------------------------------------------------------
// 通用实体字段
// ---------------------------------------------------------------------------

/** 审计字段（所有表统一，契约 4） */
export interface AuditFields {
  id?: number
  create_id?: number | string | null
  create_name?: string | null
  create_time?: string | null
  update_id?: number | string | null
  update_name?: string | null
  update_time?: string | null
  /** 逻辑删除标记（0/1），查询已过滤 */
  deleted?: number
}

/** 金额字段（DECIMAL 可能以字符串返回） */
export type MoneyValue = number | string | null | undefined

// ---------------------------------------------------------------------------
// 承运商
// ---------------------------------------------------------------------------

/** 承运商实体 */
export interface Carrier extends AuditFields {
  id: number
  carrier_code: string
  carrier_name: string
  contact_person: string
  contact_phone: string
  cooperation_routes?: string | null
  remark?: string | null
  status: CarrierStatus
  /** 关联启用司机数（列表接口返回） */
  driver_count?: number
}

/** 新增/编辑承运商请求体（契约 5.2；编码后端生成只读） */
export interface CarrierPayload {
  carrier_name: string
  contact_person: string
  contact_phone: string
  cooperation_routes?: string | null
  remark?: string | null
}

export interface CarrierQuery extends PageQuery {
  keyword?: string
  status?: CarrierStatus | '' | null
}

// ---------------------------------------------------------------------------
// 司机
// ---------------------------------------------------------------------------

/** 司机实体 */
export interface Driver extends AuditFields {
  id: number
  name: string
  phone: string
  /** 身份证号（唯一，姓名/身份证不可改） */
  id_card: string
  license_no?: string | null
  license_type?: string | null
  license_valid_from?: string | null
  license_valid_to?: string | null
  source: DriverSource
  status: DriverStatus
  /** 所属承运商名（逗号连接字符串或数组，契约 5.3） */
  carriers?: string | string[] | null
  remark?: string | null
}

/** 新增/编辑司机请求体（契约 5.3；source=1 自建） */
export interface DriverPayload {
  name: string
  phone: string
  id_card: string
  license_no?: string | null
  license_type?: string | null
  license_valid_from?: string | null
  license_valid_to?: string | null
  /** 全量替换 carrier_driver */
  carrier_ids?: number[]
  remark?: string | null
}

export interface DriverQuery extends PageQuery {
  keyword?: string
  carrier_id?: number | '' | null
  status?: DriverStatus | '' | null
}

/** GET /api/drivers/options 返回项（狮桥接单模拟用） */
export interface DriverOption {
  id: number
  name: string
  phone: string
  license_type?: string | null
}

// ---------------------------------------------------------------------------
// 发运任务
// ---------------------------------------------------------------------------

/** 任务列表行（契约 5.4） */
export interface ShippingTaskListItem extends AuditFields {
  id: number
  task_no: string
  apply_no: string
  customer_name: string
  /** GROUP_CONCAT 顿号连接 */
  vins?: string
  vehicle_models?: string | null
  ship_location?: string | null
  delivery_address?: string | null
  carrier_name?: string | null
  driver_name?: string | null
  plan_pickup_date?: string | null
  outbound_date?: string | null
  ship_time?: string | null
  arrive_time?: string | null
  status: TaskStatus
  /** 乐观锁版本，派单/取消派单/改派必传 */
  version: number
}

/** 任务 head 实体（详情里 task 全字段） */
export interface ShippingTask extends ShippingTaskListItem {
  region?: string | null
  sales_person?: string | null
  sales_phone?: string | null
  delivery_area?: string | null
  receiver_phone?: string | null
  factory?: string | null
  storage_location?: string | null
  ship_method?: string | null
  ship_location?: string | null
  carrier_id?: number | null
  driver_id?: number | null
  driver_phone?: string | null
  plan_freight?: MoneyValue
  actual_freight?: MoneyValue
  finish_time?: string | null
  cancel_reason?: string | null
  cancel_time?: string | null
  remark?: string | null
}

/** 任务车辆明细（一任务多车；head.plan_freight = 各车之和） */
export interface ShippingTaskVehicle {
  id?: number
  task_id?: number
  task_no?: string
  vin: string
  order_no?: string | null
  report_no?: string | null
  plan_freight?: MoneyValue
  actual_freight?: MoneyValue
  ship_location?: string | null
  vehicle_model?: string | null
  engine_config?: string | null
  cabin_type?: string | null
}

/** 派单记录（dispatch_record） */
export interface DispatchRecord {
  id?: number
  task_id: number
  task_no?: string
  action: DispatchRecordAction
  carrier_id?: number | null
  driver_id?: number | null
  batch_no?: string | null
  dispatch_person?: string | null
  dispatch_time?: string | null
  cancel_reason?: string | null
  remark?: string | null
}

/** 状态日志（task_status_log；提车照片 URL 写 remark） */
export interface TaskStatusLog {
  id?: number
  task_id: number
  task_no?: string
  from_status?: TaskStatus | null
  to_status: TaskStatus
  source?: StatusLogSource
  operator?: string | null
  remark?: string | null
  create_time?: string | null
}

/** 位置回传记录（transport_track） */
export interface TransportTrack {
  id?: number
  task_id: number
  task_no?: string
  /** 狮桥运单号：SQ+yyyyMMdd+任务 id 补零 4 位 */
  transport_no?: string
  longitude: number | string
  latitude: number | string
  location_desc?: string | null
  speed?: number | string | null
  report_time?: string
}

/** 任务详情响应（契约 5.4 GET /api/shipping-tasks/:id） */
export interface ShippingTaskDetail {
  task: ShippingTask
  vehicles: ShippingTaskVehicle[]
  dispatchRecords: DispatchRecord[]
  statusLogs: TaskStatusLog[]
  tracks: TransportTrack[]
  esigns: EsignRecord[]
  allowedActions: TaskAllowedAction[]
}

export interface ShippingTaskQuery extends PageQuery {
  task_no?: string
  apply_no?: string
  vin?: string
  customer_name?: string
  status?: TaskStatus | '' | null
  carrier_id?: number | '' | null
  start_date?: string
  end_date?: string
}

/** 派单/改派请求体 */
export interface DispatchTaskPayload {
  task_id: number
  carrier_id: number
  remark?: string
  version: number
}

/** 取消派单请求体 */
export interface CancelDispatchPayload {
  task_id: number
  reason: string
  remark?: string
  version: number
}

/** 批量派单请求体 */
export interface BatchDispatchPayload {
  task_ids: number[]
  carrier_id: number
  remark?: string
}

/** 批量派单跳过项 */
export interface BatchDispatchSkipped {
  task_id: number
  task_no: string
  reason: string
}

/** 批量派单响应（契约 5.4） */
export interface BatchDispatchResult {
  dispatched: number
  total_freight: number | string
  skipped: BatchDispatchSkipped[]
}

/**
 * 单笔派单/取消派单/改派响应：契约说明"返回狮桥同步说明文案"，
 * 字段形态由后端定，此处宽松约束，页面按 message/syncNote 展示。
 */
export interface DispatchResult {
  message?: string
  syncNote?: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// 在途监控
// ---------------------------------------------------------------------------

/** 最近一条位置信息（跟踪列表行内嵌） */
export interface LatestTrack {
  transport_no?: string
  location_desc?: string | null
  longitude?: number | string
  latitude?: number | string
  speed?: number | string | null
  report_time?: string
}

/** 在途任务列表行（未终态任务，IN_TRANSIT 最优先，契约 5.5） */
export interface TrackingTask {
  id: number
  task_no: string
  apply_no?: string
  customer_name?: string
  vins?: string
  carrier_name?: string | null
  driver_name?: string | null
  driver_phone?: string | null
  ship_location?: string | null
  delivery_address?: string | null
  status: TaskStatus
  latest_track?: LatestTrack | null
}

export interface TrackingQuery extends PageQuery {
  task_no?: string
  transport_no?: string
}

/** 在途任务详情响应（契约 5.5；tracks 时间升序） */
export interface TrackingTaskDetail {
  task: TrackingTask & Partial<ShippingTask>
  statusLogs: TaskStatusLog[]
  tracks: TransportTrack[]
}

// ---------------------------------------------------------------------------
// 应付运费（结算管理）
// ---------------------------------------------------------------------------

/** 运费结算单（freight_bill，到达时生成） */
export interface FreightBill extends AuditFields {
  id: number
  freight_no: string
  task_id: number
  task_no: string
  carrier_id?: number | null
  carrier_name?: string | null
  driver_id?: number | null
  driver_name?: string | null
  start_location?: string | null
  end_location?: string | null
  mileage?: number | string | null
  plan_freight?: MoneyValue
  actual_freight?: MoneyValue
  finish_time?: string | null
  reconcile_status: ReconcileStatus
  reconcile_time?: string | null
  reconciler?: string | null
}

/** 运费调整记录（freight_adjust_log） */
export interface FreightAdjustLog {
  id?: number
  freight_bill_id?: number
  freight_no?: string
  before_freight: number | string
  after_freight: number | string
  adjust_reason: string
  operator?: string | null
  create_time?: string
}

export interface FreightBillQuery extends PageQuery {
  freight_no?: string
  task_no?: string
  carrier_id?: number | '' | null
  reconcile_status?: ReconcileStatus | '' | null
}

/** 运费列表响应（含合计金额，契约 5.6） */
export interface FreightBillListResult extends PageResult<FreightBill> {
  amount?: number | string | null
}

/** 运费明细响应（契约 5.6；无修改记录则 adjustLogs 为空数组） */
export interface FreightBillDetail {
  bill: FreightBill
  adjustLogs: FreightAdjustLog[]
}

/** 修改实际运费请求体（仅待对账可改） */
export interface FreightAdjustPayload {
  actual_freight: number | string
  reason: string
}

// ---------------------------------------------------------------------------
// 电子签
// ---------------------------------------------------------------------------

/** 电子签记录（esign_record，按 VIN+applyNo 匹配任务） */
export interface EsignRecord extends AuditFields {
  id?: number
  /** 电子签 ID（唯一） */
  esign_id: string
  task_id?: number | null
  task_no?: string | null
  vin: string
  apply_no: string
  sign_type?: string | null
  trigger_node?: string | null
  sign_party?: string | null
  initiate_time?: string | null
  sign_status: EsignStatus
  sign_time?: string | null
}

export interface EsignQuery extends PageQuery {
  esign_id?: string
  task_no?: string
  vin?: string
  apply_no?: string
  sign_status?: EsignStatus | '' | null
}

// ---------------------------------------------------------------------------
// 工作台统计
// ---------------------------------------------------------------------------

/**
 * GET /api/stats 工作台统计（契约 5.1：结构自定，前端适配）。
 * 除下列约定字段外允许附加字段（值为 unknown，页面按需断言）。
 */
export interface DashboardStats {
  /** 各状态任务数 */
  taskStatusCount?: Partial<Record<TaskStatus, number>>
  /** 今日新增任务数 */
  todayNewCount?: number
  /** 待对账笔数 */
  pendingReconcileCount?: number
  /** 待对账金额合计 */
  pendingReconcileAmount?: MoneyValue
  /** 在途任务数 */
  inTransitCount?: number
  /** 电子签待签署数 */
  waitSignEsignCount?: number
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// 外部接口（/api/external，camelCase，均幂等，契约第 6 节）
// ---------------------------------------------------------------------------

/** #1 CRM 下发车辆明细 */
export interface ReceiveVehiclePayload {
  vin: string
  orderNo?: string
  reportNo?: string
  planFreight?: number | string
  shipLocation?: string
  vehicleModel?: string
  engineConfig?: string
  cabinType?: string
}

/** #1 CRM 下发发运申请 */
export interface ReceiveTaskPayload {
  applyNo: string
  customerName: string
  vehicles: ReceiveVehiclePayload[]
  region?: string
  salesPerson?: string
  salesPhone?: string
  deliveryArea?: string
  deliveryAddress: string
  receiverPhone?: string
  factory?: string
  storageLocation?: string
  shipMethod?: string
  planPickupDate?: string
  remark?: string
}

/** #2 CRM 同步物流电子签发起 */
export interface EsignSyncPayload {
  esignId: string
  vin: string
  applyNo: string
  signType?: string
  triggerNode?: string
  signParty?: string
}

/** #3 CRM 取消前查询响应 */
export interface CancelCheckResult {
  taskNo: string
  status: TaskStatus
  cancellable: boolean
  message: string
}

/** #4 狮桥电子签回执确认响应 */
export interface EsignReceiptResult {
  esignId: string
  signStatus: EsignStatus
}

/** #6 CRM 取消请求 */
export interface ExternalCancelPayload {
  applyNo: string
  cancelReason?: string
}

/** #8 WMS 出库状态回传 */
export interface WmsOutboundPayload {
  applyNo?: string
  taskNo?: string
  outboundTime?: string
}

/** #10 狮桥司机同步 */
export interface ExternalDriverSyncPayload {
  driverName: string
  phone: string
  idCard: string
  licenseNo?: string
  licenseType?: string
  licenseValidFrom?: string
  licenseValidTo?: string
  carrierId?: number | string
}

/** #12 狮桥任务状态回传 */
export interface ExternalStatusSyncPayload {
  action: ExternalTaskAction
  applyNo?: string
  taskNo?: string
  /** ACCEPT 时回填司机 */
  driverId?: number | string
  planPickupDate?: string
  /** PICKUP 提车照片 URL 列表 */
  photos?: string[]
  /** ARRIVE 实际运费 */
  actualFreight?: number | string
  /** ARRIVE 里程 */
  mileage?: number | string
}

/** #14 狮桥电子签状态回传 */
export interface EsignSignStatusPayload {
  esignId: string
  signStatus: Exclude<EsignStatus, 'WAIT_SIGN'>
}

// ---------------------------------------------------------------------------
// 模拟辅助接口（/api/mock，契约第 7 节）
// ---------------------------------------------------------------------------

/** 模拟位置回传（写 transport_track，已提车 PICKED 首次自动置在途；已出库未提车仅记轨迹） */
export interface MockTrackPayload {
  applyNo?: string
  taskNo?: string
  locationDesc: string
  longitude: number | string
  latitude: number | string
  speed?: number | string
}

/** 模拟签署任务最新待签署电子签 */
export interface MockSignTaskPayload {
  applyNo?: string
  taskNo?: string
}
