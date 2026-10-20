/**
 * 外部系统模拟页共享类型（views/simulator 专用）
 */
import type { ApiEnvelope } from '@/types/api'

/** 单个模拟接口的调用状态与响应面板数据 */
export interface SimResponseState {
  /** 调用中（提交按钮 loading） */
  loading: boolean
  /** 请求报文预览：方法 + 完整路径 + 查询串 / 请求体 JSON */
  request: string
  /** 完整响应信封（含 code / message / data，失败也原样返回） */
  envelope: ApiEnvelope<unknown> | null
  /** 响应时间（HH:mm:ss） */
  time: string
}
