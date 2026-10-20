/**
 * 电子签台账接口（契约 5.7，/api/esign-records，snake_case）
 */

import { get } from './http'
import type { EsignQuery, EsignRecord, PageResult, TaskStatus } from '@/types/api'

/** 台账联查行：后端列表额外联查 shipping_task 的任务状态与客户名称 */
export interface EsignRow extends EsignRecord {
  /** 关联任务当前状态（任务可能已删除，此时为空） */
  task_status?: TaskStatus | null
  /** 客户名称（联查 shipping_task.customer_name） */
  customer_name?: string | null
}

/** 电子签台账分页列表（签 ID/任务号/VIN/申请号/签署状态筛选，行含任务状态/客户名称联查字段） */
export function listEsignRecords(query: EsignQuery = {}): Promise<PageResult<EsignRow>> {
  return get<PageResult<EsignRow>>('/esign-records', query as Record<string, unknown>)
}
