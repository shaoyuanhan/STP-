/**
 * 应付运费接口（契约 5.6，/api/freight-bills，snake_case）
 */

import { get, put, postEnvelope } from './http'
import type {
  ApiEnvelope,
  FreightAdjustPayload,
  FreightBill,
  FreightBillDetail,
  FreightBillListResult,
  FreightBillQuery,
  PageResult,
  TaskStatus,
} from '@/types/api'

/**
 * 运费单列表行（联查视图）：
 * 后端 GET /api/freight-bills 在 freight_bill 基础上联查
 * carrier（carrier_name/carrier_code）、driver（driver_name）、
 * shipping_task（customer_name/apply_no/task_status），
 * types/api.ts 的 FreightBill 未覆盖这些联查字段，此处补充子类型供结算页使用。
 */
export interface FreightBillRow extends FreightBill {
  customer_name?: string | null
  apply_no?: string | null
  carrier_code?: string | null
  task_status?: TaskStatus | null
}

/** 列表响应（在契约 5.6 合计 amount 之外附带计划运费合计 plan_amount） */
export interface FreightBillRowListResult extends PageResult<FreightBillRow> {
  /** 实际运费合计（当前筛选口径） */
  amount?: number | string | null
  /** 计划运费合计（当前筛选口径） */
  plan_amount?: number | string | null
}

/** 运费单分页列表（联查行 + 合计金额），结算管理页用 */
export function listFreightBillRows(
  query: FreightBillQuery = {},
): Promise<FreightBillRowListResult> {
  return get<FreightBillRowListResult>('/freight-bills', query as Record<string, unknown>)
}

/** 运费单分页列表（含合计金额 amount） */
export function listFreightBills(
  query: FreightBillQuery = {},
): Promise<FreightBillListResult> {
  return get<FreightBillListResult>('/freight-bills', query as Record<string, unknown>)
}

/** 运费明细（bill + adjustLogs，无修改则空数组） */
export function getFreightBillDetail(id: number | string): Promise<FreightBillDetail> {
  return get<FreightBillDetail>(`/freight-bills/${id}/detail`)
}

/**
 * 修改实际运费（仅待对账可改；已对账 A0002；每次修改写调整记录留痕）。
 * 返回完整信封：成功提示文案以后端 message 为准（"运费修改成功，已记录调整日志"）。
 */
export function adjustFreightBill(
  id: number | string,
  payload: FreightAdjustPayload,
): Promise<ApiEnvelope<FreightBill>> {
  return put<ApiEnvelope<FreightBill>>(`/freight-bills/${id}/freight`, payload, { envelope: true })
}

/**
 * 确认对账（0→1，reconciler=系统管理员；幂等）。
 * 返回完整信封：成功提示文案以后端 message 为准（"确认对账成功"）。
 */
export function reconcileFreightBill(id: number | string): Promise<ApiEnvelope<FreightBill>> {
  return postEnvelope<FreightBill>(`/freight-bills/${id}/reconcile`)
}

/**
 * 本月运费总额（工作台卡片口径）：
 * /api/stats 未提供该统计项（契约 5.1 结构自定），此处按运费台账
 * 拉取列表（演示数据量 ≤ 分页上限 100）并对「本月生成」的运费单
 * 聚合实际运费合计。
 */
export async function sumMonthActualFreight(): Promise<number> {
  const result = await listFreightBills({ page: 1, size: 100 })
  const now = new Date()
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  let sum = 0
  for (const bill of result?.list ?? []) {
    const created = String(bill.create_time ?? '')
    if (created.slice(0, 7) === monthPrefix) {
      sum += Number(bill.actual_freight) || 0
    }
  }
  return Number(sum.toFixed(2))
}
