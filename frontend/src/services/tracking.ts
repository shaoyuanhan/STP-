/**
 * 在途监控接口（契约 5.5，/api/tracking，snake_case）
 */

import { get } from './http'
import type { PageResult, TrackingQuery, TrackingTask, TrackingTaskDetail } from '@/types/api'

/**
 * 未终态任务列表（不含 FINISHED/CANCELLED；IN_TRANSIT 最优先）
 * 行内 latest_track 为最近一条位置回传
 */
export function listTrackingTasks(query: TrackingQuery = {}): Promise<PageResult<TrackingTask>> {
  return get<PageResult<TrackingTask>>('/tracking/tasks', query as Record<string, unknown>)
}

/** 在途任务详情（tracks 时间升序） */
export function getTrackingTask(id: number | string): Promise<TrackingTaskDetail> {
  return get<TrackingTaskDetail>(`/tracking/tasks/${id}`)
}
