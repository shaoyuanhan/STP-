/**
 * 司机接口（契约 5.3，/api/drivers，snake_case）
 *
 * 新增/编辑/停用启用统一返回完整信封 { code, message, data }：
 * 页面优先用后端 message 作为成功提示，message 为空或占位（'success'）时才用前端兜底文案。
 */

import { download, get, post, postEnvelope, request } from './http'
import type {
  ApiEnvelope,
  Driver,
  DriverImportResult,
  DriverOption,
  DriverPayload,
  DriverQuery,
  PageResult,
} from '@/types/api'

/** 司机分页列表（每条档案含唯一所属承运商 carrier_name） */
export function listDrivers(query: DriverQuery = {}): Promise<PageResult<Driver>> {
  return get<PageResult<Driver>>('/drivers', query as Record<string, unknown>)
}

/** 司机详情 */
export function getDriver(id: number | string): Promise<Driver> {
  return get<Driver>(`/drivers/${id}`)
}

/** Excel 导入（multipart/form-data，返回逐行失败原因） */
export function importDrivers(data: FormData): Promise<DriverImportResult> {
  return post<DriverImportResult>('/drivers/import', data, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
  })
}

/** 下载司机 Excel 导入模板 */
export function downloadDriverTemplate(): Promise<string> {
  return download('/drivers/import/template')
}

/** 新增司机（source=1 自建；carrier_id 指定唯一所属承运商） */
export function createDriver(payload: DriverPayload): Promise<ApiEnvelope<Driver>> {
  return postEnvelope<Driver>('/drivers', payload)
}

/** 编辑司机（姓名/身份证不可改 A0002；可调整所属承运商） */
export function updateDriver(id: number, payload: DriverPayload): Promise<ApiEnvelope<Driver>> {
  return request<ApiEnvelope<Driver>>({
    url: `/drivers/${id}`,
    method: 'PUT',
    data: payload,
    envelope: true,
  })
}

/** 启用/停用（body: {status: 1|0}；停用后不可分派、不影响在途） */
export function updateDriverStatus(id: number, status: 1 | 0): Promise<ApiEnvelope<Driver>> {
  return request<ApiEnvelope<Driver>>({
    url: `/drivers/${id}/status`,
    method: 'PUT',
    data: { status },
    envelope: true,
  })
}

/** 该承运商关联且启用的司机下拉项（狮桥接单模拟用） */
export function getDriverOptions(carrierId?: number | string): Promise<DriverOption[]> {
  const params: Record<string, unknown> = {}
  if (carrierId !== undefined && carrierId !== null && carrierId !== '') {
    params.carrier_id = carrierId
  }
  return get<DriverOption[]>('/drivers/options', params)
}

/** 导出 Excel：按当前筛选条件导出全量（不分页） */
export function exportDrivers(query: DriverQuery = {}): Promise<string> {
  const params = { ...query } as Record<string, unknown>
  delete params.page
  delete params.size
  return download('/drivers/export', params)
}
