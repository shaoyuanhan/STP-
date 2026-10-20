/**
 * axios 实例与统一响应拦截（契约第 2 节）
 *
 * - baseURL 固定 /api（开发环境由 vite.config.ts 代理到 http://localhost:3000）
 * - 所有接口返回 { code, message, data } 信封：
 *   - code === '00000' → 拆包返回 data
 *   - 其他 code（A0001/A0002/B0001/C0001/D0001/D0002）→ 抛出 ApiError(message, code)
 * - HTTP 非 2xx → 同样抛出 ApiError，优先取响应体里的 message/code
 *
 * 业务代码请使用导出的 get/post/put/request 泛型函数，
 * 拿到的直接是信封内的 data，无需再判 code。
 */

import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'
import type { ApiEnvelope } from '@/types/api'

/** 统一业务错误（含契约错误码） */
export class ApiError extends Error {
  /** 业务错误码（A0001/B0001/D0001…）或 HTTP_500 / NETWORK 等兜底码 */
  code: string
  /** HTTP 状态码（网络错误时为 0） */
  status: number

  constructor(message: string, code = 'B0001', status = 0) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

function toHttpCode(status: number): string {
  return Number.isFinite(status) && status > 0 ? `HTTP_${status}` : 'NETWORK'
}

const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// axios 自定义配置标记：保留完整信封（含后端 message），不拆包
declare module 'axios' {
  export interface AxiosRequestConfig {
    /** true 时成功响应返回 { code, message, data } 完整信封 */
    envelope?: boolean
  }
}

// 成功分支：拆信封；失败分支：HTTP 错误归一为 ApiError
http.interceptors.response.use(
  (response) => {
    const body = response.data as ApiEnvelope<unknown> | undefined
    // 兼容非信封响应（如静态资源、第三方透传），原样返回
    if (body && typeof body === 'object' && 'code' in body && 'data' in body) {
      if (body.code === '00000') {
        // 需要后端 message（如派单成功的狮桥同步说明）时，调用方传 envelope: true
        if (!response.config?.envelope) response.data = body.data
        return response
      }
      return Promise.reject(
        new ApiError(body.message || '请求处理失败', body.code, response.status),
      )
    }
    return response
  },
  (error: { response?: { status: number; data?: Partial<ApiEnvelope<unknown>> }; message?: string; code?: string }) => {
    const status = error.response?.status ?? 0
    const body = error.response?.data
    const message =
      body?.message ||
      (status === 0 ? '网络异常，请检查服务是否启动' : `请求失败（HTTP ${status}）`)
    const code = body?.code || toHttpCode(status)
    return Promise.reject(new ApiError(message, code, status))
  },
)

/** 底层请求：已拆信封，返回值即 data */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await http.request<T>(config)
  return response.data
}

export function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return request<T>({ url, method: 'GET', params })
}

export function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return request<T>({ url, method: 'POST', data, ...config })
}

export function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return request<T>({ url, method: 'PUT', data, ...config })
}

/** 带信封的 POST：返回 { code, message, data }，用于需要展示后端 message 的操作类接口 */
export function postEnvelope<T>(url: string, data?: unknown): Promise<ApiEnvelope<T>> {
  return http.post<ApiEnvelope<T>>(url, data, { envelope: true }).then((r) => r.data)
}

/** 带信封的 GET：返回 { code, message, data } */
export function getEnvelope<T>(url: string, params?: Record<string, unknown>): Promise<ApiEnvelope<T>> {
  return http
    .get<ApiEnvelope<T>>(url, { params, envelope: true })
    .then((r) => r.data)
}

export default http
