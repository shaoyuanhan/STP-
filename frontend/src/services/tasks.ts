/**
 * 发运任务接口（契约 5.4，/api/shipping-tasks，snake_case）
 *
 * 操作类接口（派单/取消派单/改派/批量派单）统一返回完整信封
 * { code, message, data }：后端顶层 message 携带狮桥同步说明文案
 * （如「派单成功，已同步狮桥发运系统」），页面直接 message.success(env.message)，
 * 不在前端拼接提示语。
 */

import { download, get, getEnvelope, postEnvelope } from './http'
import type {
  ApiEnvelope,
  BatchDispatchPayload,
  BatchDispatchResult,
  CancelDispatchPayload,
  DispatchResult,
  DispatchTaskPayload,
  PageResult,
  ShippingTaskDetail,
  ShippingTaskListItem,
  ShippingTaskQuery,
} from '@/types/api'

/**
 * 取消前校验结果（契约第 6 节接口 #3）
 * 当前后端返回 { taskNo, status, cancellable, message }；
 * 兼容 canCancel / reason 字段命名，后端调整命名时前端无需改动。
 */
export interface CancelCheckData {
  taskNo?: string
  status?: string
  /** 是否允许取消 */
  canCancel?: boolean
  cancellable?: boolean
  /** 校验结果文案（后端返回，前端不拼接） */
  reason?: string
  message?: string
}

/** 任务分页列表（支持任务号/申请号/VIN/客户/状态/承运商/创建日期区间筛选） */
export function listShippingTasks(
  query: ShippingTaskQuery = {},
): Promise<PageResult<ShippingTaskListItem>> {
  return get<PageResult<ShippingTaskListItem>>(
    '/shipping-tasks',
    query as Record<string, unknown>,
  )
}

/** 任务详情（head 全字段 + vehicles/dispatchRecords/statusLogs/tracks/esigns/allowedActions） */
export function getShippingTask(id: number | string): Promise<ShippingTaskDetail> {
  return get<ShippingTaskDetail>(`/shipping-tasks/${id}`)
}

/** 导出 Excel：按当前筛选条件导出全量（不分页） */
export function exportShippingTasks(query: ShippingTaskQuery = {}): Promise<string> {
  const params = { ...query } as Record<string, unknown>
  delete params.page
  delete params.size
  return download('/shipping-tasks/export', params)
}

/** 派单（WAIT_DISPATCH→DISPATCHED；信封 message 为狮桥同步说明文案） */
export function dispatchTask(payload: DispatchTaskPayload): Promise<ApiEnvelope<DispatchResult>> {
  return postEnvelope<DispatchResult>('/shipping-tasks/dispatch', payload)
}

/** 取消派单（仅 DISPATCHED→WAIT_DISPATCH；信封 message 为狮桥取消同步说明） */
export function cancelDispatch(
  payload: CancelDispatchPayload,
): Promise<ApiEnvelope<DispatchResult>> {
  return postEnvelope<DispatchResult>('/shipping-tasks/dispatch/cancel', payload)
}

/** 改派（仅 DISPATCHED；换承运商，状态保持 DISPATCHED；信封 message 带狮桥同步说明） */
export function reassignDispatch(
  payload: DispatchTaskPayload,
): Promise<ApiEnvelope<DispatchResult>> {
  return postEnvelope<DispatchResult>('/shipping-tasks/dispatch/reassign', payload)
}

/**
 * 批量派单（仅 WAIT_DISPATCH）
 * data：{ dispatched, total_freight 成功单计划运费合计, skipped 逐项失败原因 }
 * 信封 message 为后端汇总文案（成功 N 单/跳过 M 单）
 */
export function batchDispatchTasks(
  payload: BatchDispatchPayload,
): Promise<ApiEnvelope<BatchDispatchResult>> {
  return postEnvelope<BatchDispatchResult>('/shipping-tasks/batch-dispatch', payload)
}

/**
 * 取消前校验（后端取消规则校验接口，camelCase；applyNo 优先，taskNo 兜底）
 *
 * 校验结论（✓/✕）与文案均以后端返回为准，前端不做本地状态判断；
 * 接口异常时由调用方按「校验接口不可用」处理并禁用提交。
 */
export function cancelCheck(params: { applyNo?: string; taskNo?: string }): Promise<ApiEnvelope<CancelCheckData>> {
  const applyNo = params.applyNo?.trim() || ''
  const taskNo = params.taskNo?.trim() || ''
  const query: Record<string, unknown> = {}
  if (applyNo) query.applyNo = applyNo
  else if (taskNo) query.taskNo = taskNo
  return getEnvelope<CancelCheckData>('/external/shipping-tasks/cancel-check', query)
}
