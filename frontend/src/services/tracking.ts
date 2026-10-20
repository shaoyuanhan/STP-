/**
 * 在途监控接口（契约 5.5，/api/tracking，snake_case）
 */

import { get } from './http'
import type {
  PageResult,
  TrackingOverview,
  TrackingQuery,
  TrackingTask,
  TrackingTaskDetail,
} from '@/types/api'

/**
 * 未终态任务列表（scope=transit 仅在途；scope=history 仅已完结）
 * 行内 latest_track 为最近一条位置回传
 */
export function listTrackingTasks(query: TrackingQuery = {}): Promise<PageResult<TrackingTask>> {
  return get<PageResult<TrackingTask>>('/tracking/tasks', { scope: 'transit', ...query } as Record<string, unknown>)
}

/** 全国态势：范围内全部运单 + 轨迹折线，用于全国地图总览 */
export function getTrackingOverview(scope: 'transit' | 'history'): Promise<TrackingOverview> {
  return get<TrackingOverview>('/tracking/overview', { scope })
}

/** 在途/历史运单详情（tracks 时间升序） */
export function getTrackingTask(id: number | string): Promise<TrackingTaskDetail> {
  return get<TrackingTaskDetail>(`/tracking/tasks/${id}`)
}
