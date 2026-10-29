import type { AxiosRequestConfig } from 'axios'
import { download, get, post, postEnvelope, request } from './http'
import type {
  ApiEnvelope,
  Factory,
  FactoryImportResult,
  FactoryPayload,
  FactoryQuery,
  PageResult,
} from '@/types/api'

export function listFactories(query: FactoryQuery = {}): Promise<PageResult<Factory>> {
  return get<PageResult<Factory>>('/factories', query as Record<string, unknown>)
}

export function getFactory(id: number | string): Promise<Factory> {
  return get<Factory>(`/factories/${id}`)
}

export function createFactory(payload: FactoryPayload): Promise<ApiEnvelope<Factory>> {
  return postEnvelope<Factory>('/factories', payload)
}

export function updateFactory(id: number, payload: FactoryPayload): Promise<ApiEnvelope<Factory>> {
  return request<ApiEnvelope<Factory>>({
    url: `/factories/${id}`,
    method: 'PUT',
    data: payload,
    envelope: true,
  })
}

export function exportFactories(query: FactoryQuery = {}): Promise<string> {
  const params = { ...query } as Record<string, unknown>
  delete params.page
  delete params.size
  return download('/factories/export', params)
}

export function downloadFactoryTemplate(): Promise<string> {
  return download('/factories/import/template')
}

export function importFactories(data: FormData): Promise<FactoryImportResult> {
  const config: AxiosRequestConfig = { timeout: 60000 }
  return post<FactoryImportResult>('/factories/import', data, config)
}
