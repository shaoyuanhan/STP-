/**
 * 通用接口（契约 5.1）
 *  - GET /api/health
 *  - GET /api/stats
 *  - GET /api/dictionaries（由 services/dict.ts 提供语义化封装）
 */

import { get } from './http'
import type { DashboardStats, TaskStatus } from '@/types/api'
import { TASK_STATUSES } from '@/types/api'

export interface HealthResult {
  ok: boolean
}

/** 健康检查 */
export function checkHealth(): Promise<HealthResult> {
  return get<HealthResult>('/health')
}

/** 工作台统计（契约 5.1：结构自定，前端适配） */
export function getStats(): Promise<DashboardStats> {
  return get<DashboardStats>('/stats')
}

// ---------------------------------------------------------------------------
// 归一化（契约 5.1 说明"结构自定，前端适配"，此处对齐后端实现口径）
// ---------------------------------------------------------------------------

/** 工作台统计归一化结果（页面只面向本结构，后端字段微调时仅需改这里） */
export interface NormalizedStats {
  /** 各状态任务数（全集状态，缺省 0） */
  taskStatusCount: Partial<Record<TaskStatus, number>>
  /** 任务总数 */
  taskTotal: number
  /** 今日新增任务数 */
  todayNewCount: number
  /** 在途任务数 */
  inTransitCount: number
  /** 待对账笔数 */
  pendingReconcileCount: number
  /** 待对账金额合计 */
  pendingReconcileAmount: number
  /** 电子签待签署数 */
  waitSignEsignCount: number
  /** 合作中承运商数 */
  cooperatingCarriers: number
  /** 启用司机数 */
  enabledDrivers: number
}

/** 从宽松结构里取第一个有限数字 */
function pickNumber(source: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = source[key]
    const num = Number(value)
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(num)) return num
  }
  return 0
}

/** 后端实际结构：{ task: { WAIT_DISPATCH…, total }, todayNew, inTransit, freightPending: {count, amount}, esignWaitSign, … } */
function normalizeStats(raw: DashboardStats): NormalizedStats {
  const source = raw as unknown as Record<string, unknown>
  const statusMap = (source.task ?? source.taskStatusCount ?? {}) as Record<string, unknown>
  const pending = (source.freightPending ?? {}) as Record<string, unknown>

  const taskStatusCount: Partial<Record<TaskStatus, number>> = {}
  const declaredTotal = pickNumber(source, ['total', 'taskTotal'])
  let summed = 0
  for (const status of TASK_STATUSES) {
    const count = Number(statusMap[status])
    const value = Number.isFinite(count) ? count : 0
    taskStatusCount[status] = value
    summed += value
  }
  const taskTotal = declaredTotal > 0 ? declaredTotal : summed

  return {
    taskStatusCount,
    taskTotal,
    todayNewCount: pickNumber(source, ['todayNew', 'todayNewCount']),
    inTransitCount: pickNumber(source, ['inTransit', 'inTransitCount']),
    pendingReconcileCount: pickNumber(pending, ['count']) || pickNumber(source, ['pendingReconcileCount']),
    pendingReconcileAmount: pickNumber(pending, ['amount']) || pickNumber(source, ['pendingReconcileAmount']),
    waitSignEsignCount: pickNumber(source, ['esignWaitSign', 'waitSignEsignCount']),
    cooperatingCarriers: pickNumber(source, ['cooperatingCarriers']),
    enabledDrivers: pickNumber(source, ['enabledDrivers']),
  }
}

/** 工作台统计（归一化后），工作台页面请使用本函数 */
export async function getDashboardStats(): Promise<NormalizedStats> {
  return normalizeStats(await getStats())
}
