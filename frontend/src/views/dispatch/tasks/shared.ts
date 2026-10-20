/**
 * 发运任务页组共享工具（仅页面组 A 内部使用）
 */
import type { SelectOption } from 'naive-ui'
import { ApiError } from '@/services/http'
import type { Carrier, ShippingTaskListItem, TaskStatus } from '@/types/api'

/**
 * 任务列表行扩展：后端列表 SQL 实际返回 t.plan_freight（线路参考价），
 * types/api.ts 的 ShippingTaskListItem 未声明，本地扩展承接（缺失时由详情接口兜底）。
 */
export interface TaskRowExt extends ShippingTaskListItem {
  plan_freight?: number | string | null
}

/** 承运商下拉项：合作中可选；已停用置灰并标注「不可派单」；改派时排除原承运商 */
export function buildCarrierOptions(
  carriers: Carrier[],
  excludeCarrierId?: number | null,
): SelectOption[] {
  return carriers
    .filter((c) => c.id !== excludeCarrierId)
    .map((c) => {
      const cooperating = c.status === 1
      const label = cooperating
        ? `${c.carrier_name}${c.cooperation_routes ? `（${c.cooperation_routes}）` : ''}`
        : `${c.carrier_name}（已停用，不可派单）`
      return { label, value: c.id, disabled: !cooperating }
    })
}

/** VIN 明细拆分（后端 GROUP_CONCAT 顿号连接） */
export function splitVins(vins: string | null | undefined): string[] {
  if (!vins) return []
  return String(vins)
    .split(/[、,，;；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 任务状态中文（StatusTag 内置映射的兜底副本，供时间轴等纯文本场景使用） */
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  WAIT_DISPATCH: '待派单',
  DISPATCHED: '已派单',
  CARRIER_ACCEPTED: '承运商已接单',
  OUTBOUND: '已出库',
  PICKED: '已提车',
  IN_TRANSIT: '在途',
  ARRIVED: '已到达',
  FINISHED: '已完结',
  CANCELLED: '已取消',
}

/** 统一描述接口错误（供派单/取消派单/改派等操作的 D0001 乐观锁冲突判断） */
export function describeApiError(error: unknown): { code: string; message: string } {
  if (error instanceof ApiError) return { code: error.code, message: error.message }
  return {
    code: '',
    message: error instanceof Error && error.message ? error.message : '操作失败，请稍后重试',
  }
}

/** D0001 乐观锁冲突的统一提示文案 */
export const VERSION_CONFLICT_TIP = '任务状态已变化，请刷新后重试'
