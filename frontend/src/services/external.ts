/**
 * 外部系统接口与模拟辅助接口
 *  - 契约第 6 节：/api/external/*（camelCase，均幂等，统一定位 applyNo 优先、taskNo 兼容）
 *  - 契约第 7 节：/api/mock/*（演示面板专用）
 *
 * 「外部系统模拟」页面（views/simulator）通过本文件触发
 * CRM / WMS / 狮桥 / 司机端的完整业务链路演示。
 */

import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'
import { get, post, postEnvelope } from './http'
import type {
  ApiEnvelope,
  CancelCheckResult,
  EsignReceiptResult,
  EsignSignStatusPayload,
  EsignSyncPayload,
  ExternalCancelPayload,
  ExternalDriverSyncPayload,
  ExternalStatusSyncPayload,
  MockSignTaskPayload,
  MockTrackPayload,
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

/** #8 WMS 出库状态回传（PICKED→OUTBOUND；CARRIER_ACCEPTED 乱序兜底置 IN_TRANSIT） */
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

// ---------------------------------------------------------------------------
// 模拟辅助接口（契约第 7 节）
// ---------------------------------------------------------------------------

/** 模拟位置回传结果（写 transport_track；PICKED/OUTBOUND 首次自动置在途） */
export interface MockTrackResult {
  /** 狮桥运输单号：SQ+yyyyMMdd+任务 id 补零 4 位 */
  transportNo?: string
  /** 回传后任务状态 */
  status?: string
  /** 是否首次回传（首次自动置为在途） */
  firstReport?: boolean
}

/**
 * 模拟位置回传（写 transport_track；PICKED/OUTBOUND 首次自动置在途）。
 * 返回完整信封：成功提示文案以后端 message 为准
 * （"位置回传成功，任务已置为在途" / "位置回传成功"）。
 */
export function mockTrack(payload: MockTrackPayload): Promise<ApiEnvelope<MockTrackResult>> {
  return postEnvelope<MockTrackResult>('/mock/track', payload)
}

/** 模拟签署结果（签署该任务最新一条待签署电子签） */
export interface MockSignResult {
  esignId?: string
  vin?: string
  signStatus?: string
}

/**
 * 模拟签署任务最新待签署电子签（演示辅助）。
 * 返回完整信封：成功提示文案以后端 message 为准（"电子签 xxx 签署完成"）。
 */
export function mockSignTask(
  payload: MockSignTaskPayload,
): Promise<ApiEnvelope<MockSignResult>> {
  return postEnvelope<MockSignResult>('/mock/esign/sign-task', payload)
}

// ---------------------------------------------------------------------------
// 原始信封调用（外部系统模拟页展示用）
// ---------------------------------------------------------------------------

/**
 * 独立 axios 实例：不做信封拆包、不抛业务错误。
 *
 * http.ts 的统一拦截会把成功响应拆成 data、失败抛 ApiError，
 * 而「外部系统模拟」页需要把外部接口的**完整响应报文**
 * （含 code / message / data，成功 00000 绿色、失败红色）原样呈现给演示观众，
 * 故此处单独走一个只读实例，失败（含 400/404/409 等业务错误码）也返回信封对象。
 */
const rawHttp = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

export interface RawExternalCall {
  method: 'GET' | 'POST'
  /** 路径（相对 /api，如 external/shipping-tasks/receive） */
  path: string
  /** POST 请求体 */
  payload?: unknown
  /** GET 查询参数 */
  params?: Record<string, unknown>
}

/** 调用外部/模拟接口并返回完整响应信封（永不 reject；网络异常返回 NETWORK 信封） */
export async function callExternalRaw(call: RawExternalCall): Promise<ApiEnvelope<unknown>> {
  const config: AxiosRequestConfig = {
    method: call.method,
    url: call.path,
    data: call.payload,
    params: call.params,
  }
  try {
    const response = await rawHttp.request(config)
    const body = response.data as Partial<ApiEnvelope<unknown>> | undefined
    if (body && typeof body === 'object' && 'code' in body) {
      return { code: String(body.code), message: String(body.message ?? ''), data: body.data ?? null }
    }
    // 兼容非信封响应（理论上不会出现）
    return { code: '00000', message: 'success', data: (body ?? null) as unknown }
  } catch (error) {
    const axiosError = error as { response?: { status?: number; data?: Partial<ApiEnvelope<unknown>> }; message?: string }
    const body = axiosError.response?.data
    if (body && typeof body === 'object' && 'code' in body) {
      return { code: String(body.code), message: String(body.message ?? ''), data: body.data ?? null }
    }
    const status = axiosError.response?.status ?? 0
    return {
      code: status > 0 ? `HTTP_${status}` : 'NETWORK',
      message: axiosError.message || (status > 0 ? `请求失败（HTTP ${status}）` : '网络异常，请确认后端服务已启动'),
      data: null,
    }
  }
}
