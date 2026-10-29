import { get, postEnvelope, request } from './http'
import type {
  ApiEnvelope,
  PageResult,
  PickupPoint,
  PickupPointFactoryOption,
  PickupPointPayload,
  PickupPointQuery,
  RegionOption,
} from '@/types/api'

export function listPickupPoints(query: PickupPointQuery = {}): Promise<PageResult<PickupPoint>> {
  return get<PageResult<PickupPoint>>('/pickup-points', query as Record<string, unknown>)
}

export function listPickupPointRegions(): Promise<RegionOption[]> {
  return get<RegionOption[]>('/pickup-points/regions')
}

export function listPickupPointFactories(): Promise<PickupPointFactoryOption[]> {
  return get<PickupPointFactoryOption[]>('/pickup-points/factory-options')
}

export function createPickupPoint(payload: PickupPointPayload): Promise<ApiEnvelope<PickupPoint>> {
  return postEnvelope<PickupPoint>('/pickup-points', payload)
}

export function updatePickupPoint(
  id: number,
  payload: PickupPointPayload,
): Promise<ApiEnvelope<PickupPoint>> {
  return request<ApiEnvelope<PickupPoint>>({
    url: `/pickup-points/${id}`,
    method: 'PUT',
    data: payload,
    envelope: true,
  })
}

export function updatePickupPointStatus(id: number, enabled: 1 | 0): Promise<ApiEnvelope<PickupPoint>> {
  return request<ApiEnvelope<PickupPoint>>({
    url: `/pickup-points/${id}/status`,
    method: 'PUT',
    data: { enabled },
    envelope: true,
  })
}
