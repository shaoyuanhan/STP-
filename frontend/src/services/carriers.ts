/**
 * 承运商接口（契约 5.2，/api/carriers，snake_case）
 *
 * 新增/编辑/停用启用统一返回完整信封 { code, message, data }：
 * 页面优先用后端 message 作为成功提示，message 为空或占位（'success'）时才用前端兜底文案。
 */

import { get, postEnvelope, request } from './http'
import type { ApiEnvelope, Carrier, CarrierPayload, CarrierQuery, PageResult } from '@/types/api'

/** 承运商分页列表（list 含 driver_count 关联启用司机数） */
export function listCarriers(query: CarrierQuery = {}): Promise<PageResult<Carrier>> {
  return get<PageResult<Carrier>>('/carriers', query as Record<string, unknown>)
}

/** 新增承运商（编码 CAR-XXX 自动生成；名称去重 A0002） */
export function createCarrier(payload: CarrierPayload): Promise<ApiEnvelope<Carrier>> {
  return postEnvelope<Carrier>('/carriers', payload)
}

/**
 * 编辑承运商（编码只读；名称改名校验去重）
 * 契约：联系人、电话、合作路线、备注可改，名称去重校验
 */
export function updateCarrier(id: number, payload: CarrierPayload): Promise<ApiEnvelope<Carrier>> {
  return request<ApiEnvelope<Carrier>>({
    url: `/carriers/${id}`,
    method: 'PUT',
    data: payload,
    envelope: true,
  })
}

/** 启用/停用（body: {status: 1|0}；停用后不可被派单、在途不受影响） */
export function updateCarrierStatus(id: number, status: 1 | 0): Promise<ApiEnvelope<Carrier>> {
  return request<ApiEnvelope<Carrier>>({
    url: `/carriers/${id}/status`,
    method: 'PUT',
    data: { status },
    envelope: true,
  })
}
