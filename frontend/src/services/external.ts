/**
 * 外部系统接口（契约第 6 节）
 *  - /api/external/*（camelCase，均幂等，统一定位 applyNo 优先、taskNo 兼容）
 */

import { get, post } from './http'
import type {
  CancelCheckResult,
  EsignReceiptResult,
  EsignSignStatusPayload,
  EsignSyncPayload,
  ExternalCancelPayload,
  ExternalDriverSyncPayload,
  ExternalStatusSyncPayload,
  ReceiveTaskPayload,
  WmsOutboundPayload,
} from '@/types/api'

// ---------------------------------------------------------------------------
// 外部接口（契约第 6 节）
// ---------------------------------------------------------------------------

/** #1 CRM 下发发运申请（applyNo 重复 → C0001；响应 {taskNo} 自动生成） */
export function receiveShippingTask(
  payload: ReceiveTaskPayload,
): Promise<{ taskNo: string }> {
  return post<{ taskNo: string }>('/external/shipping-tasks/receive', payload)
}

/** #2 CRM 同步物流电子签发起（按 VIN+applyNo 匹配任务） */
export function syncEsign(payload: EsignSyncPayload): Promise<Record<string, never>> {
  return post<Record<string, never>>('/external/esign/sync', payload)
}

/** #3 CRM 取消前查询（响应 {taskNo, status, cancellable, message}） */
export function checkCancel(
  params: { applyNo?: string; taskNo?: string },
): Promise<CancelCheckResult> {
  return get<CancelCheckResult>('/external/shipping-tasks/cancel-check', {
    applyNo: params.applyNo,
    taskNo: params.taskNo,
  })
}

/** #4 狮桥电子签回执确认（幂等；响应 {esignId, signStatus}） */
export function receiptSyncEsign(payload: { esignId: string }): Promise<EsignReceiptResult> {
  return post<EsignReceiptResult>('/external/esign/receipt-sync', payload)
}

/** #6 CRM 同步取消（按取消规则校验；关联待签署电子签置 CANCELLED） */
export function cancelShippingTask(payload: ExternalCancelPayload): Promise<{
  taskNo?: string
  status?: string
  [key: string]: unknown
}> {
  return post('/external/shipping-tasks/cancel', payload)
}

/** #8 WMS 出库状态回传（PICKED→OUTBOUND→IN_TRANSIT；司机先办提车，仓库后出库，出库完成即进在途） */
export function syncWmsOutboundStatus(
  payload: WmsOutboundPayload,
): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/external/wms/outbound-status', payload)
}

/** #10 狮桥司机同步（身份证号 UPSERT，source=2 + 维护 carrier_driver） */
export function syncExternalDriver(
  payload: ExternalDriverSyncPayload,
): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/external/drivers/sync', payload)
}

/** #12 狮桥任务状态回传（ACCEPT/PICKUP/ARRIVE/FINISH；ARRIVE 生成运费单 YF 单号） */
export function syncTaskStatus(
  payload: ExternalStatusSyncPayload,
): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/external/shipping-tasks/status-sync', payload)
}

/** #14 狮桥电子签状态回传（WAIT_SIGN→SIGNED(回填 sign_time)/CANCELLED） */
export function updateEsignSignStatus(
  payload: EsignSignStatusPayload,
): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/external/esign/sign-status', payload)
}
